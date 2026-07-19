import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.6'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // supabase-js includes x-client-info on browser invokes. It must be allowed
  // during preflight or the browser blocks the enrollment request before it
  // reaches this function.
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, stripe-signature, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

export const service = () => createClient(
  Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

export async function authenticatedUser(req: Request) {
  const authorization = req.headers.get('authorization')
  if (!authorization) throw new Error('Missing authorization')
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error('Invalid authorization')
  return data.user
}

export async function bridgeDevice(req: Request) {
  const user = await authenticatedUser(req)
  const db = service()
  const { data, error } = await db.from('terminal_devices').select('*')
    .eq('bridge_user_id', user.id).neq('status', 'disabled').maybeSingle()
  if (error || !data) throw new Error('Registered terminal bridge required')
  return { user, device: data, db }
}

export function stripeHeaders(config: Record<string, unknown>, idempotencyKey?: string) {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  if (typeof config.stripe_account_id === 'string' && config.stripe_account_id) headers['Stripe-Account'] = config.stripe_account_id
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return headers
}

export async function stripeRequest(path: string, config: Record<string, unknown>, init: RequestInit = {}, idempotencyKey?: string) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, { ...init, headers: { ...stripeHeaders(config, idempotencyKey), ...(init.headers ?? {}) } })
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message ?? 'Stripe request failed')
  return body
}

export async function paymentRequestForBridge(req: Request, paymentRequestId: string) {
  const { device, db } = await bridgeDevice(req)
  const { data, error } = await db.from('payment_requests')
    .select('*, orders(id,total_amount,currency,status), restaurant_payment_configs(provider_config,currency)')
    .eq('id', paymentRequestId).eq('claimed_by_device_id', device.id).maybeSingle()
  if (error || !data) throw new Error('Payment request is not claimed by this bridge')
  return { device, db, request: data }
}
