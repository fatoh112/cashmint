import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.6'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const service = () => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
async function authenticatedUserContext(req: Request) {
  const authorization = req.headers.get('authorization')
  if (!authorization) throw new Error('Missing authorization')
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error('Invalid authorization')
  return { user: data.user, client }
}
function stripeHeaders(config: Record<string, unknown>, idempotencyKey?: string) {
  const key = Deno.env.get('STRIPE_SECRET_KEY'); if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  if (typeof config.stripe_account_id === 'string' && config.stripe_account_id) headers['Stripe-Account'] = config.stripe_account_id
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return headers
}
async function stripeRequest(path: string, config: Record<string, unknown>, init: RequestInit = {}, idempotencyKey?: string) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, { ...init, headers: { ...stripeHeaders(config, idempotencyKey), ...(init.headers ?? {}) } })
  const body = await response.json(); if (!response.ok) throw new Error(body?.error?.message ?? 'Stripe request failed'); return body
}
function readerActionPaymentIntentId(reader: Record<string, any>) { const action = reader.action && typeof reader.action === 'object' ? reader.action : {}; const id = action.process_payment_intent?.payment_intent ?? action.payment_intent; return typeof id === 'string' ? id : null }

const staleStatuses = ['pending', 'waiting_for_card', 'processing', 'in_progress', 'claimed', 'creating_payment_intent', 'cancel_requested', 'unknown']
const staleAfterSeconds = 10 * 60
const recoveryMinIntervalSeconds = 60
const recoveryLeaseSeconds = 45
const terminalActionStatuses = ['succeeded', 'failed', 'canceled', 'cancelled']

async function storeContext(req: Request, input: Record<string, any>) {
  const db = service()
  const suppliedStoreId = String(input.store_id ?? '')
  try {
    const auth = await authenticatedUserContext(req)
    if (suppliedStoreId) {
      const { data: member } = await db.from('store_users').select('role').eq('store_id', suppliedStoreId).eq('user_id', auth.user.id).maybeSingle()
      const { data: superadmin } = await auth.client.rpc('is_superadmin')
      if (member || superadmin) return { db, storeId: suppliedStoreId }
    }
  } catch (_) { /* POS device authorization is checked below. */ }
  const deviceId = String(input.pos_device_id ?? '')
  const deviceToken = String(input.pos_device_token ?? '')
  const { data: device, error } = await db.from('pos_devices').select('id,store_id,status').eq('id', deviceId).eq('device_token', deviceToken).eq('status', 'active').maybeSingle()
  if (error || !device || (suppliedStoreId && device.store_id !== suppliedStoreId)) throw new Error('Authenticated store user or active POS device credentials required')
  return { db, storeId: device.store_id }
}

function readerActionStatus(reader: Record<string, any>) {
  const status = reader?.action?.status
  return typeof status === 'string' ? status : 'idle'
}

async function saveReader(db: ReturnType<typeof service>, row: Record<string, any>, fresh: Record<string, any>) {
  const action = fresh.action && typeof fresh.action === 'object' ? fresh.action : {}
  const { error } = await db.from('stripe_terminal_readers').update({
    status: fresh.status ?? null,
    action_status: readerActionStatus(fresh) === 'idle' || terminalActionStatuses.includes(readerActionStatus(fresh)) ? 'idle' : readerActionStatus(fresh),
    action_type: terminalActionStatuses.includes(readerActionStatus(fresh)) ? null : action.type ?? null,
    last_seen_at: fresh.last_seen_at ? new Date(Number(fresh.last_seen_at)).toISOString() : null,
    last_synced_at: new Date().toISOString(),
    last_error_code: action.failure_code ?? null,
    last_error_message: action.failure_message ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id)
  if (error) throw error
}

async function expireCanceledRequest(db: ReturnType<typeof service>, request: Record<string, any>) {
  const now = new Date().toISOString()
  const { data: changed, error } = await db.from('payment_requests').update({
    status: 'expired', reader_action_status: 'idle', reader_action_type: null, reader_action_id: null,
    failure_code: 'stale_payment_request', failure_message: 'Payment request expired after Stripe confirmed cancellation',
    last_state_reason: 'STALE_PAYMENT_REQUEST', last_reconciled_at: now, finalized_at: now, updated_at: now,
  }).eq('id', request.id).in('status', staleStatuses).select('id').maybeSingle()
  if (error) throw error
  if (changed && request.split_part_id) {
    const split = await db.rpc('sync_terminal_split_card_failure', { p_payment_request_id: request.id, p_request_status: 'expired', p_failure_code: 'stale_payment_request', p_failure_message: 'Payment request expired after Stripe confirmed cancellation' })
    if (split.error) throw split.error
  }
  return changed ? 'expired' : 'already_final'
}

async function completeSucceededRequest(db: ReturnType<typeof service>, request: Record<string, any>, intent: Record<string, any>) {
  const { error } = await db.rpc('complete_terminal_payment', { p_payment_request_id: request.id, p_provider_reference: intent.id, p_processor_fee: 0 })
  if (error) throw error
  return { id: request.id, result: 'succeeded_reconciled', payment_intent_status: intent.status }
}

async function recoverStaleRequest(db: ReturnType<typeof service>, request: Record<string, any>, reader: Record<string, any>, config: Record<string, any>, freshReader: Record<string, any>) {
  const age = (Date.now() - new Date(request.started_at ?? request.created_at).getTime()) / 1000
  if (age < staleAfterSeconds) return { id: request.id, result: 'not_stale' }
  if (!request.stripe_payment_intent_id) return { id: request.id, result: 'RECOVERY_FAILED', error: 'PaymentIntent is missing; request was preserved' }

  const claimToken = crypto.randomUUID()
  const { data: claimed, error: claimError } = await db.rpc('claim_terminal_payment_recovery', {
    p_payment_request_id: request.id,
    p_claim_token: claimToken,
    p_min_interval_seconds: recoveryMinIntervalSeconds,
    p_lease_seconds: recoveryLeaseSeconds,
  })
  if (claimError) return { id: request.id, result: 'RECOVERY_FAILED', error: 'Recovery lease could not be acquired' }
  if (!claimed) return { id: request.id, result: 'already_claimed_or_recently_reconciled' }

  try {
  const liveActionId = readerActionPaymentIntentId(freshReader)
  const liveStatus = readerActionStatus(freshReader)
  if (['in_progress', 'processing'].includes(liveStatus) && liveActionId === request.stripe_payment_intent_id) {
    return { id: request.id, result: 'ACTIVE_CURRENT_PAYMENT', payment_intent_status: 'reader_action_in_progress' }
  }

  let intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, config.provider_config ?? {})
  if (intent.status === 'succeeded') return await completeSucceededRequest(db, request, intent)
  if (['processing', 'requires_capture'].includes(intent.status)) {
    return { id: request.id, result: 'ACTIVE_CURRENT_PAYMENT', payment_intent_status: intent.status }
  }

  if (intent.status === 'canceled') {
    return { id: request.id, result: await expireCanceledRequest(db, request), payment_intent_status: intent.status }
  }

  const cancellableStatuses = ['requires_payment_method', 'requires_confirmation', 'requires_action']
  if (!cancellableStatuses.includes(intent.status)) {
    return { id: request.id, result: 'RECOVERY_FAILED', payment_intent_status: intent.status, error: 'PaymentIntent status is not safely cancellable; request was preserved' }
  }

  let cancellationError: string | null = null
  try {
    await stripeRequest(`/payment_intents/${intent.id}/cancel`, config.provider_config ?? {}, { method: 'POST', body: '' }, `stale-payment-cancel:${request.id}`)
  } catch (error) {
    cancellationError = error instanceof Error ? error.message : 'Stripe cancellation failed'
  }

  try {
    intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, config.provider_config ?? {})
  } catch (error) {
    return { id: request.id, result: 'RECOVERY_FAILED', error: error instanceof Error ? error.message : 'PaymentIntent re-read failed', cancellation_error: cancellationError }
  }
  if (intent.status === 'succeeded') return await completeSucceededRequest(db, request, intent)
  if (['processing', 'requires_capture'].includes(intent.status)) {
    return { id: request.id, result: 'ACTIVE_CURRENT_PAYMENT', payment_intent_status: intent.status, cancellation_error: cancellationError }
  }
  if (intent.status !== 'canceled') {
    return { id: request.id, result: 'RECOVERY_FAILED', payment_intent_status: intent.status, error: 'Stripe did not confirm cancellation; request was preserved', cancellation_error: cancellationError }
  }
  return { id: request.id, result: await expireCanceledRequest(db, request), payment_intent_status: intent.status, cancellation_error: cancellationError }
  } catch (error) {
    return { id: request.id, result: 'RECOVERY_FAILED', error: error instanceof Error ? error.message : 'Recovery failed; request was preserved' }
  } finally {
    await db.rpc('release_terminal_payment_recovery', { p_payment_request_id: request.id, p_claim_token: claimToken })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json()
    const { db, storeId } = await storeContext(req, input)
    const { data: location } = await db.from('restaurant_locations').select('id').eq('store_id', storeId).order('id').limit(1).maybeSingle()
    if (!location) return json({ configured: false, available: false, reason: 'TERMINAL_NOT_CONFIGURED', reader_status: null, reader_action_status: null, active_payment_request_id: null, active_payment_age_seconds: null, last_seen_at: null, last_synced_at: null, provider_type: 'none' })
    const { data: config } = await db.from('restaurant_payment_configs').select('*').eq('location_id', location.id).eq('is_enabled', true).eq('is_primary', true).in('provider_type', ['stripe_server_driven', 'stripe_android_bridge']).maybeSingle()
    if (!config) return json({ configured: false, available: false, reason: 'TERMINAL_NOT_CONFIGURED', reader_status: null, reader_action_status: null, active_payment_request_id: null, active_payment_age_seconds: null, last_seen_at: null, last_synced_at: null, provider_type: 'none' })
    if (config.provider_type !== 'stripe_server_driven') return json({ configured: true, available: false, reason: 'TERMINAL_NOT_CONFIGURED', provider_type: config.provider_type, reader_status: null, reader_action_status: null, active_payment_request_id: null, active_payment_age_seconds: null, last_seen_at: null, last_synced_at: null })
    const { data: reader, error: readerError } = await db.from('stripe_terminal_readers').select('*').eq('location_id', location.id).eq('payment_config_id', config.id).eq('is_enabled', true).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (readerError || !reader) return json({ configured: true, available: false, reason: 'TERMINAL_NOT_CONFIGURED', provider_type: config.provider_type, reader_status: null, reader_action_status: null, active_payment_request_id: null, active_payment_age_seconds: null, last_seen_at: null, last_synced_at: null })
    let freshReader: Record<string, any>
    try { freshReader = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}`, config.provider_config ?? {}) } catch (error) {
      return json({ configured: true, available: false, reason: 'READER_SYNC_FAILED', provider_type: config.provider_type, reader_status: reader.status ?? null, reader_action_status: reader.action_status ?? 'idle', active_payment_request_id: null, active_payment_age_seconds: null, last_seen_at: reader.last_seen_at ?? null, last_synced_at: reader.last_synced_at ?? null, failure_message: error instanceof Error ? error.message : 'Reader synchronization failed' })
    }
    await saveReader(db, reader, freshReader)
    const { data: requests } = await db.from('payment_requests').select('*').eq('location_id', location.id).eq('stripe_reader_id', reader.stripe_reader_id).in('status', staleStatuses).order('created_at', { ascending: true }).limit(20)
    const staleCandidate = (requests ?? []).find(request => {
      const age = (Date.now() - new Date(request.started_at ?? request.created_at).getTime()) / 1000
      const recentlyReconciled = request.last_reconciled_at && (Date.now() - new Date(request.last_reconciled_at).getTime()) / 1000 < recoveryMinIntervalSeconds
      return age >= staleAfterSeconds && !recentlyReconciled
    })
    const recoveries = staleCandidate ? [await recoverStaleRequest(db, staleCandidate, reader, config, freshReader)] : []
    const { data: current } = await db.from('payment_requests').select('id,order_id,status,created_at,started_at').eq('location_id', location.id).eq('stripe_reader_id', reader.stripe_reader_id).in('status', staleStatuses).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    const liveStatus = readerActionStatus(freshReader)
    const liveActionId = readerActionPaymentIntentId(freshReader)
    const matching = (requests ?? []).find(r => r.stripe_payment_intent_id && r.stripe_payment_intent_id === liveActionId)
    const activeRecovery = recoveries.some(result => result.result === 'ACTIVE_CURRENT_PAYMENT')
    let reason = 'READY'
    if (activeRecovery) reason = 'ACTIVE_CURRENT_PAYMENT'
    else if (freshReader.status !== 'online') reason = 'READER_OFFLINE'
    else if (['in_progress', 'processing'].includes(liveStatus)) reason = matching ? 'READER_BUSY' : 'READER_BUSY'
    else if (current) reason = 'STALE_PAYMENT_REQUEST'
    const activeAge = current ? Math.max(0, Math.floor((Date.now() - new Date(current.started_at ?? current.created_at).getTime()) / 1000)) : null
    return json({ configured: true, available: reason === 'READY', reason, provider_type: config.provider_type, reader_status: freshReader.status ?? null, reader_action_status: liveStatus, active_payment_request_id: current?.id ?? null, active_payment_order_id: current?.order_id ?? null, active_payment_status: current?.status ?? null, active_payment_age_seconds: activeAge, last_seen_at: freshReader.last_seen_at ? new Date(Number(freshReader.last_seen_at)).toISOString() : null, last_synced_at: new Date().toISOString(), recoveries })
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unable to inspect terminal availability' }, 400) }
})
