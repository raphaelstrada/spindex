import { CHECKOUT_SESSION_PATTERN, serviceClient, stripeClient } from '../_shared/checkout.ts'

// Public endpoint (verify_jwt = false). The client sends record ids only; every price, the shipping
// and the total are read from the database here.

// Flip to true once Stripe Tax is set up (GST/HST registration in the Stripe Dashboard).
// Prices are then treated as tax-inclusive, so the amounts shown on the storefront stay final.
const COLLECT_TAX = false

const MAX_ITEMS = 50
// Stripe requires expires_at to be at least 30 minutes away; the extra minute absorbs clock skew.
const SESSION_MINUTES = 31
// The reservation outlives the Stripe session, so nobody else can reserve a record that can still be paid.
const RESERVATION_GRACE_MINUTES = 2

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ReservedRecord = {
  id: string
  artist: string | null
  title: string | null
  price_cad: number
}

type ReserveResult =
  | { ok: true, records: ReservedRecord[] }
  | { ok: false, unavailable_ids: string[] }

async function reservationKey(recordIds: string[], reservedUntil: string) {
  const input = new TextEncoder().encode(`${[...recordIds].sort().join(',')}|${reservedUntil}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return `checkout-${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function cancelCheckout(sessionId: string) {
  const stripe = stripeClient()
  const supabase = serviceClient()

  try {
    await stripe.checkout.sessions.expire(sessionId)
  } catch (error) {
    // Already expired or completed; the state check below decides what to do.
    console.warn('Could not expire session', sessionId, error instanceof Error ? error.message : error)
  }

  // Only release when Stripe confirms the session can no longer be paid.
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session.status !== 'expired') return jsonResponse({ released: false })

  const { error } = await supabase
    .from('vinyl_records')
    .update({ reserved_until: null, stripe_session_id: null })
    .eq('stripe_session_id', sessionId)
    .eq('sold', false)
  if (error) throw error
  return jsonResponse({ released: true })
}

async function createCheckout(recordIds: string[], language: string) {
  const siteUrl = Deno.env.get('SITE_URL')?.replace(/\/+$/, '')
  if (!siteUrl) throw new Error('SITE_URL is not configured.')

  const stripe = stripeClient()
  const supabase = serviceClient()

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60
  const reservedUntil = new Date((expiresAt + RESERVATION_GRACE_MINUTES * 60) * 1000).toISOString()

  const { data: reserveData, error: reserveError } = await supabase.rpc('reserve_records', {
    p_ids: recordIds,
    p_until: reservedUntil,
  })
  if (reserveError) throw reserveError
  const reserve = reserveData as ReserveResult
  if (!reserve.ok) return jsonResponse({ error: 'unavailable', unavailable_ids: reserve.unavailable_ids }, 409)

  const releaseReservation = async () => {
    const { error } = await supabase
      .from('vinyl_records')
      .update({ reserved_until: null })
      .in('id', recordIds)
      .eq('reserved_until', reservedUntil)
      .is('stripe_session_id', null)
    if (error) console.error('Failed to release reservation', error)
  }

  try {
    const subtotal = reserve.records.reduce((sum, record) => sum + Number(record.price_cad), 0)
    const { data: shippingData, error: shippingError } = await supabase.rpc('shipping_cad', {
      item_count: reserve.records.length,
      subtotal,
    })
    if (shippingError) throw shippingError
    const shippingCents = Math.round(Number(shippingData) * 100)
    if (!Number.isFinite(shippingCents) || shippingCents < 0) throw new Error('Invalid shipping amount.')

    const taxBehavior = COLLECT_TAX ? { tax_behavior: 'inclusive' as const } : {}

    // One key per reservation: a retried request reuses the same session instead of creating a second one.
    const idempotencyKey = await reservationKey(recordIds, reservedUntil)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Card only (Apple Pay, Google Pay and Link included): it confirms instantly. Delayed methods such as
      // Canadian pre-authorized debit settle days after the 30-minute reservation ends.
      payment_method_types: ['card'],
      currency: 'cad',
      locale: language === 'pt' ? 'pt-BR' : 'en',
      line_items: reserve.records.map((record) => ({
        quantity: 1,
        price_data: {
          currency: 'cad',
          unit_amount: Math.round(Number(record.price_cad) * 100),
          product_data: { name: `${record.artist || 'Unknown artist'}: ${record.title || 'Untitled'}` },
          ...taxBehavior,
        },
      })),
      shipping_address_collection: { allowed_countries: ['CA'] },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: shippingCents === 0 ? 'Free shipping' : 'Canada Post, tracked',
          fixed_amount: { amount: shippingCents, currency: 'cad' },
          ...taxBehavior,
        },
      }],
      ...(COLLECT_TAX ? { automatic_tax: { enabled: true } } : {}),
      expires_at: expiresAt,
      metadata: { record_ids: reserve.records.map((record) => record.id).join(',') },
      success_url: `${siteUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/bag?cancelled={CHECKOUT_SESSION_ID}`,
    }, { idempotencyKey })

    const { error: linkError } = await supabase
      .from('vinyl_records')
      .update({ stripe_session_id: session.id })
      .in('id', recordIds)
      .eq('reserved_until', reservedUntil)
    if (linkError) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined)
      throw linkError
    }

    if (!session.url) throw new Error('Stripe did not return a checkout URL.')
    return jsonResponse({ url: session.url, session_id: session.id })
  } catch (error) {
    await releaseReservation()
    throw error
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  let body: { record_ids?: unknown, cancel_session_id?: unknown, language?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  try {
    if (body.cancel_session_id !== undefined) {
      if (typeof body.cancel_session_id !== 'string' || !CHECKOUT_SESSION_PATTERN.test(body.cancel_session_id)) {
        return jsonResponse({ error: 'Invalid session id.' }, 400)
      }
      return await cancelCheckout(body.cancel_session_id)
    }

    if (!Array.isArray(body.record_ids)) return jsonResponse({ error: 'record_ids must be an array.' }, 400)
    if (!body.record_ids.every((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))) {
      return jsonResponse({ error: 'Invalid record id.' }, 400)
    }
    const recordIds = [...new Set(body.record_ids.map((id) => id.toLowerCase()))]
    if (recordIds.length === 0 || recordIds.length > MAX_ITEMS) {
      return jsonResponse({ error: `Send between 1 and ${MAX_ITEMS} records.` }, 400)
    }

    return await createCheckout(recordIds, typeof body.language === 'string' ? body.language : 'en')
  } catch (error) {
    console.error('create-checkout failed', error)
    return jsonResponse({ error: 'Checkout is unavailable right now.' }, 502)
  }
})
