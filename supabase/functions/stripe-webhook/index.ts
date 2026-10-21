import Stripe from 'npm:stripe@17.7.0'
import { serviceClient, stripeClient } from '../_shared/checkout.ts'

// Called by Stripe only (verify_jwt = false); every request must carry a valid Stripe signature.

const cryptoProvider = Stripe.createSubtleCryptoProvider()

function textResponse(message: string, status = 200) {
  return new Response(message, { status })
}

async function handleCompleted(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') {
    console.warn('Session completed without payment', session.id, session.payment_status)
    return
  }

  const supabase = serviceClient()

  // Stripe retries deliveries; an existing order means this session was already handled.
  const { data: existing, error: existingError } = await supabase
    .from('orders')
    .select('id')
    .eq('stripe_session_id', session.id)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) return

  const recordIds = (session.metadata?.record_ids ?? '').split(',').filter(Boolean)

  const { data: rows, error: rowsError } = await supabase
    .from('vinyl_records')
    .select('id, sold, stripe_session_id')
    .in('id', recordIds)
  if (rowsError) throw rowsError

  // Should never happen (the reservation outlives the session), but if a record was sold or
  // reserved by another session, the order is flagged so an admin can refund it.
  const records = (rows ?? []) as { id: string, sold: boolean, stripe_session_id: string | null }[]
  const conflict = records.length !== recordIds.length || records.some((record) =>
    (record.stripe_session_id !== null && record.stripe_session_id !== session.id)
    || (record.sold && record.stripe_session_id !== session.id))

  // stripe_session_id stays on the sold row as the link to its order.
  const { error: soldError } = await supabase
    .from('vinyl_records')
    .update({ sold: true, reserved_until: null, stripe_session_id: session.id })
    .in('id', recordIds)
  if (soldError) throw soldError

  const withCollected = session as Stripe.Checkout.Session & {
    collected_information?: { shipping_details?: unknown } | null
  }
  const shipping = withCollected.collected_information?.shipping_details ?? session.shipping_details ?? null

  const { error: orderError } = await supabase
    .from('orders')
    .upsert({
      stripe_session_id: session.id,
      email: session.customer_details?.email ?? null,
      shipping,
      total_cents: session.amount_total,
      currency: session.currency,
      record_ids: recordIds,
      status: conflict ? 'needs_review' : 'paid',
    }, { onConflict: 'stripe_session_id', ignoreDuplicates: true })
  if (orderError) throw orderError
}

async function handleExpired(session: Stripe.Checkout.Session) {
  const { error } = await serviceClient()
    .from('vinyl_records')
    .update({ reserved_until: null, stripe_session_id: null })
    .eq('stripe_session_id', session.id)
    .eq('sold', false)
  if (error) throw error
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return textResponse('Method not allowed.', 405)

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured.')
    return textResponse('Webhook is not configured.', 500)
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return textResponse('Missing signature.', 400)

  let event: Stripe.Event
  try {
    const payload = await request.text()
    event = await stripeClient().webhooks.constructEventAsync(payload, signature, webhookSecret, undefined, cryptoProvider)
  } catch (error) {
    console.error('Invalid webhook signature', error instanceof Error ? error.message : error)
    return textResponse('Invalid signature.', 400)
  }

  try {
    if (event.type === 'checkout.session.completed') await handleCompleted(event.data.object)
    else if (event.type === 'checkout.session.expired') await handleExpired(event.data.object)
  } catch (error) {
    // A non-2xx status makes Stripe retry the delivery.
    console.error(`Failed to handle ${event.type}`, error)
    return textResponse('Handler failed.', 500)
  }

  return textResponse('ok')
})
