import { activeTerminalRequestStatuses, assertCardPaymentsCapability, corsHeaders, json, readerActionPaymentIntentId, safeReader, service, stripeRequest, terminalPaymentContext, validateSplitCardPaymentRequest } from '../_shared/terminal.ts'

async function releaseOrphanedReaderAction(
  db: ReturnType<typeof service>,
  request: Record<string, any>,
  reader: Record<string, any>,
  config: Record<string, any>,
  fresh: Record<string, any>,
) {
  const actionStatus = fresh.action?.status
  const terminalAction = ['succeeded', 'failed', 'canceled', 'cancelled'].includes(actionStatus)
  if (terminalAction) {
    const { error } = await db.from('stripe_terminal_readers').update({
      status: fresh.status ?? null,
      action_status: 'idle',
      action_type: null,
      last_seen_at: fresh.last_seen_at ? new Date(Number(fresh.last_seen_at)).toISOString() : null,
      last_synced_at: new Date().toISOString(),
      last_error_code: fresh.action?.failure_code ?? null,
      last_error_message: fresh.action?.failure_message ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', reader.id)
    if (error) throw error
    return { ...fresh, action: null }
  }
  if (!['in_progress', 'processing'].includes(actionStatus)) return fresh

  const activeActionPaymentIntentId = readerActionPaymentIntentId(fresh)
  if (request.stripe_payment_intent_id && activeActionPaymentIntentId === request.stripe_payment_intent_id) {
    throw new Error('WisePOS E reader is already processing this PaymentIntent')
  }

  const { data: activeRequest, error: activeRequestError } = await db.from('payment_requests')
    .select('id')
    .eq('location_id', request.location_id)
    .eq('stripe_reader_id', reader.stripe_reader_id)
    .neq('id', request.id)
    .in('status', activeTerminalRequestStatuses)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (activeRequestError) throw activeRequestError
  if (activeRequest) throw new Error('WisePOS E reader is busy with another active payment')

  const stalePaymentIntentId = activeActionPaymentIntentId
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
  if (['in_progress', 'processing'].includes(recovered.action?.status)) throw new Error('WisePOS E reader did not release its previous action')
  if (['succeeded', 'failed', 'canceled', 'cancelled'].includes(recovered.action?.status)) {
    return { ...recovered, action: null }
  }
  return recovered
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  let paymentAttemptStarted = false
  try {
    const input = await req.json()
    const { payment_request_id } = input
    const { db, request } = await terminalPaymentContext(req, payment_request_id, input)
    const config = request.restaurant_payment_configs
    if (request.provider_type !== 'stripe_server_driven' || config.provider_type !== 'stripe_server_driven' || !config.is_enabled || !config.is_primary) throw new Error('Server-driven provider is not active for this request')
    await assertCardPaymentsCapability(config.provider_config ?? {})
    if (!['pending', 'failed', 'unknown', 'waiting_for_card'].includes(request.status)) throw new Error('Payment request is not startable')
    await validateSplitCardPaymentRequest(db, request)

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

    const amount = request.split_part_id
      ? Number(request.amount_cents)
      : Number(request.amount_cents ?? Math.round(Number(request.orders.total_amount) * 100))
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
    if (Number(intent.amount) !== amount || String(intent.currency).toLowerCase() !== String(config.currency ?? request.orders.currency).toLowerCase()) {
      throw new Error('PaymentIntent amount or currency does not match the payment request')
    }
    if (['succeeded', 'canceled'].includes(intent.status)) throw new Error('PaymentIntent is already final')

    const now = new Date().toISOString()
    if (!request.stripe_payment_intent_id) {
      const { data: persistedRequest, error: persistIntentError } = await db.from('payment_requests').update({
        stripe_payment_intent_id: intent.id,
        status: 'creating_payment_intent',
        last_reconciled_at: now,
        updated_at: now,
      }).eq('id', request.id).in('status', ['pending', 'failed', 'unknown', 'waiting_for_card']).select('id').maybeSingle()
      if (persistIntentError) throw persistIntentError
      if (!persistedRequest) throw new Error('Payment request changed before its PaymentIntent was persisted')
    }

    paymentAttemptStarted = true
    const actionBody = new URLSearchParams({ payment_intent: intent.id, 'process_config[enable_customer_cancellation]': 'true' })
    const action = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}/process_payment_intent`, config.provider_config ?? {}, { method: 'POST', body: actionBody }, `reader-action:${request.id}:${Number(request.process_attempt_count || 0) + 1}`)
    if (readerActionPaymentIntentId(action) !== intent.id) throw new Error('WisePOS E returned an action for a different PaymentIntent')
    const actionId = action.action?.id ?? action.action?.process_payment_intent?.id ?? null
    const { error: requestUpdateError } = await db.from('payment_requests').update({
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
    if (payment_request_id && paymentAttemptStarted) {
      try {
        const db = service()
        await db.from('payment_requests').update({
          status: 'failed',
          failure_code: 'terminal_start_failed',
          failure_message: message,
          reader_action_status: 'failed',
          updated_at: new Date().toISOString(),
        }).eq('id', payment_request_id).in('status', ['pending', 'failed', 'unknown', 'waiting_for_card'])
        await db.rpc('sync_terminal_split_card_failure', {
          p_payment_request_id: payment_request_id,
          p_request_status: 'failed',
          p_failure_code: 'terminal_start_failed',
          p_failure_message: message,
        })
      } catch (recordError) {
        console.error('Failed to record terminal start failure', recordError)
      }
    }
    return json({ error: message }, 400)
  }
})
