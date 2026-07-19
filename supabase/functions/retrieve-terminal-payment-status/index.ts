import { corsHeaders, json, paymentRequestForBridge, stripeRequest } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { payment_request_id } = await req.json(); const { request } = await paymentRequestForBridge(req, payment_request_id)
    if (['cancel_requested', 'cancelled'].includes(request.status)) return json({ status: request.status })
    if (!request.stripe_payment_intent_id) return json({ status: request.status })
    const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, request.restaurant_payment_configs.provider_config ?? {})
    return json({ payment_intent_id: intent.id, status: intent.status, client_secret: request.stripe_payment_intent_client_secret })
  } catch (error) { return json({ error: error.message }, 400) }
})
