import { assertCardPaymentsCapability, corsHeaders, json, safeReader, service, stripeRequest, terminalPaymentContext } from '../_shared/terminal.ts'

const activeRequestStatuses = ['pending', 'claimed', 'creating_payment_intent', 'waiting_for_card', 'processing', 'cancel_requested', 'unknown']

function actionPaymentIntentId(reader: Record<string, any>) {
  const action = reader.action && typeof reader.action === 'object' ? reader.action : {}
  const paymentIntentId = action.process_payment_intent?.payment_intent ?? action.payment_intent
  return typeof paymentIntentId === 'string' ? paymentIntentId : null
}

async function releaseOrphanedReaderAction(
  db: ReturnType<typeof service>,
  request: Record<string, any>,
  reader: Record<string, any>,
  config: Record<string, any>,
  fresh: Record<string, any>,
) {
  if (fresh.action?.status !== 'in_progress') return fresh

  const { data: activeRequest, error: activeRequestError } = await db.from('payment_requests')
    .select('id')
    .eq('location_id', request.location_id)
    .eq('stripe_reader_id', reader.stripe_reader_id)
    .neq('id', request.id)
    .in('status', activeRequestStatuses)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (activeRequestError) throw activeRequestError
  if (activeRequest) throw new Error('WisePOS E reader is busy with another active payment')

  const stalePaymentIntentId = actionPaymentIntentId(fresh)
  if (stalePaymentIntentId) {
    const staleIntent = await stripeRequest(`/payment_intents/${stalePaymentIntentId}`, config.provider_config ?? {})
    if (staleIntent.status === 'succeeded') throw new Error('WisePOS E reader has a completed action awaiting Stripe reconciliation')
  }

  // No local payment owns this action and it is not a successful charge. Release it before starting a new order.
  try {
    await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}/cancel_action`, config.provider_config ?? {}, { method: 'POST', body: '' }, `reader-orphan-recovery:${request.id}`)
  } catch (_) {
    // The action may have just become final. The read below is authoritative.
  }
  const recovered = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}`, config.provider_config ?? {})
  const action = recovered.action && typeof recovered.action === 'object' ? recovered.action : {}
  const { error: readerUpdateError } = await db.from('stripe_terminal_readers').update({
    status: recovered.status ?? null,
    action_status: action.status ?? 'idle',
    action_type: action.type ?? null,
    last_seen_at: recovered.last_seen_at ? new Date(Number(recovered.last_seen_at)).toISOString() : null,
    last_synced_at: new Date().toISOString(),
    last_error_code: action.failure_code ?? null,
    last_error_message: action.failure_message ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', reader.id)
  if (readerUpdateError) throw readerUpdateError
  if (recovered.action?.status === 'in_progress') throw new Error('WisePOS E reader did not release its previous action')
  return recovered
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json()
    const { payment_request_id } = input
    const { db, request } = await terminalPaymentContext(req, payment_request_id, input)
    const config = request.restaurant_payment_configs
    if (request.provider_type !== 'stripe_server_driven' || config.provider_type !== 'stripe_server_driven' || !config.is_enabled || !config.is_primary) throw new Error('Server-driven provider is not active for this request')
    await assertCardPaymentsCapability(config.provider_config ?? {})
    if (!['pending', 'failed', 'unknown', 'waiting_for_card'].includes(request.status)) throw new Error('Payment request is not startable')

    const { data: reader, error: readerError } = await db.from('stripe_terminal_readers')
      .select('*')
      .eq('payment_config_id', config.id)
      .eq('location_id', request.location_id)
      .eq('is_enabled', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (readerError || !reader) throw new Error('WisePOS E reader is not configured')

    let fresh = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}`, config.provider_config ?? {})
    if (fresh.location !== reader.stripe_location_id || fresh.status !== 'online') throw new Error('WisePOS E reader is offline or assigned to the wrong location')
    fresh = await releaseOrphanedReaderAction(db, request, reader, config, fresh)

    const amount = Number(request.amount_cents ?? Math.round(Number(request.orders.total_amount) * 100))
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Server payment amount is invalid')
    let intent: Record<string, any> = {}
    if (request.stripe_payment_intent_id) intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, config.provider_config ?? {})
    else {
      const body = new URLSearchParams({
        amount: String(amount),
        currency: String(config.currency ?? request.orders.currency).toLowerCase(),
        'payment_method_types[]': 'card_present',
        capture_method: 'automatic',
        'metadata[payment_request_id]': request.id,
        'metadata[order_id]': request.order_id,
        'metadata[store_id]': request.orders.store_id,
        'metadata[location_id]': request.location_id,
        'metadata[provider_type]': request.provider_type,
      })
      if (request.split_part_id) body.set('metadata[split_part_id]', request.split_part_id)
      intent = await stripeRequest('/payment_intents', config.provider_config ?? {}, { method: 'POST', body }, `terminal-intent:${request.id}`)
    }
    if (['succeeded', 'canceled'].includes(intent.status)) throw new Error('PaymentIntent is already final')

    const actionBody = new URLSearchParams({ payment_intent: intent.id, 'process_config[enable_customer_cancellation]': 'true' })
    const action = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}/process_payment_intent`, config.provider_config ?? {}, { method: 'POST', body: actionBody }, `reader-action:${request.id}:${Number(request.process_attempt_count || 0) + 1}`)
    const actionId = action.action?.id ?? action.action?.process_payment_intent?.id ?? null
    const now = new Date().toISOString()
    const { error: requestUpdateError } = await db.from('payment_requests').update({
      stripe_payment_intent_id: intent.id,
      stripe_payment_intent_client_secret: null,
      stripe_reader_id: reader.stripe_reader_id,
      reader_action_id: actionId,
      reader_action_status: action.action?.status ?? 'in_progress',
      reader_action_type: action.action?.type ?? 'process_payment_intent',
      status: 'waiting_for_card',
      started_at: now,
      process_attempt_count: Number(request.process_attempt_count || 0) + 1,
      last_reconciled_at: now,
      updated_at: now,
    }).eq('id', request.id).neq('status', 'succeeded')
    if (requestUpdateError) throw requestUpdateError

    const { error: readerUpdateError } = await db.from('stripe_terminal_readers').update({
      status: fresh.status,
      action_status: action.action?.status ?? 'in_progress',
      action_type: action.action?.type ?? 'process_payment_intent',
      last_seen_at: fresh.last_seen_at ? new Date(Number(fresh.last_seen_at)).toISOString() : null,
      last_synced_at: now,
      last_error_code: null,
      last_error_message: null,
    }).eq('id', reader.id)
    if (readerUpdateError) throw readerUpdateError
    return json({ payment_request_id: request.id, provider_type: request.provider_type, status: 'waiting_for_card', reader: safeReader({ ...fresh, action: action.action ?? fresh.action }) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start payment'
    if (payment_request_id) {
      try {
        const db = service()
        await db.from('payment_requests').update({
          status: 'failed',
          failure_code: 'terminal_start_failed',
          failure_message: message,
          reader_action_status: 'failed',
          updated_at: new Date().toISOString(),
        }).eq('id', payment_request_id).in('status', ['pending', 'failed', 'unknown', 'waiting_for_card'])
      } catch (recordError) {
        console.error('Failed to record terminal start failure', recordError)
      }
    }
    return json({ error: message }, 400)
  }
})
