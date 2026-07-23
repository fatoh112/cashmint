-- Recover the POS after final WisePOS E cancellations without creating a second
-- order. Payment attempts are append-only after a final request state so the
-- original request and its Stripe PaymentIntent remain auditable.

CREATE OR REPLACE FUNCTION public.request_terminal_card_payment(
  p_order_id UUID,
  p_pos_device_id UUID DEFAULT NULL
)
RETURNS public.payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders;
  v_location public.restaurant_locations;
  v_config public.restaurant_payment_configs;
  v_latest public.payment_requests;
  v_request public.payment_requests;
  v_attempt INTEGER;
  v_idempotency_key TEXT;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not awaiting card payment';
  END IF;

  SELECT * INTO v_location
  FROM public.restaurant_locations
  WHERE store_id = v_order.store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store has no restaurant payment location';
  END IF;

  IF NOT (
    public.is_location_member(v_location.id)
    OR EXISTS (
      SELECT 1 FROM public.pos_devices
      WHERE id = p_pos_device_id AND store_id = v_order.store_id AND status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'Order not available';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_requests
    WHERE location_id = v_location.id
      AND order_id <> p_order_id
      AND status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Another terminal payment is already active for this location';
  END IF;

  SELECT * INTO v_config
  FROM public.restaurant_payment_configs
  WHERE location_id = v_location.id
    AND is_primary = true
    AND is_enabled
    AND provider_type IN ('stripe_android_bridge','stripe_server_driven')
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card terminal is not configured for this location';
  END IF;

  IF v_config.provider_type = 'stripe_android_bridge' AND NOT EXISTS (
    SELECT 1 FROM public.terminal_devices
    WHERE location_id = v_location.id
      AND payment_config_id = v_config.id
      AND status = 'online'
      AND reader_status = 'connected'
      AND last_heartbeat_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Card payment bridge or reader is unavailable';
  END IF;

  IF v_config.provider_type = 'stripe_server_driven' AND NOT EXISTS (
    SELECT 1
    FROM public.stripe_terminal_readers r
    WHERE r.location_id = v_location.id
      AND r.payment_config_id = v_config.id
      AND r.is_enabled
      AND r.status = 'online'
      AND (
        coalesce(r.action_status, 'idle') NOT IN ('in_progress','processing')
        OR NOT EXISTS (
          SELECT 1 FROM public.payment_requests pr
          WHERE pr.location_id = v_location.id
            AND pr.stripe_reader_id = r.stripe_reader_id
            AND pr.status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
            AND pr.expires_at > now()
        )
      )
  ) THEN
    RAISE EXCEPTION 'WisePOS E reader is unavailable or busy';
  END IF;

  SELECT * INTO v_latest
  FROM public.payment_requests
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_latest.status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
     AND v_latest.expires_at > now() THEN
    RETURN v_latest;
  END IF;

  IF FOUND AND v_latest.status = 'succeeded' THEN
    RAISE EXCEPTION 'Order already has a succeeded card payment';
  END IF;

  IF FOUND THEN
    SELECT coalesce(max(process_attempt_count), 0) + 1 INTO v_attempt
    FROM public.payment_requests
    WHERE order_id = p_order_id;
    v_idempotency_key := 'terminal-payment:' || p_order_id::text || ':attempt:' || v_attempt::text;
  ELSE
    v_idempotency_key := 'terminal-payment:' || p_order_id::text;
  END IF;

  INSERT INTO public.payment_requests(
    restaurant_id, location_id, order_id, payment_config_id, provider_type,
    idempotency_key, process_attempt_count
  ) VALUES (
    v_location.restaurant_id, v_location.id, p_order_id, v_config.id,
    v_config.provider_type, v_idempotency_key, 0
  )
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pending_order_in_cash(
  p_order_id UUID,
  p_pos_device_id UUID DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders;
  v_cash_payment public.payments;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = v_order.store_id AND d.status = 'active')
    OR EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = v_order.store_id AND su.user_id = (SELECT auth.uid()))
    OR (SELECT public.is_superadmin())
    OR (SELECT auth.role()) = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
  ) THEN
    RAISE EXCEPTION 'Not allowed to complete this order in cash';
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN v_order;
  END IF;
  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending orders can be completed in cash';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_requests
    WHERE order_id = p_order_id
      AND status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
  ) THEN
    RAISE EXCEPTION 'An active card payment must be cancelled before switching to cash';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE order_id = p_order_id AND method = 'card' AND status = 'paid'
  ) THEN
    RAISE EXCEPTION 'A card payment has already succeeded for this order';
  END IF;

  UPDATE public.payments
  SET status = 'cancelled'
  WHERE order_id = p_order_id AND method = 'card' AND status = 'pending';

  SELECT * INTO v_cash_payment
  FROM public.payments
  WHERE order_id = p_order_id AND method = 'cash' AND status = 'paid'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.payments(store_id, order_id, method, status, amount, paid_at)
    VALUES (v_order.store_id, p_order_id, 'cash', 'paid', v_order.total_amount, now())
    RETURNING * INTO v_cash_payment;
  END IF;

  UPDATE public.orders
  SET status = 'completed', completed_at = coalesce(completed_at, now())
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.request_terminal_card_payment(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_terminal_card_payment(UUID, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_pending_order_in_cash(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_pending_order_in_cash(UUID, UUID) TO anon, authenticated;
