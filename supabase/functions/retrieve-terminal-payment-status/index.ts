import { corsHeaders, json, paymentRequestForBridge, service, stripeRequest, terminalPaymentContext } from '../_shared/terminal.ts'

// A confirmed decline/cancellation is terminal as well. Without `failed`
// here, a later status poll could revive a failed request to waiting/processing
// and block the next checkout for the location.
const finalRequestStatuses = new Set(['succeeded', 'failed', 'cancelled', 'expired'])
const processingRequestStatuses = new Set(['waiting_for_card', 'processing'])

function processingStatus(requestStatus: string) {
  return processingRequestStatuses.has(requestStatus) ? requestStatus : 'processing'
}

function stripeTime(value: unknown) {
  return value ? new Date(Number(value)).toISOString() : null
}

async function syncReaderState(db: ReturnType<typeof service>, request: Record<string, any>, config: Record<string, any>, reader: Record<string, any>) {
  if (!request.stripe_reader_id) return
  const action = reader.action && typeof reader.action === 'object' ? reader.action : {}
  const { error } = await db.from('stripe_terminal_readers')
    .update({
      status: reader.status ?? null,
      action_status: action.status ?? 'idle',
      action_type: action.type ?? null,
      last_seen_at: stripeTime(reader.last_seen_at),
      last_synced_at: new Date().toISOString(),
      last_error_code: action.failure_code ?? null,
      last_error_message: action.failure_message ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_reader_id', request.stripe_reader_id)
    .eq('payment_config_id', config.id)
  if (error) throw error
}

async function updatePaymentRequest(db: ReturnType<typeof service>, requestId: string, values: Record<string, unknown>) {
  const { error } = await db.from('payment_requests').update(values).eq('id', requestId)
  if (error) throw error
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await req.json()
    const { payment_request_id } = input
    const probe = service()
    const { data: providerRequest, error: probeError } = await probe.from('payment_requests')
      .select('provider_type')
      .eq('id', payment_request_id)
      .maybeSingle()
    if (probeError) throw probeError

    if (providerRequest?.provider_type === 'stripe_server_driven') {
      const { db, request } = await terminalPaymentContext(req, payment_request_id, input)
      const config = request.restaurant_payment_configs
      if (!request.stripe_payment_intent_id) return json({ status: request.status, failure_code: request.failure_code, failure_message: request.failure_message })

      const intent = await stripeRequest(`/payment_intents/${request.stripe_payment_intent_id}`, config.provider_config ?? {})
      const reader = request.stripe_reader_id
        ? await stripeRequest(`/terminal/readers/${request.stripe_reader_id}`, config.provider_config ?? {})
        : null
      const readerActionStatus = reader?.action?.status ?? 'idle'
      const now = new Date().toISOString()

      if (intent.status === 'succeeded') {
        const { error: completionError } = await db.rpc('complete_terminal_payment', {
          p_payment_request_id: request.id,
          p_provider_reference: intent.id,
          p_processor_fee: 0,
        })
        if (completionError) throw completionError
        return json({
          payment_request_id: request.id,
          status: 'succeeded',
          payment_intent_id: intent.id,
          amount: intent.amount,
          currency: intent.currency,
          failure_code: null,
          failure_message: null,
          reader_status: reader?.status ?? null,
          reader_action_status: 'idle',
        })
      }

      if (intent.status === 'canceled') {
        if (!finalRequestStatuses.has(request.status)) {
          await updatePaymentRequest(db, request.id, {
            status: 'cancelled',
            failure_code: intent.last_payment_error?.code ?? null,
            failure_message: intent.last_payment_error?.message ?? 'Payment cancelled',
            finalized_at: now,
            updated_at: now,
          })
        }
        if (reader) await syncReaderState(db, request, config, reader)
        return json({
          payment_request_id: request.id,
          status: request.status === 'succeeded' ? request.status : 'cancelled',
          payment_intent_id: intent.id,
          amount: intent.amount,
          currency: intent.currency,
          failure_code: intent.last_payment_error?.code ?? null,
          failure_message: intent.last_payment_error?.message ?? 'Payment cancelled',
          reader_status: reader?.status ?? null,
          reader_action_status: readerActionStatus,
        })
      }

      if (intent.status === 'requires_payment_method') {
        // Stripe can briefly expose requires_payment_method while the Reader
        // action is still active. The live Reader state wins over this
        // temporary PaymentIntent state.
        if (readerActionStatus === 'in_progress') {
          const status = processingStatus(request.status)
          if (!finalRequestStatuses.has(request.status)) {
            await updatePaymentRequest(db, request.id, {
              status,
              failure_code: null,
              failure_message: null,
              reader_action_status: 'in_progress',
              last_reconciled_at: now,
              updated_at: now,
            })
          }
          if (reader) await syncReaderState(db, request, config, reader)
          return json({ payment_request_id: request.id, status, payment_intent_id: intent.id, amount: intent.amount, currency: intent.currency, failure_code: null, failure_message: null, reader_status: reader?.status ?? null, reader_action_status: readerActionStatus })
        }

        const confirmedFailure = readerActionStatus === 'failed' || Boolean(intent.last_payment_error)
        if (confirmedFailure) {
          if (!finalRequestStatuses.has(request.status)) {
            await updatePaymentRequest(db, request.id, {
              status: 'failed',
              failure_code: intent.last_payment_error?.code ?? reader?.action?.failure_code ?? 'payment_declined',
              failure_message: intent.last_payment_error?.message ?? reader?.action?.failure_message ?? 'Payment declined',
              reader_action_status: readerActionStatus === 'failed' ? 'failed' : request.reader_action_status,
              finalized_at: now,
              updated_at: now,
            })
          }
          if (reader) await syncReaderState(db, request, config, reader)
          return json({ payment_request_id: request.id, status: request.status === 'succeeded' ? request.status : 'failed', payment_intent_id: intent.id, amount: intent.amount, currency: intent.currency, failure_code: intent.last_payment_error?.code ?? reader?.action?.failure_code ?? 'payment_declined', failure_message: intent.last_payment_error?.message ?? reader?.action?.failure_message ?? 'Payment declined', reader_status: reader?.status ?? null, reader_action_status: readerActionStatus })
        }

        const status = processingStatus(request.status)
        if (!finalRequestStatuses.has(request.status)) {
          await updatePaymentRequest(db, request.id, { status, last_reconciled_at: now, updated_at: now })
        }
        if (reader) await syncReaderState(db, request, config, reader)
        return json({ payment_request_id: request.id, status, payment_intent_id: intent.id, amount: intent.amount, currency: intent.currency, failure_code: null, failure_message: null, reader_status: reader?.status ?? null, reader_action_status: readerActionStatus })
      }

      if (['processing', 'requires_action', 'requires_confirmation'].includes(intent.status)) {
        const status = processingStatus(request.status)
        if (!finalRequestStatuses.has(request.status)) await updatePaymentRequest(db, request.id, { status, last_reconciled_at: now, updated_at: now })
        if (reader) await syncReaderState(db, request, config, reader)
        return json({ payment_request_id: request.id, status, payment_intent_id: intent.id, amount: intent.amount, currency: intent.currency, failure_code: null, failure_message: null, reader_status: reader?.status ?? null, reader_action_status: readerActionStatus })
      }

      return json({ payment_request_id: request.id, status: request.status, payment_intent_id: intent.id, amount: intent.amount, currency: intent.currency, failure_code: request.failure_code, failure_message: request.failure_message, reader_status: reader?.status ?? null, reader_action_status: readerActionStatus })
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
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Payment status reconciliation failed' }, 400)
  }
})
