-- Reconcile stale WisePOS E action state only when no payment request is actually active.
-- The server-driven Edge Function still reads the live Stripe Reader before starting an action.

CREATE OR REPLACE FUNCTION public.request_terminal_card_payment(p_order_id UUID, p_pos_device_id UUID DEFAULT NULL)
RETURNS public.payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.orders; v_location public.restaurant_locations; v_config public.restaurant_payment_configs; v_request public.payment_requests;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'pending' THEN RAISE EXCEPTION 'Order is not awaiting card payment'; END IF;
  SELECT * INTO v_location FROM public.restaurant_locations WHERE store_id=v_order.store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store has no restaurant payment location'; END IF;
  IF NOT (public.is_location_member(v_location.id) OR EXISTS(SELECT 1 FROM public.pos_devices WHERE id=p_pos_device_id AND store_id=v_order.store_id AND status='active')) THEN RAISE EXCEPTION 'Order not available'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_requests WHERE location_id=v_location.id AND order_id<>p_order_id AND status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown') AND expires_at>now()) THEN RAISE EXCEPTION 'Another terminal payment is already active for this location'; END IF;
  SELECT * INTO v_config FROM public.restaurant_payment_configs WHERE location_id=v_location.id AND is_primary=true AND is_enabled AND provider_type IN('stripe_android_bridge','stripe_server_driven') LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card terminal is not configured for this location'; END IF;
  IF v_config.provider_type='stripe_android_bridge' AND NOT EXISTS(SELECT 1 FROM public.terminal_devices WHERE location_id=v_location.id AND payment_config_id=v_config.id AND status='online' AND reader_status='connected' AND last_heartbeat_at>now()-interval '60 seconds') THEN RAISE EXCEPTION 'Card payment bridge or reader is unavailable'; END IF;
  IF v_config.provider_type='stripe_server_driven' AND NOT EXISTS(
    SELECT 1 FROM public.stripe_terminal_readers r
    WHERE r.location_id=v_location.id AND r.payment_config_id=v_config.id AND r.is_enabled AND r.status='online'
      AND (
        COALESCE(r.action_status,'idle') NOT IN('in_progress','processing')
        OR NOT EXISTS(
          SELECT 1 FROM public.payment_requests pr
          WHERE pr.location_id=v_location.id AND pr.stripe_reader_id=r.stripe_reader_id
            AND pr.status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
            AND pr.expires_at>now()
        )
      )
  ) THEN RAISE EXCEPTION 'WisePOS E reader is unavailable or busy'; END IF;
  INSERT INTO public.payment_requests(restaurant_id,location_id,order_id,payment_config_id,provider_type,idempotency_key)
  VALUES(v_location.restaurant_id,v_location.id,p_order_id,v_config.id,v_config.provider_type,'terminal-payment:'||p_order_id::text)
  ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=now() RETURNING * INTO v_request;
  RETURN v_request;
END; $$;

CREATE OR REPLACE FUNCTION public.terminal_payment_availability(p_store_id UUID, p_pos_device_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_location public.restaurant_locations; v_config public.restaurant_payment_configs; v_reader public.stripe_terminal_readers; v_active BOOLEAN; v_reader_has_active_payment BOOLEAN;
BEGIN
  SELECT * INTO v_location FROM public.restaurant_locations WHERE store_id=p_store_id;
  IF NOT FOUND OR NOT(public.is_location_member(v_location.id) OR EXISTS(SELECT 1 FROM public.pos_devices WHERE id=p_pos_device_id AND store_id=p_store_id AND status='active')) THEN RAISE EXCEPTION 'Not allowed to inspect terminal availability'; END IF;
  SELECT * INTO v_config FROM public.restaurant_payment_configs WHERE location_id=v_location.id AND is_primary=true AND is_enabled AND provider_type IN('stripe_android_bridge','stripe_server_driven') LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'provider_type','none','reader_online',false,'reader_busy',false,'active_payment',false); END IF;
  SELECT EXISTS(SELECT 1 FROM public.payment_requests WHERE location_id=v_location.id AND status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown') AND expires_at>now()) INTO v_active;
  IF v_config.provider_type='stripe_android_bridge' THEN
    RETURN jsonb_build_object('available',EXISTS(SELECT 1 FROM public.terminal_devices d WHERE d.location_id=v_location.id AND d.payment_config_id=v_config.id AND d.status='online' AND d.reader_status='connected' AND d.reader_action_status='idle' AND d.current_payment_request_id IS NULL AND d.last_heartbeat_at>now()-interval '60 seconds') AND NOT v_active,'provider_type',v_config.provider_type,'reader_online',true,'reader_busy',v_active,'active_payment',v_active);
  END IF;
  SELECT * INTO v_reader FROM public.stripe_terminal_readers WHERE location_id=v_location.id AND payment_config_id=v_config.id AND is_enabled ORDER BY updated_at DESC LIMIT 1;
  SELECT EXISTS(
    SELECT 1 FROM public.payment_requests pr
    WHERE pr.location_id=v_location.id AND pr.stripe_reader_id=v_reader.stripe_reader_id
      AND pr.status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      AND pr.expires_at>now()
  ) INTO v_reader_has_active_payment;
  RETURN jsonb_build_object(
    'available',COALESCE(v_reader.status='online' AND (COALESCE(v_reader.action_status,'idle') NOT IN('in_progress','processing') OR NOT v_reader_has_active_payment),false) AND NOT v_active,
    'provider_type',COALESCE(v_config.provider_type,'none'),
    'reader_online',COALESCE(v_reader.status='online',false),
    'reader_busy',(COALESCE(v_reader.action_status IN('in_progress','processing'),false) AND v_reader_has_active_payment) OR v_active,
    'active_payment',v_active,'reader_id',v_reader.id,'reader_label',v_reader.label,'failure_code',v_reader.last_error_code,'failure_message',v_reader.last_error_message
  );
END; $$;

REVOKE ALL ON FUNCTION public.request_terminal_card_payment(UUID,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_terminal_card_payment(UUID,UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.terminal_payment_availability(UUID,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminal_payment_availability(UUID,UUID) TO authenticated;
