import { corsHeaders, json, paymentRequestForBridge, stripeRequest } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { payment_request_id } = await req.json(); const { request } = await paymentRequestForBridge(req, payment_request_id)
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
