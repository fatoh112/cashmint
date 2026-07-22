-- Retry-safe Stripe Terminal webhook state. Existing rows represent events
-- handled by the previous implementation and remain processed.
ALTER TABLE public.stripe_terminal_webhook_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.stripe_terminal_webhook_events
  ALTER COLUMN processed_at DROP NOT NULL,
  ALTER COLUMN processed_at DROP DEFAULT;

ALTER TABLE public.stripe_terminal_webhook_events
  DROP CONSTRAINT IF EXISTS stripe_terminal_webhook_events_status_check;
ALTER TABLE public.stripe_terminal_webhook_events
  ADD CONSTRAINT stripe_terminal_webhook_events_status_check
  CHECK (status IN ('processing', 'processed', 'failed'));

UPDATE public.stripe_terminal_webhook_events
SET status = 'processed',
    attempt_count = GREATEST(attempt_count, 1),
    updated_at = COALESCE(updated_at, now())
WHERE processed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_terminal_webhook_events_retry
  ON public.stripe_terminal_webhook_events(status, updated_at);

-- Atomically claim a new, failed, or stale processing event. A processed event
-- is never claimed again, while a failed event remains retryable by Stripe.
CREATE OR REPLACE FUNCTION public.claim_stripe_terminal_webhook_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_livemode BOOLEAN,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_claimed BOOLEAN;
BEGIN
  INSERT INTO public.stripe_terminal_webhook_events(
    event_id, event_type, livemode, status, attempt_count,
    processing_started_at, last_error, updated_at, metadata
  ) VALUES (
    p_event_id, p_event_type, COALESCE(p_livemode, false), 'processing', 1,
    now(), NULL, now(), COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (event_id) DO UPDATE
  SET status = 'processing',
      attempt_count = public.stripe_terminal_webhook_events.attempt_count + 1,
      processing_started_at = now(),
      last_error = NULL,
      updated_at = now(),
      event_type = EXCLUDED.event_type,
      livemode = EXCLUDED.livemode,
      metadata = EXCLUDED.metadata
  WHERE public.stripe_terminal_webhook_events.status = 'failed'
     OR (
       public.stripe_terminal_webhook_events.status = 'processing'
       AND public.stripe_terminal_webhook_events.processing_started_at < now() - interval '5 minutes'
     )
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stripe_terminal_webhook_processed(p_event_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.stripe_terminal_webhook_events
  SET status = 'processed', processed_at = now(), processing_started_at = NULL,
      last_error = NULL, updated_at = now()
  WHERE event_id = p_event_id AND status <> 'processed';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stripe_terminal_webhook_failed(p_event_id TEXT, p_error TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.stripe_terminal_webhook_events
  SET status = 'failed', processed_at = NULL, last_error = left(COALESCE(p_error, 'Webhook processing failed'), 500),
      processing_started_at = NULL, updated_at = now()
  WHERE event_id = p_event_id AND status <> 'processed';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_terminal_webhook_event(TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_stripe_terminal_webhook_processed(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_stripe_terminal_webhook_failed(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_terminal_webhook_event(TEXT, TEXT, BOOLEAN, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stripe_terminal_webhook_processed(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stripe_terminal_webhook_failed(TEXT, TEXT) TO service_role;

-- Correct split completion so the provider reference uniqueness constraint and
-- row locks make duplicate Stripe deliveries a no-op.
CREATE OR REPLACE FUNCTION public.finalize_split_card_payment(
  p_payment_request_id UUID,
  p_provider_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_request public.payment_requests;
  v_split_part public.payment_split_parts;
  v_split public.payment_splits;
  v_order public.orders;
  v_card_payment public.payments;
  v_existing_payment public.payments;
  v_succeeded_cents BIGINT;
BEGIN
  IF NULLIF(trim(p_provider_reference), '') IS NULL THEN
    RAISE EXCEPTION 'Provider reference is required';
  END IF;

  SELECT * INTO v_request FROM public.payment_requests WHERE id = p_payment_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;

  SELECT * INTO v_split_part
  FROM public.payment_split_parts
  WHERE id = v_request.split_part_id OR payment_request_id = p_payment_request_id
  ORDER BY (id = v_request.split_part_id) DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.complete_accounting_card_payment(v_request.order_id, p_provider_reference, 0);
    RETURN jsonb_build_object('status', 'succeeded', 'legacy', true);
  END IF;

  IF v_split_part.status = 'succeeded' THEN
    IF v_split_part.provider_reference IS DISTINCT FROM p_provider_reference THEN
      RAISE EXCEPTION 'Split part is already assigned to another provider reference';
    END IF;
    RETURN jsonb_build_object('status', 'succeeded', 'is_duplicate', true);
  END IF;

  SELECT * INTO v_split FROM public.payment_splits WHERE id = v_split_part.split_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id = v_split.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Split order not found'; END IF;

  SELECT * INTO v_existing_payment
  FROM public.payments
  WHERE provider = 'stripe' AND provider_reference = p_provider_reference
  FOR UPDATE;
  IF FOUND AND v_existing_payment.order_id <> v_order.id THEN
    RAISE EXCEPTION 'Provider reference is already assigned to another order';
  END IF;

  IF v_existing_payment.id IS NULL THEN
    INSERT INTO public.payments(
      store_id, order_id, method, status, amount, provider, provider_reference, paid_at,
      processor_fee, net_settlement
    ) VALUES (
      v_order.store_id, v_order.id, 'card', 'paid', v_split_part.amount_cents / 100.0,
      'stripe', p_provider_reference, now(), 0, v_split_part.amount_cents / 100.0
    ) RETURNING * INTO v_card_payment;
  ELSE
    v_card_payment := v_existing_payment;
  END IF;

  UPDATE public.payment_split_parts
  SET status = 'succeeded', provider_reference = p_provider_reference,
      payment_id = v_card_payment.id, completed_at = COALESCE(completed_at, now()), updated_at = now()
  WHERE id = v_split_part.id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_succeeded_cents
  FROM public.payment_split_parts WHERE split_id = v_split.id AND status = 'succeeded';

  IF v_succeeded_cents >= v_split.total_amount_cents THEN
    UPDATE public.payment_splits
    SET status = 'succeeded', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_split.id;
    UPDATE public.orders
    SET status = 'completed', completed_at = COALESCE(completed_at, now())
    WHERE id = v_order.id;
    RETURN jsonb_build_object('status', 'succeeded', 'order_completed', true);
  END IF;

  UPDATE public.payment_splits SET status = 'partially_paid', updated_at = now() WHERE id = v_split.id;
  RETURN jsonb_build_object('status', 'partially_paid', 'order_completed', false, 'succeeded_cents', v_succeeded_cents);
END;
$$;

-- One trusted transaction for both webhook and polling reconciliation. The
-- request is not marked succeeded until accounting completion succeeds.
CREATE OR REPLACE FUNCTION public.complete_terminal_payment(
  p_payment_request_id UUID,
  p_provider_reference TEXT,
  p_processor_fee NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_request public.payment_requests;
  v_result JSONB;
BEGIN
  IF NULLIF(trim(p_provider_reference), '') IS NULL THEN
    RAISE EXCEPTION 'Provider reference is required';
  END IF;

  SELECT * INTO v_request FROM public.payment_requests WHERE id = p_payment_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;
  IF v_request.stripe_payment_intent_id IS DISTINCT FROM p_provider_reference THEN
    RAISE EXCEPTION 'PaymentIntent reference does not match payment request';
  END IF;

  IF v_request.split_part_id IS NOT NULL THEN
    v_result := public.finalize_split_card_payment(p_payment_request_id, p_provider_reference);
  ELSE
    PERFORM public.complete_accounting_card_payment(v_request.order_id, p_provider_reference, COALESCE(p_processor_fee, 0));
    v_result := jsonb_build_object('status', 'succeeded', 'order_completed', true);
  END IF;

  UPDATE public.payment_requests
  SET status = 'succeeded', failure_code = NULL, failure_message = NULL,
      reader_action_status = 'succeeded', finalized_at = COALESCE(finalized_at, now()),
      last_reconciled_at = now(), updated_at = now()
  WHERE id = v_request.id;

  IF v_request.stripe_reader_id IS NOT NULL THEN
    UPDATE public.stripe_terminal_readers
    SET action_status = 'idle', action_type = NULL, last_synced_at = now(), updated_at = now()
    WHERE stripe_reader_id = v_request.stripe_reader_id;
  END IF;
  RETURN v_result || jsonb_build_object('payment_request_id', v_request.id);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_terminal_payment(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_terminal_payment(UUID, TEXT, NUMERIC) TO authenticated, service_role;
