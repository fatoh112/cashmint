import { json, service, stripeRequest } from '../_shared/terminal.ts'

const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function validStripeSignature(payload: string, signature: string | null) {
  const secret = Deno.env.get('STRIPE_TERMINAL_WEBHOOK_SECRET')
  if (!secret || !signature) return false
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=', 2)))
  const timestamp = Number(parts.t)
  if (!timestamp || !parts.v1 || Math.abs(Date.now() / 1000 - timestamp) > 300) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const computed = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)))
  // Stripe's v1 signature is fixed length; this avoids accepting a prefix match.
  return constantTimeEqual(computed, parts.v1)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  try {
    const raw = await req.text()
    if (!(await validStripeSignature(raw, req.headers.get('stripe-signature')))) return new Response('Invalid Stripe signature', { status: 400 })
    const event = JSON.parse(raw); const intent = event.data?.object
    if (!intent?.id || !String(event.type).startsWith('payment_intent.')) return json({ received: true })
    const requestId = intent.metadata?.payment_request_id
    if (!requestId) return json({ received: true })
    const db = service()
    const { data: request } = await db.from('payment_requests').select('*, restaurant_payment_configs(provider_config)').eq('id', requestId).eq('stripe_payment_intent_id', intent.id).maybeSingle()
    if (!request) return json({ received: true })
    // Retrieve from Stripe rather than trusting even a valid webhook's event body.
    const verified = await stripeRequest(`/payment_intents/${intent.id}`, request.restaurant_payment_configs.provider_config ?? {})
    const finalStatus = ['succeeded', 'failed', 'cancelled', 'expired'].includes(request.status)
    if (verified.status === 'succeeded') {
      await db.from('payment_requests').update({ status: 'succeeded', failure_code: null, failure_message: null, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', request.id)
      const { error } = await db.rpc('finalize_split_card_payment', { p_payment_request_id: request.id, p_provider_reference: verified.id })
      if (error) throw error
    } else if (['cancel_requested', 'cancelled'].includes(request.status)) {
      await db.from('payment_requests').update({ status: 'cancelled', failure_code: verified.last_payment_error?.code ?? null, failure_message: verified.last_payment_error?.message ?? 'Payment cancelled.', finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', request.id).neq('status', 'succeeded')
    } else if (verified.status === 'canceled') {
      await db.from('payment_requests').update({ status: 'cancelled', failure_code: verified.last_payment_error?.code ?? null, failure_message: verified.last_payment_error?.message ?? null, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', request.id).neq('status', 'succeeded')
    } else if (verified.status === 'requires_payment_method') {
      await db.from('payment_requests').update({ status: 'failed', failure_code: verified.last_payment_error?.code ?? null, failure_message: verified.last_payment_error?.message ?? 'Payment timed out or was declined.', finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', request.id).neq('status', 'succeeded')
    } else if (!finalStatus) {
      await db.from('payment_requests').update({ status: 'unknown', updated_at: new Date().toISOString() }).eq('id', request.id).neq('status', 'succeeded')
    }
    if (['succeeded', 'canceled', 'requires_payment_method'].includes(verified.status) && request.claimed_by_device_id) {
      await db.from('terminal_devices').update({
        current_payment_request_id: null,
        reader_action_status: verified.status === 'succeeded' ? 'idle' : 'cancelling',
        updated_at: new Date().toISOString()
      }).eq('id', request.claimed_by_device_id)
    }
    return json({ received: true })
  } catch (error) { console.error(error); return new Response('Webhook handling failed', { status: 500 }) }
})
