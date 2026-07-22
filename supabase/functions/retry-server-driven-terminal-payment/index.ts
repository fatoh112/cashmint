import { assertCardPaymentsCapability, corsHeaders, json, stripeRequest, terminalPaymentContext } from '../_shared/terminal.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json()
    const { payment_request_id } = input
    const { db, request } = await terminalPaymentContext(req, payment_request_id, input)
    if (request.provider_type !== 'stripe_server_driven' || request.status !== 'failed' || !request.stripe_payment_intent_id) throw new Error('Only failed server-driven payments with a reusable PaymentIntent can be retried')
    const config = request.restaurant_payment_configs
    await assertCardPaymentsCapability(config.provider_config ?? {})
    const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, config.provider_config ?? {})
    if (!['requires_payment_method', 'requires_confirmation'].includes(intent.status)) throw new Error('PaymentIntent cannot be retried')

    const { data: reader, error: readerError } = await db.from('stripe_terminal_readers')
      .select('*')
      .eq('stripe_reader_id', request.stripe_reader_id)
      .eq('payment_config_id', config.id)
      .eq('is_enabled', true)
      .maybeSingle()
    if (readerError || !reader) throw new Error('WisePOS E reader is unavailable')
    const fresh = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}`, config.provider_config ?? {})
    if (fresh.status !== 'online' || fresh.action?.status === 'in_progress') throw new Error('WisePOS E reader is offline or busy')
    const action = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}/process_payment_intent`, config.provider_config ?? {}, { method: 'POST', body: new URLSearchParams({ payment_intent: intent.id, 'process_config[enable_customer_cancellation]': 'true' }) }, `reader-retry:${request.id}:${Number(request.process_attempt_count || 0) + 1}`)
    const actionId = action.action?.id ?? action.action?.process_payment_intent?.id ?? null
    const now = new Date().toISOString()
    const { error: requestUpdateError } = await db.from('payment_requests').update({
      status: 'waiting_for_card',
      reader_action_id: actionId,
      reader_action_status: action.action?.status ?? 'in_progress',
      reader_action_type: action.action?.type ?? 'process_payment_intent',
      process_attempt_count: Number(request.process_attempt_count || 0) + 1,
      last_reconciled_at: now,
      updated_at: now,
    }).eq('id', request.id)
    if (requestUpdateError) throw requestUpdateError
    const { error: readerUpdateError } = await db.from('stripe_terminal_readers').update({
      status: fresh.status,
      action_status: action.action?.status ?? 'in_progress',
      action_type: action.action?.type ?? 'process_payment_intent',
      last_seen_at: fresh.last_seen_at ? new Date(Number(fresh.last_seen_at)).toISOString() : null,
      last_synced_at: now,
      updated_at: now,
    }).eq('id', reader.id)
    if (readerUpdateError) throw readerUpdateError
    return json({ payment_request_id: request.id, status: 'waiting_for_card' })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to retry payment' }, 400)
  }
})
