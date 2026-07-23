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
  return (await authenticatedUserContext(req)).user
}

export async function authenticatedUserContext(req: Request) {
  const authorization = req.headers.get('authorization')
  if (!authorization) throw new Error('Missing authorization')
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error('Invalid authorization')
  return { user: data.user, client }
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

export async function assertCardPaymentsCapability(config: Record<string, unknown>) {
  if (typeof config.stripe_account_id !== 'string' || !config.stripe_account_id) return
  const account = await stripeRequest(`/accounts/${config.stripe_account_id}?fields=capabilities`, config)
  if (account.capabilities?.card_payments !== 'active') throw new Error('Connected Stripe account lacks active card_payments capability')
}

export async function authenticatedStoreContext(req: Request, paymentRequestId: string) {
  const { user, client } = await authenticatedUserContext(req)
  const db = service()
  const { data: request, error } = await db.from('payment_requests')
    .select('*, orders(id,total_amount,currency,status,store_id,pos_device_id), restaurant_locations!inner(store_id), restaurant_payment_configs(id,provider_type,is_enabled,is_primary,currency,provider_config)')
    .eq('id', paymentRequestId).maybeSingle()
  if (error || !request) throw new Error('Payment request not found')
  const storeId = request.restaurant_locations.store_id
  const { data: member } = await db.from('store_users').select('role').eq('store_id', storeId).eq('user_id', user.id).maybeSingle()
  const { data: isSuperadmin } = await client.rpc('is_superadmin')
  if (!member && !isSuperadmin) throw new Error('Store access required')
  return { user, db, request, storeId }
}

/**
 * Authorizes POS-originated server-driven operations without requiring a
 * store_users login. The browser never supplies a trusted store_id; the
 * store/location/order relationship is loaded from the service-side query.
 */
export async function terminalPaymentContext(
  req: Request,
  paymentRequestId: string,
  input: Record<string, unknown> = {},
) {
  const db = service()
  const { data: request, error } = await db.from('payment_requests')
    .select('*, orders!inner(id,total_amount,currency,status,store_id,pos_device_id), restaurant_locations!inner(store_id), restaurant_payment_configs(id,provider_type,is_enabled,is_primary,currency,provider_config)')
    .eq('id', paymentRequestId).maybeSingle()
  if (error || !request) throw new Error('Payment request not found')

  let user: Record<string, unknown> | null = null
  let userClient: ReturnType<typeof createClient> | null = null
  try {
    const auth = await authenticatedUserContext(req)
    user = auth.user as unknown as Record<string, unknown>
    userClient = auth.client
  } catch (_) {
    // Activated POS devices use the device credential path below.
  }

  if (user && userClient) {
    const { data: member } = await db.from('store_users').select('role')
      .eq('store_id', request.restaurant_locations.store_id).eq('user_id', user.id).maybeSingle()
    const { data: isSuperadmin } = await userClient.rpc('is_superadmin')
    if (member || isSuperadmin) return { user, db, request, storeId: request.restaurant_locations.store_id, authMode: 'user' as const }
  }

  const deviceId = String(input.pos_device_id ?? input.p_pos_device_id ?? '')
  const deviceToken = String(input.pos_device_token ?? input.p_device_token ?? '')
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(deviceId) || !uuidPattern.test(deviceToken)) throw new Error('Authenticated store user or active POS device credentials required')

  const { data: device } = await db.from('pos_devices')
    .select('id,store_id,status').eq('id', deviceId).eq('device_token', deviceToken).eq('status', 'active').maybeSingle()
  const order = request.orders
  const locationStoreId = request.restaurant_locations.store_id
  if (!device || device.store_id !== locationStoreId || device.store_id !== order.store_id ||
      (order.pos_device_id && order.pos_device_id !== device.id) || request.order_id !== order.id) {
    throw new Error('POS device is not authorized for this payment')
  }
  return { user, db, request, storeId: locationStoreId, device, authMode: 'pos_device' as const }
}

export function safeReader(reader: Record<string, unknown>) {
  const action = (reader.action && typeof reader.action === 'object') ? reader.action as Record<string, unknown> : {}
  return {
    id: reader.id, label: reader.label ?? null, serial_number: reader.serial_number ?? null,
    device_type: reader.device_type ?? null, status: reader.status ?? null,
    action_status: action.status ?? null, action_type: action.type ?? null,
    livemode: reader.livemode ?? false, location: reader.location ?? null,
    last_seen_at: reader.last_seen_at ? new Date(Number(reader.last_seen_at)).toISOString() : null,
    metadata: reader.metadata ?? {},
  }
}

export const activeTerminalRequestStatuses = [
  'pending', 'claimed', 'creating_payment_intent', 'waiting_for_card',
  'processing', 'cancel_requested', 'unknown',
]

export const splitCardStartStatuses = ['awaiting_card', 'partially_paid']

export function readerActionPaymentIntentId(reader: Record<string, any>) {
  const action = reader.action && typeof reader.action === 'object' ? reader.action : {}
  const paymentIntentId = action.process_payment_intent?.payment_intent ?? action.payment_intent
  return typeof paymentIntentId === 'string' ? paymentIntentId : null
}

/**
 * Split requests are intentionally validated from the service-role view of
 * the database. The browser may supply the request id, but never the part,
 * order, amount, or split status that authorizes the charge.
 */
export async function validateSplitCardPaymentRequest(
  db: ReturnType<typeof service>,
  request: Record<string, any>,
  allowedSplitStatuses = splitCardStartStatuses,
) {
  if (!request.split_part_id) return null

  const { data: part, error: partError } = await db.from('payment_split_parts')
    .select('id,split_id,order_id,method,amount_cents,status,payment_id,provider_reference')
    .eq('id', request.split_part_id)
    .maybeSingle()
  if (partError) throw partError
  if (!part || part.order_id !== request.order_id) throw new Error('Split card part does not belong to this order')
  if (part.method !== 'card') throw new Error('Payment request is not linked to a card split part')
  if (Number(part.amount_cents) !== Number(request.amount_cents)) throw new Error('Split card amount does not match the payment request')
  if (part.status !== 'pending') throw new Error('Split card part is no longer payable')

  const { data: split, error: splitError } = await db.from('payment_splits')
    .select('id,order_id,total_amount_cents,status')
    .eq('id', part.split_id)
    .maybeSingle()
  if (splitError) throw splitError
  if (!split || split.order_id !== request.order_id) throw new Error('Split record does not belong to this order')
  if (!allowedSplitStatuses.includes(split.status)) throw new Error('Split payment is no longer awaiting a card payment')

  const { data: succeededCard, error: succeededCardError } = await db.from('payment_split_parts')
    .select('id')
    .eq('split_id', split.id)
    .eq('method', 'card')
    .eq('status', 'succeeded')
    .neq('id', part.id)
    .limit(1)
    .maybeSingle()
  if (succeededCardError) throw succeededCardError
  if (succeededCard) throw new Error('A card payment already succeeded for this split')

  const { data: activeRequest, error: activeRequestError } = await db.from('payment_requests')
    .select('id')
    .eq('split_part_id', part.id)
    .neq('id', request.id)
    .in('status', activeTerminalRequestStatuses)
    .limit(1)
    .maybeSingle()
  if (activeRequestError) throw activeRequestError
  if (activeRequest) throw new Error('Another active payment request owns this split card part')

  return { part, split }
}
