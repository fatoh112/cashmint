-- Split-card terminal reconciliation guards.
-- This migration is additive and only changes future RPC executions. It does
-- not rewrite historical split headers, parts, payments, or orders.

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

  SELECT * INTO v_request
  FROM public.payment_requests
  WHERE id = p_payment_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;

  IF v_request.split_part_id IS NULL THEN
    PERFORM public.complete_accounting_card_payment(v_request.order_id, p_provider_reference, 0);
    RETURN jsonb_build_object('status', 'succeeded', 'legacy', true);
  END IF;

  SELECT * INTO v_split_part
  FROM public.payment_split_parts
  WHERE id = v_request.split_part_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Split card part not found'; END IF;
  IF v_split_part.order_id <> v_request.order_id OR v_split_part.method <> 'card' THEN
    RAISE EXCEPTION 'Split card part does not match the payment request';
  END IF;
  IF v_request.amount_cents IS NULL OR v_split_part.amount_cents <> v_request.amount_cents THEN
    RAISE EXCEPTION 'Split card amount does not match the payment request';
  END IF;

  SELECT * INTO v_split
  FROM public.payment_splits
  WHERE id = v_split_part.split_id
  FOR UPDATE;
  IF NOT FOUND OR v_split.order_id <> v_request.order_id THEN
    RAISE EXCEPTION 'Split record does not match the payment request';
  END IF;

  IF v_split_part.status = 'succeeded' THEN
    IF v_split_part.provider_reference IS DISTINCT FROM p_provider_reference THEN
      RAISE EXCEPTION 'Split part is already assigned to another provider reference';
    END IF;
    RETURN jsonb_build_object('status', 'succeeded', 'is_duplicate', true);
  END IF;
  IF v_split.status NOT IN ('awaiting_card', 'partially_paid') THEN
    RAISE EXCEPTION 'Split payment is no longer awaiting a card payment';
  END IF;
  IF v_split_part.status <> 'pending' AND v_split_part.status <> 'processing' THEN
    RAISE EXCEPTION 'Split card part is not payable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_split_parts
    WHERE split_id = v_split.id AND method = 'card'
      AND status = 'succeeded' AND id <> v_split_part.id
  ) THEN
    RAISE EXCEPTION 'A card payment already succeeded for this split';
  END IF;

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
      store_id, order_id, method, status, amount, provider, provider_reference,
      paid_at, processor_fee, net_settlement
    ) VALUES (
      v_order.store_id, v_order.id, 'card', 'paid', v_split_part.amount_cents / 100.0,
      'stripe', p_provider_reference, now(), 0, v_split_part.amount_cents / 100.0
    ) RETURNING * INTO v_card_payment;
  ELSE
    v_card_payment := v_existing_payment;
  END IF;

  UPDATE public.payment_split_parts
  SET status = 'succeeded', provider_reference = p_provider_reference,
      payment_id = v_card_payment.id, completed_at = COALESCE(completed_at, now()),
      failure_code = NULL, failure_message = NULL, updated_at = now()
  WHERE id = v_split_part.id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_succeeded_cents
  FROM public.payment_split_parts
  WHERE split_id = v_split.id AND status = 'succeeded';

  IF v_succeeded_cents >= v_split.total_amount_cents THEN
    UPDATE public.payment_splits
    SET status = 'succeeded', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_split.id;
    UPDATE public.orders
    SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('status', 'succeeded', 'order_completed', true);
  END IF;

  UPDATE public.payment_splits SET status = 'partially_paid', updated_at = now() WHERE id = v_split.id;
  RETURN jsonb_build_object('status', 'partially_paid', 'order_completed', false, 'succeeded_cents', v_succeeded_cents);
END;
$$;

-- Keep split parts recoverable when a terminal request reaches a final
-- unsuccessful state. Expired requests map to failed because the split-part
-- status constraint intentionally has no separate expired value.
CREATE OR REPLACE FUNCTION public.sync_terminal_split_card_failure(
  p_payment_request_id UUID,
  p_request_status TEXT,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_request public.payment_requests;
  v_part public.payment_split_parts;
  v_split public.payment_splits;
  v_part_status TEXT;
BEGIN
  IF p_request_status NOT IN ('failed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'Invalid unsuccessful terminal request status';
  END IF;

  SELECT * INTO v_request FROM public.payment_requests WHERE id = p_payment_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;
  IF v_request.split_part_id IS NULL THEN
    RETURN jsonb_build_object('status', 'ignored', 'legacy', true);
  END IF;

  SELECT * INTO v_part FROM public.payment_split_parts WHERE id = v_request.split_part_id FOR UPDATE;
  IF NOT FOUND OR v_part.order_id <> v_request.order_id OR v_part.method <> 'card' THEN
    RAISE EXCEPTION 'Split card part does not match the payment request';
  END IF;
  SELECT * INTO v_split FROM public.payment_splits WHERE id = v_part.split_id FOR UPDATE;
  IF NOT FOUND OR v_split.order_id <> v_request.order_id THEN
    RAISE EXCEPTION 'Split record does not match the payment request';
  END IF;

  IF v_part.status = 'succeeded' OR v_split.status = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'succeeded', 'ignored', true);
  END IF;

  v_part_status := CASE WHEN p_request_status = 'cancelled' THEN 'cancelled' ELSE 'failed' END;
  IF v_part.status IN ('pending', 'processing') THEN
    UPDATE public.payment_split_parts
    SET status = v_part_status, failure_code = p_failure_code,
        failure_message = p_failure_message, completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_part.id;
  END IF;

  UPDATE public.payment_requests
  SET status = p_request_status, failure_code = p_failure_code,
      failure_message = p_failure_message, finalized_at = COALESCE(finalized_at, now()),
      updated_at = now()
  WHERE id = v_request.id AND status <> 'succeeded';

  IF v_split.status NOT IN ('cancelled', 'succeeded') THEN
    UPDATE public.payment_splits SET status = 'awaiting_card', updated_at = now() WHERE id = v_split.id;
  END IF;
  RETURN jsonb_build_object('status', p_request_status, 'part_status', v_part_status, 'recoverable', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_terminal_split_card_failure(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_terminal_split_card_failure(UUID, TEXT, TEXT, TEXT) TO service_role;
