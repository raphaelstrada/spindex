import Stripe from 'npm:stripe@17.7.0'
import { createClient } from 'npm:@supabase/supabase-js@2.109.0'

// Service-role client: bypasses RLS, so only checkout code that validates its input may use it.
export function serviceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase service credentials are not configured.')
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
}

export function stripeClient() {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured.')
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })
}

export const CHECKOUT_SESSION_PATTERN = /^cs_(test|live)_[A-Za-z0-9]+$/
