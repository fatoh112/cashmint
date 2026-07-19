import { corsHeaders, json, paymentRequestForBridge, stripeRequest } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { payment_request_id } = await req.json(); const { request } = await paymentRequestForBridge(req, payment_request_id)
    if (['cancel_requested', 'cancelled'].includes(request.status)) return json({ status: request.status, failure_code: request.failure_code, failure_message: request.failure_message })
    if (!request.stripe_payment_intent_id) return json({ status: request.status, failure_code: request.failure_code, failure_message: request.failure_message })
    const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, request.restaurant_payment_configs.provider_config ?? {})
    return json({
      payment_intent_id: intent.id,
      status: intent.status,
      failure_code: intent.last_payment_error?.code ?? request.failure_code ?? null,
      failure_message: intent.last_payment_error?.message ?? request.failure_message ?? null
    })
  } catch (error) { return json({ error: error.message }, 400) }
})
