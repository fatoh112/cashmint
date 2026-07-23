import { authenticatedUser, corsHeaders, json, readerActionPaymentIntentId, service, stripeRequest, terminalPaymentContext } from '../_shared/terminal.ts'

const cancellableRequestStatuses = ['pending', 'claimed', 'creating_payment_intent', 'waiting_for_card', 'processing', 'unknown']

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; code?: unknown; error?: { message?: unknown } }
    if (typeof value.message === 'string') return value.message
    if (typeof value.error?.message === 'string') return value.error.message
    if (typeof value.code === 'string') return value.code
  }
  return 'Unknown reader cancellation error'
}

function stripeTimestamp(value: unknown) {
  const timestamp = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

async function syncServerDrivenReader(
  db: ReturnType<typeof service>,
  reader: Record<string, any>,
  providerConfig: Record<string, unknown>,
  cancellationError: string | null,
  expectedPaymentIntentId: string | null,
) {
  const fresh = await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}`, providerConfig)
  const rawAction = fresh.action && typeof fresh.action === 'object' ? fresh.action : {}
  const actionMatchesRequest = Boolean(expectedPaymentIntentId) && readerActionPaymentIntentId(fresh) === expectedPaymentIntentId
  const action = actionMatchesRequest && ['in_progress', 'processing'].includes(rawAction.status) ? rawAction : {}
  const { error } = await db.from('stripe_terminal_readers').update({
    status: fresh.status ?? null,
    action_status: action.status ?? 'idle',
    action_type: action.type ?? null,
    last_seen_at: stripeTimestamp(fresh.last_seen_at),
    last_synced_at: new Date().toISOString(),
    last_error_code: action.failure_code ?? (cancellationError ? 'reader_cancel_action_failed' : null),
    last_error_message: action.failure_message ?? cancellationError,
    updated_at: new Date().toISOString(),
  }).eq('id', reader.id)
  if (error) throw error
  return action.status ?? 'idle'
}

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
    if (request.status === 'cancelled') return json({ status: 'cancelled', already_cancelled: true })
    if (request.status === 'cancel_requested') return json({ status: 'cancel_requested', cancellation_pending: true })
    if (request.stripe_payment_intent_id) {
      const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, request.restaurant_payment_configs.provider_config ?? {})
      if (intent.status === 'succeeded') throw new Error('Succeeded payments cannot be cancelled by the client')
    }
    const { data: cancellationClaim, error: cancellationClaimError } = await db.from('payment_requests')
      .update({ status: 'cancel_requested', updated_at: new Date().toISOString() })
      .eq('id', request.id)
      .in('status', cancellableRequestStatuses)
      .select('id')
      .maybeSingle()
    if (cancellationClaimError) throw cancellationClaimError
    if (!cancellationClaim) {
      const { data: latest, error: latestError } = await db.from('payment_requests').select('status').eq('id', request.id).maybeSingle()
      if (latestError) throw latestError
      if (latest?.status === 'cancelled') return json({ status: 'cancelled', already_cancelled: true })
      return json({ status: 'cancel_requested', cancellation_pending: true })
    }
    let readerActionStatus: string | null = null
    let readerReleasePending = false
    if (request.provider_type === 'stripe_server_driven' && request.stripe_reader_id) {
      const { data: reader, error: readerError } = await db.from('stripe_terminal_readers').select('id,stripe_reader_id').eq('stripe_reader_id', request.stripe_reader_id).eq('payment_config_id', request.restaurant_payment_configs.id).maybeSingle()
      if (readerError) throw readerError
      if (reader) {
        let cancellationError: string | null = null
        try {
          await stripeRequest(`/terminal/readers/${reader.stripe_reader_id}/cancel_action`, request.restaurant_payment_configs.provider_config ?? {}, { method: 'POST', body: '' }, `reader-cancel:${request.id}`)
        } catch (error) {
          // Stripe can reject this when the action already reached a final state. Fetching the Reader below is authoritative.
          cancellationError = errorMessage(error)
        }
        readerActionStatus = await syncServerDrivenReader(db, reader, request.restaurant_payment_configs.provider_config ?? {}, cancellationError, request.stripe_payment_intent_id)
        readerReleasePending = ['in_progress', 'processing'].includes(readerActionStatus)
      }
    }
    if (request.stripe_payment_intent_id) {
      const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, request.restaurant_payment_configs.provider_config ?? {})
      if (intent.status !== 'canceled') await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}/cancel`, request.restaurant_payment_configs.provider_config ?? {}, { method: 'POST', body: '' }, `cancel:${request.id}`)
    }
    await db.from('payment_requests').update({ status: 'cancelled', reader_action_status: readerActionStatus, failure_code: null, failure_message: null, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', request.id).neq('status', 'succeeded')
    if (request.split_part_id) {
      const { error: splitSyncError } = await db.rpc('sync_terminal_split_card_failure', {
        p_payment_request_id: request.id,
        p_request_status: 'cancelled',
        p_failure_code: null,
        p_failure_message: 'Payment cancelled',
      })
      if (splitSyncError) throw splitSyncError
    }
    if (request.claimed_by_device_id) {
      await db.from('terminal_devices').update({ current_payment_request_id: null, reader_action_status: 'cancelling', updated_at: new Date().toISOString() }).eq('id', request.claimed_by_device_id)
    }
    return json({ status: 'cancelled', reader_action_status: readerActionStatus, reader_release_pending: readerReleasePending })
  } catch (error) { return json({ error: errorMessage(error) }, 400) }
})
