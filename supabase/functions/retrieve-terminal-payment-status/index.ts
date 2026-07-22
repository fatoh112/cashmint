import { corsHeaders, json, paymentRequestForBridge, service, stripeRequest, terminalPaymentContext } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json()
    const { payment_request_id } = input
    const probe = service(); const { data: providerRequest } = await probe.from('payment_requests').select('provider_type').eq('id', payment_request_id).maybeSingle()
    if (providerRequest?.provider_type === 'stripe_server_driven') {
      const { db, request } = await terminalPaymentContext(req, payment_request_id, input); const config = request.restaurant_payment_configs
      if (!request.stripe_payment_intent_id) return json({ status:request.status, failure_code:request.failure_code, failure_message:request.failure_message })
      const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, config.provider_config ?? {})
      if (intent.status === 'succeeded') {
        const { error: completionError } = await db.rpc('complete_terminal_payment', {
          p_payment_request_id: request.id,
          p_provider_reference: intent.id,
          p_processor_fee: 0,
        })
        if (completionError) throw completionError
      }
      if (intent.status === 'requires_payment_method' && !['failed','succeeded'].includes(request.status)) await db.from('payment_requests').update({status:'failed',failure_code:intent.last_payment_error?.code ?? null,failure_message:intent.last_payment_error?.message ?? 'Payment declined',updated_at:new Date().toISOString()}).eq('id',request.id)
      const reader = request.stripe_reader_id ? await stripeRequest(`/terminal/readers/${request.stripe_reader_id}`,config.provider_config ?? {}) : null
      return json({ payment_request_id:request.id,status:intent.status,payment_intent_id:intent.id,amount:intent.amount,currency:intent.currency,failure_code:intent.last_payment_error?.code ?? request.failure_code ?? null,failure_message:intent.last_payment_error?.message ?? request.failure_message ?? null,reader_status:reader?.status ?? null,reader_action_status:reader?.action?.status ?? null })
    }
    const { request } = await paymentRequestForBridge(req, payment_request_id)
    if (['cancel_requested', 'cancelled'].includes(request.status)) return json({ status: request.status, failure_code: request.failure_code, failure_message: request.failure_message })
    if (!request.stripe_payment_intent_id) return json({ status: request.status, failure_code: request.failure_code, failure_message: request.failure_message })
    const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}?expand[]=latest_charge`, request.restaurant_payment_configs.provider_config ?? {})
    return json({
      payment_intent_id: intent.id,
      livemode: intent.livemode,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
      capture_method: intent.capture_method,
      confirmation_method: intent.confirmation_method,
      payment_method_types: intent.payment_method_types,
      failure_code: intent.last_payment_error?.code ?? request.failure_code ?? null,
      decline_code: intent.last_payment_error?.decline_code ?? null,
      failure_message: intent.last_payment_error?.message ?? request.failure_message ?? null,
      latest_charge_status: intent.latest_charge?.status ?? null,
      cancellation_reason: intent.cancellation_reason ?? null,
      canceled_at: intent.canceled_at ?? null,
      created: intent.created ?? null,
      metadata: {
        order_id: intent.metadata?.order_id ?? null,
        payment_request_id: intent.metadata?.payment_request_id ?? null,
      },
    })
  } catch (error) { return json({ error: error.message }, 400) }
})
