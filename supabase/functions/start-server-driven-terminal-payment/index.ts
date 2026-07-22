import { assertCardPaymentsCapability, corsHeaders, json, safeReader, stripeRequest, terminalPaymentContext } from '../_shared/terminal.ts'

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

    const fresh = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}`, config.provider_config ?? {})
    if (fresh.location !== reader.stripe_location_id || fresh.status !== 'online') throw new Error('WisePOS E reader is offline or assigned to the wrong location')
    if (fresh.action?.status === 'in_progress') throw new Error('WisePOS E reader is busy')

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
    return json({ error: error instanceof Error ? error.message : 'Unable to start payment' }, 400)
  }
})
