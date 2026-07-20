-- Migration: Additive RPC functions for Cash + Card split payments (Drawer-free)

-- 1. Function to start a split payment atomically with DB-enforced idempotency
CREATE OR REPLACE FUNCTION public.create_split_payment(
  p_order_id UUID,
  p_cash_amount_cents BIGINT,
  p_card_amount_cents BIGINT,
  p_idempotency_key TEXT,
  p_pos_device_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_split public.payment_splits;
  v_cash_part public.payment_split_parts;
  v_card_part public.payment_split_parts;
  v_cash_payment public.payments;
  v_config public.restaurant_payment_configs;
  v_request public.payment_requests;
  v_total_cents BIGINT;
  v_flag BOOLEAN;
  v_existing_split public.payment_splits;
  v_loc_id UUID;
BEGIN
  -- 1. Check idempotency key first
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;

  SELECT * INTO v_existing_split FROM public.payment_splits WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_request FROM public.payment_requests WHERE order_id = v_existing_split.order_id ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'split_id', v_existing_split.id,
      'card_payment_request_id', v_request.id,
      'status', v_existing_split.status,
      'is_duplicate', true
    );
  END IF;

  -- 2. Lock and fetch order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  -- Authorization check
  IF NOT (
    EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = v_order.store_id AND su.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = v_order.store_id AND d.status::text = 'active')
    OR (SELECT public.is_superadmin())
    OR (SELECT auth.role()) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Not allowed to create a split payment for this order';
  END IF;

  -- 3. Feature flag check
  SELECT split_payment_enabled INTO v_flag FROM public.stores WHERE id = v_order.store_id;
  IF COALESCE(v_flag, false) = false THEN
    RAISE EXCEPTION 'Split payment feature is not enabled for this restaurant';
  END IF;

  -- 4. Confirm order is unpaid
  IF v_order.status NOT IN ('new', 'pending', 'partially_paid') THEN
    RAISE EXCEPTION 'Order is not in an unpaid state';
  END IF;

  -- 5. Amount validation using integer cents
  v_total_cents := round(v_order.total_amount * 100);
  IF p_cash_amount_cents <= 0 OR p_card_amount_cents <= 0 THEN
    RAISE EXCEPTION 'A split payment must contain positive cash and card amounts';
  END IF;
  IF (p_cash_amount_cents + p_card_amount_cents) <> v_total_cents THEN
    RAISE EXCEPTION 'Cash and card amounts do not equal the order total exactly';
  END IF;

  -- 6. Find terminal card payment config
  SELECT * INTO v_config FROM public.restaurant_payment_configs
  WHERE (location_id = v_order.store_id OR location_id IN (SELECT id FROM public.restaurant_locations WHERE store_id = v_order.store_id))
    AND provider_type = 'stripe_android_bridge' AND is_enabled LIMIT 1;
  
  v_loc_id := COALESCE(v_config.location_id, v_order.store_id);

  IF v_config.id IS NULL THEN
    RAISE EXCEPTION 'Card terminal is not configured for this location';
  END IF;

  -- 7. Create split header record
  INSERT INTO public.payment_splits (
    restaurant_id, location_id, store_id, order_id, total_amount_cents, currency, status, idempotency_key, created_by, cash_confirmed_by, cash_confirmed_at
  ) VALUES (
    v_loc_id, v_loc_id, v_order.store_id, v_order.id, v_total_cents, COALESCE(v_order.currency, 'EUR'),
    'awaiting_card', p_idempotency_key, (SELECT auth.uid()), (SELECT auth.uid()), now()
  ) RETURNING * INTO v_split;

  -- 8. Create cash split part (succeeded)
  INSERT INTO public.payment_split_parts (
    split_id, order_id, method, amount_cents, status, completed_at
  ) VALUES (
    v_split.id, v_order.id, 'cash', p_cash_amount_cents, 'succeeded', now()
  ) RETURNING * INTO v_cash_part;

  -- Record cash payment row in payments table
  INSERT INTO public.payments (
    store_id, order_id, method, status, amount, paid_at
  ) VALUES (
    v_order.store_id, v_order.id, 'cash', 'paid', (p_cash_amount_cents / 100.0), now()
  ) RETURNING * INTO v_cash_payment;

  UPDATE public.payment_split_parts SET payment_id = v_cash_payment.id WHERE id = v_cash_part.id;

  -- Update order status to partially_paid
  UPDATE public.orders SET status = 'partially_paid' WHERE id = v_order.id;

  -- 9. Create card split part (pending)
  INSERT INTO public.payment_split_parts (
    split_id, order_id, method, amount_cents, status
  ) VALUES (
    v_split.id, v_order.id, 'card', p_card_amount_cents, 'pending'
  ) RETURNING * INTO v_card_part;

  -- Create card payment_request for card_amount_cents ONLY
  INSERT INTO public.payment_requests (
    restaurant_id, location_id, order_id, payment_config_id, provider_type, status, idempotency_key, amount_cents, split_part_id
  ) VALUES (
    v_loc_id, v_loc_id, v_order.id, v_config.id, v_config.provider_type, 'pending',
    'split-card:' || v_card_part.id::text, p_card_amount_cents, v_card_part.id
  ) RETURNING * INTO v_request;

  UPDATE public.payment_split_parts SET payment_request_id = v_request.id WHERE id = v_card_part.id;

  RETURN jsonb_build_object(
    'split_id', v_split.id,
    'card_payment_request_id', v_request.id,
    'cash_part_id', v_cash_part.id,
    'card_part_id', v_card_part.id,
    'status', 'awaiting_card',
    'cash_amount_cents', p_cash_amount_cents,
    'card_amount_cents', p_card_amount_cents,
    'is_duplicate', false
  );
END;
$$;


-- 2. Function to finalize card payment part when card payment succeeds
CREATE OR REPLACE FUNCTION public.finalize_split_card_payment(
  p_payment_request_id UUID,
  p_provider_reference TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.payment_requests;
  v_split_part public.payment_split_parts;
  v_split public.payment_splits;
  v_order public.orders;
  v_card_payment public.payments;
  v_succeeded_cents BIGINT;
BEGIN
  SELECT * INTO v_request FROM public.payment_requests WHERE id = p_payment_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;

  SELECT * INTO v_split_part FROM public.payment_split_parts WHERE id = v_request.split_part_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_split_part FROM public.payment_split_parts WHERE payment_request_id = p_payment_request_id FOR UPDATE;
  END IF;

  IF v_split_part IS NULL THEN
    -- Fallback for legacy single card flow
    PERFORM public.complete_accounting_card_payment(v_request.order_id, p_provider_reference, 0);
    RETURN jsonb_build_object('status', 'succeeded', 'legacy', true);
  END IF;

  IF v_split_part.status = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'succeeded', 'is_duplicate', true);
  END IF;

  SELECT * INTO v_split FROM public.payment_splits WHERE id = v_split_part.split_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id = v_split.order_id FOR UPDATE;

  -- 1. Mark card split part succeeded
  UPDATE public.payment_split_parts
  SET status = 'succeeded', provider_reference = p_provider_reference, completed_at = now(), updated_at = now()
  WHERE id = v_split_part.id;

  -- 2. Create card row in payments table
  INSERT INTO public.payments (
    store_id, order_id, method, status, amount, provider, provider_reference, paid_at
  ) VALUES (
    v_order.store_id, v_order.id, 'card', 'paid', (v_split_part.amount_cents / 100.0), 'stripe', p_provider_reference, now()
  ) RETURNING * INTO v_card_payment;

  UPDATE public.payment_split_parts SET payment_id = v_card_payment.id WHERE id = v_split_part.id;

  -- 3. Sum succeeded parts
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_succeeded_cents
  FROM public.payment_split_parts
  WHERE split_id = v_split.id AND status = 'succeeded';

  -- 4. Complete split & order if totals match
  IF v_succeeded_cents >= v_split.total_amount_cents THEN
    UPDATE public.payment_splits SET status = 'succeeded', completed_at = now(), updated_at = now() WHERE id = v_split.id;
    UPDATE public.orders SET status = 'completed', completed_at = COALESCE(completed_at, now()) WHERE id = v_order.id;
    RETURN jsonb_build_object('status', 'succeeded', 'order_completed', true);
  ELSE
    UPDATE public.payment_splits SET status = 'partially_paid', updated_at = now() WHERE id = v_split.id;
    RETURN jsonb_build_object('status', 'partially_paid', 'order_completed', false, 'succeeded_cents', v_succeeded_cents);
  END IF;
END;
$$;


-- 3. Function to retry card payment on a split
CREATE OR REPLACE FUNCTION public.retry_split_card_payment(
  p_split_id UUID,
  p_idempotency_key TEXT,
  p_pos_device_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_split public.payment_splits;
  v_order public.orders;
  v_config public.restaurant_payment_configs;
  v_active_request public.payment_requests;
  v_new_card_part public.payment_split_parts;
  v_request public.payment_requests;
  v_remaining_cents BIGINT;
  v_succeeded_cents BIGINT;
  v_loc_id UUID;
BEGIN
  SELECT * INTO v_split FROM public.payment_splits WHERE id = p_split_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Split record not found'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_split.order_id FOR UPDATE;

  -- Check if an active non-final request already exists for this order/split
  SELECT * INTO v_active_request FROM public.payment_requests
  WHERE order_id = v_order.id AND status IN ('pending', 'claimed', 'creating_payment_intent', 'waiting_for_card', 'processing', 'cancel_requested');

  IF FOUND THEN
    RAISE EXCEPTION 'An active card payment request is already in progress for this order';
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_succeeded_cents
  FROM public.payment_split_parts WHERE split_id = v_split.id AND status = 'succeeded';

  v_remaining_cents := v_split.total_amount_cents - v_succeeded_cents;
  IF v_remaining_cents <= 0 THEN RAISE EXCEPTION 'Order is already fully paid'; END IF;

  SELECT * INTO v_config FROM public.restaurant_payment_configs
  WHERE (location_id = v_order.store_id OR location_id IN (SELECT id FROM public.restaurant_locations WHERE store_id = v_order.store_id))
    AND provider_type = 'stripe_android_bridge' AND is_enabled LIMIT 1;

  v_loc_id := COALESCE(v_config.location_id, v_order.store_id);

  IF v_config.id IS NULL THEN RAISE EXCEPTION 'Card terminal is not configured for this location'; END IF;

  -- Create a new card split part
  INSERT INTO public.payment_split_parts (
    split_id, order_id, method, amount_cents, status
  ) VALUES (
    v_split.id, v_order.id, 'card', v_remaining_cents, 'pending'
  ) RETURNING * INTO v_new_card_part;

  -- Create new payment request
  INSERT INTO public.payment_requests (
    restaurant_id, location_id, order_id, payment_config_id, provider_type, status, idempotency_key, amount_cents, split_part_id
  ) VALUES (
    v_loc_id, v_loc_id, v_order.id, v_config.id, v_config.provider_type, 'pending',
    COALESCE(p_idempotency_key, 'split-card-retry:' || v_new_card_part.id::text), v_remaining_cents, v_new_card_part.id
  ) RETURNING * INTO v_request;

  UPDATE public.payment_split_parts SET payment_request_id = v_request.id WHERE id = v_new_card_part.id;
  UPDATE public.payment_splits SET status = 'awaiting_card', updated_at = now() WHERE id = v_split.id;

  RETURN jsonb_build_object(
    'split_id', v_split.id,
    'card_payment_request_id', v_request.id,
    'card_part_id', v_new_card_part.id,
    'remaining_amount_cents', v_remaining_cents
  );
END;
$$;


-- 4. Function to pay remaining split amount in cash
CREATE OR REPLACE FUNCTION public.pay_remaining_split_in_cash(
  p_split_id UUID,
  p_pos_device_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_split public.payment_splits;
  v_order public.orders;
  v_cash_part public.payment_split_parts;
  v_cash_payment public.payments;
  v_succeeded_cents BIGINT;
  v_remaining_cents BIGINT;
BEGIN
  SELECT * INTO v_split FROM public.payment_splits WHERE id = p_split_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Split record not found'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_split.order_id FOR UPDATE;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_succeeded_cents
  FROM public.payment_split_parts WHERE split_id = v_split.id AND status = 'succeeded';

  v_remaining_cents := v_split.total_amount_cents - v_succeeded_cents;
  IF v_remaining_cents <= 0 THEN RAISE EXCEPTION 'Order is already fully paid'; END IF;

  -- Cancel any pending card requests for this split
  UPDATE public.payment_requests SET status = 'cancelled', updated_at = now()
  WHERE split_part_id IN (SELECT id FROM public.payment_split_parts WHERE split_id = v_split.id AND status = 'pending');

  UPDATE public.payment_split_parts SET status = 'cancelled', updated_at = now()
  WHERE split_id = v_split.id AND status = 'pending';

  -- Create additional cash part for remaining amount
  INSERT INTO public.payment_split_parts (
    split_id, order_id, method, amount_cents, status, completed_at
  ) VALUES (
    v_split.id, v_order.id, 'cash', v_remaining_cents, 'succeeded', now()
  ) RETURNING * INTO v_cash_part;

  -- Insert cash payment row
  INSERT INTO public.payments (
    store_id, order_id, method, status, amount, paid_at
  ) VALUES (
    v_order.store_id, v_order.id, 'cash', 'paid', (v_remaining_cents / 100.0), now()
  ) RETURNING * INTO v_cash_payment;

  UPDATE public.payment_split_parts SET payment_id = v_cash_payment.id WHERE id = v_cash_part.id;

  -- Complete split and order
  UPDATE public.payment_splits SET status = 'succeeded', completed_at = now(), updated_at = now() WHERE id = v_split.id;
  UPDATE public.orders SET status = 'completed', completed_at = COALESCE(completed_at, now()) WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'split_id', v_split.id,
    'status', 'succeeded',
    'cash_added_cents', v_remaining_cents,
    'order_completed', true
  );
END;
$$;


-- 5. Function to cancel a split payment
CREATE OR REPLACE FUNCTION public.cancel_split_payment(
  p_split_id UUID,
  p_confirm_cash_returned BOOLEAN DEFAULT false,
  p_pos_device_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_split public.payment_splits;
  v_order public.orders;
  v_has_succeeded_cash BOOLEAN;
  v_has_succeeded_card BOOLEAN;
BEGIN
  SELECT * INTO v_split FROM public.payment_splits WHERE id = p_split_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Split record not found'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_split.order_id FOR UPDATE;

  SELECT EXISTS (SELECT 1 FROM public.payment_split_parts WHERE split_id = v_split.id AND method = 'cash' AND status = 'succeeded') INTO v_has_succeeded_cash;
  SELECT EXISTS (SELECT 1 FROM public.payment_split_parts WHERE split_id = v_split.id AND method = 'card' AND status = 'succeeded') INTO v_has_succeeded_card;

  IF v_has_succeeded_card THEN
    RAISE EXCEPTION 'Card payment has already succeeded. Use the standard refund flow to cancel card payments.';
  END IF;

  IF v_has_succeeded_cash AND NOT p_confirm_cash_returned THEN
    RAISE EXCEPTION 'Cash was already collected. You must explicitly confirm that cash was returned to the customer.';
  END IF;

  -- Cancel pending payment requests
  UPDATE public.payment_requests SET status = 'cancelled', updated_at = now()
  WHERE split_part_id IN (SELECT id FROM public.payment_split_parts WHERE split_id = v_split.id AND status = 'pending');

  -- Mark pending/succeeded cash parts as cancelled if cash returned confirmed
  UPDATE public.payment_split_parts SET status = 'cancelled', updated_at = now() WHERE split_id = v_split.id;

  -- Cancel split header
  UPDATE public.payment_splits SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = v_split.id;

  -- Revert order status to pending
  UPDATE public.orders SET status = 'pending' WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'split_id', v_split.id,
    'status', 'cancelled',
    'cash_returned', p_confirm_cash_returned
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.create_split_payment(UUID, BIGINT, BIGINT, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_split_card_payment(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retry_split_card_payment(UUID, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pay_remaining_split_in_cash(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_split_payment(UUID, BOOLEAN, UUID) TO anon, authenticated, service_role;
