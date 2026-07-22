import { json, service, stripeRequest } from '../_shared/terminal.ts'

const encoder = new TextEncoder()
const paymentRequestSelect = '*, restaurant_payment_configs(provider_config)'
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
const constantTimeEqual = (a: string, b: string) => a.length === b.length && [...a].reduce((d, _, i) => d | (a.charCodeAt(i) ^ b.charCodeAt(i)), 0) === 0

async function validStripeSignature(payload: string, signature: string | null) {
  const secret = Deno.env.get('STRIPE_TERMINAL_WEBHOOK_SECRET')
  if (!secret || !signature) return false
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=', 2)))
  const timestamp = Number(parts.t)
  if (!timestamp || !parts.v1 || Math.abs(Date.now() / 1000 - timestamp) > 300) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return constantTimeEqual(hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`))), parts.v1)
}

async function findByPaymentIntent(db: ReturnType<typeof service>, paymentIntentId: string) {
  const { data, error } = await db.from('payment_requests')
    .select(paymentRequestSelect)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function findByReader(db: ReturnType<typeof service>, stripeReaderId: string) {
  const { data, error } = await db.from('payment_requests')
    .select(paymentRequestSelect)
    .eq('stripe_reader_id', stripeReaderId)
    .in('status', ['waiting_for_card', 'processing', 'unknown'])
    .maybeSingle()
  if (error) throw error
  return data
}

async function findById(db: ReturnType<typeof service>, paymentRequestId: string) {
  const { data, error } = await db.from('payment_requests')
    .select(paymentRequestSelect)
    .eq('id', paymentRequestId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function findValidatedMetadataFallback(db: ReturnType<typeof service>, object: Record<string, any>, paymentIntentId: string) {
  const metadata = object?.metadata ?? {}
  const metadataRequestId = typeof metadata.payment_request_id === 'string' ? metadata.payment_request_id : ''
  if (!metadataRequestId) return null

  const request = await findById(db, metadataRequestId)
  if (!request) throw new Error('Payment request metadata does not match a stored request')
  if (request.provider_type !== 'stripe_server_driven') throw new Error('Payment request provider type does not match server-driven webhook')
  if (request.stripe_payment_intent_id !== paymentIntentId) throw new Error('Stored PaymentIntent ID does not match webhook metadata')
  if (request.order_id !== metadata.order_id) throw new Error('Stored order ID does not match webhook metadata')

  const { data: order, error: orderError } = await db.from('orders')
    .select('id, store_id')
    .eq('id', request.order_id)
    .maybeSingle()
  if (orderError) throw orderError
  if (!order || order.id !== metadata.order_id || order.store_id !== metadata.store_id) throw new Error('Stored store ID does not match webhook metadata')
  return request
}

async function readAndSyncReader(db: ReturnType<typeof service>, request: Record<string, any>, config: Record<string, any>, cancelIfInProgress = false) {
  if (request.provider_type !== 'stripe_server_driven' || !request.stripe_reader_id) return null

  const { data: storedReader, error: readerError } = await db.from('stripe_terminal_readers')
    .select('*')
    .eq('stripe_reader_id', request.stripe_reader_id)
    .eq('payment_config_id', config.id)
    .maybeSingle()
  if (readerError) throw readerError
  if (!storedReader) throw new Error('Stored WisePOS E reader was not found')

  let reader = await stripeRequest(`/terminal/readers/${request.stripe_reader_id}`, config.provider_config ?? {})
  if (cancelIfInProgress && reader.action?.status === 'in_progress') {
    await stripeRequest(`/terminal/readers/${request.stripe_reader_id}/cancel_action`, config.provider_config ?? {}, { method: 'POST', body: '' }, `reader-webhook-cancel:${request.id}`)
    reader = await stripeRequest(`/terminal/readers/${request.stripe_reader_id}`, config.provider_config ?? {})
  }

  const action = reader.action && typeof reader.action === 'object' ? reader.action : {}
  const { error: updateError } = await db.from('stripe_terminal_readers')
    .update({
      status: reader.status ?? null,
      action_status: action.status ?? 'idle',
      action_type: action.type ?? null,
      last_seen_at: reader.last_seen_at ? new Date(Number(reader.last_seen_at)).toISOString() : null,
      last_synced_at: new Date().toISOString(),
      last_error_code: action.failure_code ?? null,
      last_error_message: action.failure_message ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storedReader.id)
  if (updateError) throw updateError
  return reader
}

async function markProcessed(db: ReturnType<typeof service>, eventId: string) {
  const { error } = await db.rpc('mark_stripe_terminal_webhook_processed', { p_event_id: eventId })
  if (error) throw error
}

async function updateRequest(db: ReturnType<typeof service>, requestId: string, values: Record<string, unknown>) {
  const { error } = await db.from('payment_requests').update(values).eq('id', requestId)
  if (error) throw error
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  let eventId: string | null = null
  try {
    const raw = await req.text()
    if (!(await validStripeSignature(raw, req.headers.get('stripe-signature')))) return new Response('Invalid Stripe signature', { status: 400 })
    const event = JSON.parse(raw)
    const object = event.data?.object ?? {}
    const type = String(event.type)
    eventId = event.id ?? null
    if (!eventId) return json({ received: true })

    const db = service()
    const { data: claimed, error: claimError } = await db.rpc('claim_stripe_terminal_webhook_event', {
      p_event_id: eventId,
      p_event_type: type,
      p_livemode: Boolean(event.livemode),
      p_metadata: { account: event.account ?? null },
    })
    if (claimError) throw claimError
    if (!claimed) return json({ received: true, duplicate: true })

    let intentId = type.startsWith('terminal.reader.')
      ? object.action?.process_payment_intent?.payment_intent ?? object.action?.payment_intent ?? null
      : object.id
    let request: any = intentId ? await findByPaymentIntent(db, intentId) : null
    if (!request && type.startsWith('terminal.reader.') && object.id) request = await findByReader(db, object.id)
    if (!request && type === 'payment_intent.succeeded') request = await findValidatedMetadataFallback(db, object, intentId)

    if (!request) {
      await markProcessed(db, eventId)
      return json({ received: true })
    }

    const config = request.restaurant_payment_configs?.provider_config
    if (!config) throw new Error('Payment request Stripe configuration is missing')

    if (type === 'terminal.reader.action_failed') {
      await updateRequest(db, request.id, {
        status: 'failed',
        failure_code: object.action?.failure_code ?? 'reader_action_failed',
        failure_message: object.action?.failure_message ?? 'Reader action failed',
        reader_action_status: 'failed',
        reader_failure_code: object.action?.failure_code ?? null,
        reader_failure_message: object.action?.failure_message ?? null,
        finalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      await readAndSyncReader(db, request, request.restaurant_payment_configs, false)
      await markProcessed(db, eventId)
      return json({ received: true })
    }

    const verified = intentId ? await stripeRequest(`/payment_intents/${intentId}`, config) : null

    if (type === 'terminal.reader.action_succeeded' && verified?.status !== 'succeeded') {
      await updateRequest(db, request.id, {
        status: 'unknown',
        reader_action_status: 'succeeded',
        last_reconciled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      await readAndSyncReader(db, request, request.restaurant_payment_configs, false)
      await markProcessed(db, eventId)
      return json({ received: true })
    }

    if (!verified) {
      await markProcessed(db, eventId)
      return json({ received: true })
    }

    if (verified.status === 'succeeded') {
      const { error } = await db.rpc('complete_terminal_payment', {
        p_payment_request_id: request.id,
        p_provider_reference: verified.id,
        p_processor_fee: 0,
      })
      if (error) throw error
    } else if (verified.status === 'canceled') {
      await updateRequest(db, request.id, {
        status: 'cancelled',
        failure_code: verified.last_payment_error?.code ?? null,
        failure_message: verified.last_payment_error?.message ?? 'Payment cancelled',
        finalized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      await readAndSyncReader(db, request, request.restaurant_payment_configs, true)
    } else if (verified.status === 'requires_payment_method') {
      const reader = request.provider_type === 'stripe_server_driven'
        ? await readAndSyncReader(db, request, request.restaurant_payment_configs, false)
        : null
      const readerActionStatus = reader?.action?.status ?? null
      if (readerActionStatus === 'in_progress') {
        await updateRequest(db, request.id, {
          status: ['waiting_for_card', 'processing'].includes(request.status) ? request.status : 'processing',
          failure_code: null,
          failure_message: null,
          reader_action_status: 'in_progress',
          last_reconciled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      } else if (verified.last_payment_error || readerActionStatus === 'failed') {
        await updateRequest(db, request.id, {
          status: 'failed',
          failure_code: verified.last_payment_error?.code ?? reader?.action?.failure_code ?? 'payment_declined',
          failure_message: verified.last_payment_error?.message ?? reader?.action?.failure_message ?? 'Payment declined',
          reader_action_status: readerActionStatus === 'failed' ? 'failed' : request.reader_action_status,
          finalized_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      } else {
        await updateRequest(db, request.id, {
          status: ['waiting_for_card', 'processing'].includes(request.status) ? request.status : 'processing',
          last_reconciled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    } else {
      await updateRequest(db, request.id, {
        status: 'unknown',
        last_reconciled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }

    await markProcessed(db, eventId)
    return json({ received: true })
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'unknown'
    try {
      if (eventId) await service().rpc('mark_stripe_terminal_webhook_failed', { p_event_id: eventId, p_error: safeMessage })
    } catch (_) { /* preserve the original non-2xx response */ }
    console.error('stripe terminal webhook failed', safeMessage)
    return new Response('Webhook handling failed', { status: 500 })
  }
})
