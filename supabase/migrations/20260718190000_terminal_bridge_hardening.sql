CREATE OR REPLACE FUNCTION public.request_terminal_card_payment(p_order_id UUID, p_pos_device_id UUID DEFAULT NULL)
RETURNS public.payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders; v_config public.restaurant_payment_configs; v_request public.payment_requests;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT (
    is_location_member(v_order.location_id)
    OR EXISTS (SELECT 1 FROM pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = v_order.store_id AND d.status::text = 'active')
  ) THEN RAISE EXCEPTION 'Order not available'; END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'Order is not awaiting card payment'; END IF;
  IF EXISTS (
    SELECT 1 FROM payment_requests pr
    WHERE pr.location_id = v_order.location_id
      AND pr.order_id <> v_order.id
      AND pr.status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      AND pr.expires_at > now()
  ) THEN RAISE EXCEPTION 'Another terminal payment is already active for this location'; END IF;
  SELECT * INTO v_config FROM restaurant_payment_configs
    WHERE location_id = v_order.location_id AND provider_type = 'stripe_android_bridge' AND is_enabled LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card terminal is not configured for this location'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM terminal_devices d
    WHERE d.location_id = v_order.location_id
      AND d.payment_config_id = v_config.id
      AND d.status = 'online'
      AND d.reader_status = 'connected'
      AND d.last_heartbeat_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Card payment bridge or reader is unavailable';
  END IF;
  INSERT INTO payment_requests(restaurant_id, location_id, order_id, payment_config_id, provider_type, idempotency_key)
  VALUES (v_order.restaurant_id, v_order.location_id, v_order.id, v_config.id, v_config.provider_type, 'terminal-payment:' || v_order.id::text)
  ON CONFLICT (order_id) DO UPDATE SET updated_at = now() RETURNING * INTO v_request;
  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.terminal_payment_availability(p_store_id UUID, p_pos_device_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_location public.restaurant_locations; v_available BOOLEAN; v_active BOOLEAN;
BEGIN
  SELECT * INTO v_location FROM restaurant_locations WHERE store_id = p_store_id;
  IF NOT FOUND OR NOT (is_location_member(v_location.id) OR EXISTS (SELECT 1 FROM pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = p_store_id AND d.status::text = 'active')) THEN
    RAISE EXCEPTION 'Not allowed to inspect terminal availability';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM terminal_devices d JOIN restaurant_payment_configs c ON c.id = d.payment_config_id
    WHERE d.location_id = v_location.id
      AND d.status = 'online'
      AND d.reader_status = 'connected'
      AND d.last_heartbeat_at > now() - interval '60 seconds'
      AND c.provider_type = 'stripe_android_bridge'
      AND c.is_enabled
  ) INTO v_available;
  SELECT EXISTS (
    SELECT 1 FROM payment_requests pr
    WHERE pr.location_id = v_location.id
      AND pr.status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      AND pr.expires_at > now()
  ) INTO v_active;
  RETURN jsonb_build_object('available', v_available AND NOT v_active, 'reader_online', v_available, 'active_payment', v_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_terminal_payment_request(p_payment_request_id UUID)
RETURNS public.payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_device public.terminal_devices; v_request public.payment_requests;
BEGIN
  SELECT * INTO v_device FROM terminal_devices
  WHERE bridge_user_id = (SELECT auth.uid())
    AND status = 'online'
    AND reader_status = 'connected'
    AND last_heartbeat_at > now() - interval '60 seconds'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered online reader bridge required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_device.id::text));
  UPDATE payment_requests SET status = 'claimed', claimed_by_device_id = v_device.id, claimed_at = now(), updated_at = now()
  WHERE id = p_payment_request_id AND location_id = v_device.location_id AND status = 'pending' AND expires_at > now()
  RETURNING * INTO v_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request is no longer claimable'; END IF;
  RETURN v_request;
END;
$$;

DO $$ BEGIN
  CREATE POLICY "Restaurant members can create terminal enrollment codes"
  ON public.terminal_enrollment_codes FOR INSERT TO authenticated
  WITH CHECK (is_location_member(location_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
