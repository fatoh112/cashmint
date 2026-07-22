import { json, service, stripeRequest } from '../_shared/terminal.ts'

const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
const constantTimeEqual = (a: string, b: string) => a.length === b.length && [...a].reduce((d, _, i) => d | (a.charCodeAt(i) ^ b.charCodeAt(i)), 0) === 0
async function validStripeSignature(payload: string, signature: string | null) {
  const secret = Deno.env.get('STRIPE_TERMINAL_WEBHOOK_SECRET'); if (!secret || !signature) return false
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=', 2))); const timestamp = Number(parts.t)
  if (!timestamp || !parts.v1 || Math.abs(Date.now() / 1000 - timestamp) > 300) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign'])
  return constantTimeEqual(hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`))), parts.v1)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  let eventId: string | null = null
  try {
    const raw = await req.text(); if (!(await validStripeSignature(raw, req.headers.get('stripe-signature')))) return new Response('Invalid Stripe signature', { status:400 })
    const event = JSON.parse(raw); const object = event.data?.object; eventId = event.id ?? null; if (!eventId) return json({ received:true })
    const db = service()
    const { data: claimed, error: claimError } = await db.rpc('claim_stripe_terminal_webhook_event', {
      p_event_id: eventId,
      p_event_type: event.type,
      p_livemode: Boolean(event.livemode),
      p_metadata: { account: event.account ?? null },
    })
    if (claimError) throw claimError
    if (!claimed) return json({ received:true, duplicate:true })
    let intentId = object?.id
    if (String(event.type).startsWith('terminal.reader.')) intentId = object?.action?.process_payment_intent?.payment_intent ?? object?.action?.payment_intent ?? null
    let request: any = null
    if (intentId) ({ data: request } = await db.from('payment_requests').select('*, restaurant_payment_configs(provider_config), stripe_terminal_readers(stripe_reader_id)').eq('stripe_payment_intent_id',intentId).maybeSingle())
    if (!request && object?.id) ({ data: request } = await db.from('payment_requests').select('*, restaurant_payment_configs(provider_config), stripe_terminal_readers(stripe_reader_id)').eq('stripe_reader_id',object.id).in('status',['waiting_for_card','processing','unknown']).maybeSingle())
    if (!request) {
      await db.rpc('mark_stripe_terminal_webhook_processed', { p_event_id: eventId })
      return json({ received:true })
    }
    const config = request.restaurant_payment_configs?.provider_config ?? {}
    const verified = intentId ? await stripeRequest(`/payment_intents/${intentId}`,config) : null
    const type = String(event.type)
    if (type === 'terminal.reader.action_failed') {
      const { error } = await db.from('payment_requests').update({ status:'failed', failure_code:object.action?.failure_code ?? 'reader_action_failed', failure_message:object.action?.failure_message ?? 'Reader action failed', reader_action_status:'failed', reader_failure_code:object.action?.failure_code ?? null, reader_failure_message:object.action?.failure_message ?? null, finalized_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id',request.id).neq('status','succeeded')
      if (error) throw error
      await db.rpc('mark_stripe_terminal_webhook_processed', { p_event_id: eventId })
      return json({received:true})
    }
    if (type === 'terminal.reader.action_succeeded' && verified?.status !== 'succeeded') {
      const { error } = await db.from('payment_requests').update({ status:'unknown', reader_action_status:'succeeded', last_reconciled_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id',request.id).neq('status','succeeded')
      if (error) throw error
      await db.from('stripe_terminal_readers').update({ action_status:'succeeded', last_synced_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('stripe_reader_id',request.stripe_reader_id)
      await db.rpc('mark_stripe_terminal_webhook_processed', { p_event_id: eventId })
      return json({received:true})
    }
    if (!verified) {
      await db.rpc('mark_stripe_terminal_webhook_processed', { p_event_id: eventId })
      return json({received:true})
    }
    if (verified.status === 'succeeded') {
      const { error } = await db.rpc('complete_terminal_payment', {
        p_payment_request_id: request.id,
        p_provider_reference: verified.id,
        p_processor_fee: 0,
      })
      if (error) throw error
    } else if (verified.status === 'canceled') {
      const { error } = await db.from('payment_requests').update({ status:'cancelled',failure_code:verified.last_payment_error?.code ?? null,failure_message:verified.last_payment_error?.message ?? 'Payment cancelled',finalized_at:new Date().toISOString(),updated_at:new Date().toISOString() }).eq('id',request.id).neq('status','succeeded')
      if (error) throw error
    } else if (verified.status === 'requires_payment_method') {
      const { error } = await db.from('payment_requests').update({ status:'failed',failure_code:verified.last_payment_error?.code ?? null,failure_message:verified.last_payment_error?.message ?? 'Payment declined',reader_action_status:'failed',finalized_at:new Date().toISOString(),updated_at:new Date().toISOString() }).eq('id',request.id).neq('status','succeeded')
      if (error) throw error
    } else {
      const { error } = await db.from('payment_requests').update({ status:'unknown',last_reconciled_at:new Date().toISOString(),updated_at:new Date().toISOString() }).eq('id',request.id).neq('status','succeeded')
      if (error) throw error
    }
    if (request.provider_type === 'stripe_server_driven' && request.stripe_reader_id) await db.from('stripe_terminal_readers').update({ action_status:verified.status === 'succeeded' ? 'idle' : 'failed', last_synced_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('stripe_reader_id',request.stripe_reader_id)
    const { error: processedError } = await db.rpc('mark_stripe_terminal_webhook_processed', { p_event_id: eventId })
    if (processedError) throw processedError
    return json({received:true})
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'unknown'
    try {
      if (eventId) await service().rpc('mark_stripe_terminal_webhook_failed', { p_event_id: eventId, p_error: safeMessage })
    } catch (_) { /* preserve the original non-2xx response */ }
    console.error('stripe terminal webhook failed', safeMessage)
    return new Response('Webhook handling failed',{status:500})
  }
})
