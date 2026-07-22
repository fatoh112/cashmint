import { authenticatedUser, corsHeaders, json, service, stripeRequest, terminalPaymentContext } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json(); const { payment_request_id } = input; const db = service()
    const { data: request } = await db.from('payment_requests').select('*, orders!inner(id,store_id,pos_device_id), restaurant_locations!inner(store_id), restaurant_payment_configs(id,provider_config)').eq('id', payment_request_id).single()
    if (!request) throw new Error('Payment request not found')

    if (request.provider_type === 'stripe_server_driven') {
      await terminalPaymentContext(req, payment_request_id, input)
    } else {
      let authorized = false
      try {
        await terminalPaymentContext(req, payment_request_id, input)
        authorized = true
      } catch (_) {
        const user = await authenticatedUser(req)
        const { data: member } = await db.from('store_users').select('id').eq('store_id', request.restaurant_locations.store_id).eq('user_id', user.id).maybeSingle()
        const { data: bridgeDevice } = await db.from('terminal_devices').select('id').eq('bridge_user_id', user.id).eq('id', request.claimed_by_device_id ?? '').maybeSingle()
        authorized = Boolean(member || bridgeDevice)
      }
      if (!authorized) throw new Error('Not allowed to cancel this payment')
    }
    if (request.status === 'succeeded') throw new Error('Succeeded payments cannot be cancelled by the client')
    if (request.stripe_payment_intent_id) {
      const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, request.restaurant_payment_configs.provider_config ?? {})
      if (intent.status === 'succeeded') throw new Error('Succeeded payments cannot be cancelled by the client')
    }
    await db.from('payment_requests').update({ status: 'cancel_requested', updated_at: new Date().toISOString() }).eq('id', request.id)
    if (request.provider_type === 'stripe_server_driven' && request.stripe_reader_id) {
      const { data: reader } = await db.from('stripe_terminal_readers').select('stripe_reader_id').eq('stripe_reader_id', request.stripe_reader_id).eq('payment_config_id', request.restaurant_payment_configs.id).maybeSingle()
      if (reader) {
        try { await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}/cancel_action`, request.restaurant_payment_configs.provider_config ?? {}, { method: 'POST', body: '' }, `reader-cancel:${request.id}`) } catch (_) { /* action may already be final */ }
      }
    }
    if (request.stripe_payment_intent_id) {
      await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}/cancel`, request.restaurant_payment_configs.provider_config ?? {}, { method: 'POST', body: '' }, `cancel:${request.id}`)
    }
    await db.from('payment_requests').update({ status: 'cancelled', failure_code: null, failure_message: null, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', request.id).neq('status', 'succeeded')
    if (request.claimed_by_device_id) {
      await db.from('terminal_devices').update({ current_payment_request_id: null, reader_action_status: 'cancelling', updated_at: new Date().toISOString() }).eq('id', request.claimed_by_device_id)
    }
    return json({ status: 'cancelled' })
  } catch (error) { return json({ error: error.message }, 400) }
})
