import { corsHeaders, json, paymentRequestForBridge, stripeRequest } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { payment_request_id } = await req.json()
    const { db, request } = await paymentRequestForBridge(req, payment_request_id)
    if (request.stripe_payment_intent_id && request.stripe_payment_intent_client_secret) return json({ id: request.stripe_payment_intent_id, client_secret: request.stripe_payment_intent_client_secret })
    if (!['claimed', 'creating_payment_intent', 'unknown'].includes(request.status)) throw new Error('Payment request cannot create an intent in its current state')
    await db.rpc('bridge_update_terminal_payment', { p_payment_request_id: request.id, p_status: 'creating_payment_intent', p_failure_code: null, p_failure_message: null })
    const order = request.orders
    const amount = request.amount_cents ? Number(request.amount_cents) : Math.round(Number(order.total_amount) * 100)
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Server order amount is invalid')
    const config = request.restaurant_payment_configs
    // Stripe expects array fields in form-encoded requests to use [] notation.
    // Sending `payment_method_types` without it is rejected as "Invalid array".
    const body = new URLSearchParams({ amount: String(amount), currency: String(config.currency ?? order.currency).toLowerCase(), 'payment_method_types[]': 'card_present', capture_method: 'automatic', 'metadata[payment_request_id]': request.id, 'metadata[order_id]': request.order_id, 'metadata[location_id]': request.location_id })
    const intent = await stripeRequest('/payment_intents', config.provider_config ?? {}, { method: 'POST', body }, request.idempotency_key)
    const { error } = await db.from('payment_requests').update({ stripe_payment_intent_id: intent.id, stripe_payment_intent_client_secret: intent.client_secret, status: 'waiting_for_card', updated_at: new Date().toISOString() }).eq('id', request.id).eq('claimed_by_device_id', request.claimed_by_device_id)
    if (error) throw error
    return json({ id: intent.id, client_secret: intent.client_secret })
  } catch (error) { return json({ error: error.message }, 400) }
})
