CREATE OR REPLACE FUNCTION public.terminal_payment_availability(p_store_id UUID, p_pos_device_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_location public.restaurant_locations; v_config public.restaurant_payment_configs; v_reader public.stripe_terminal_readers; v_active BOOLEAN; v_reader_has_active_payment BOOLEAN; v_active_request public.payment_requests;
BEGIN
  SELECT * INTO v_location FROM public.restaurant_locations WHERE store_id=p_store_id;
  IF NOT FOUND OR NOT(public.is_location_member(v_location.id) OR EXISTS(SELECT 1 FROM public.pos_devices WHERE id=p_pos_device_id AND store_id=p_store_id AND status='active')) THEN RAISE EXCEPTION 'Not allowed to inspect terminal availability'; END IF;
  SELECT * INTO v_config FROM public.restaurant_payment_configs WHERE location_id=v_location.id AND is_primary=true AND is_enabled AND provider_type IN('stripe_android_bridge','stripe_server_driven') LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'provider_type','none','reader_online',false,'reader_busy',false,'active_payment',false); END IF;
  SELECT * INTO v_active_request FROM public.payment_requests WHERE location_id=v_location.id AND status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown') AND expires_at>now() ORDER BY updated_at DESC LIMIT 1;
  v_active := FOUND;
  IF v_config.provider_type='stripe_android_bridge' THEN
    RETURN jsonb_build_object('available',EXISTS(SELECT 1 FROM public.terminal_devices d WHERE d.location_id=v_location.id AND d.payment_config_id=v_config.id AND d.status='online' AND d.reader_status='connected' AND d.reader_action_status='idle' AND d.current_payment_request_id IS NULL AND d.last_heartbeat_at>now()-interval '60 seconds') AND NOT v_active,'provider_type',v_config.provider_type,'reader_online',true,'reader_busy',v_active,'active_payment',v_active,'active_payment_request_id',v_active_request.id,'active_payment_order_id',v_active_request.order_id,'active_payment_status',v_active_request.status);
  END IF;
  SELECT * INTO v_reader FROM public.stripe_terminal_readers WHERE location_id=v_location.id AND payment_config_id=v_config.id AND is_enabled ORDER BY updated_at DESC LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM public.payment_requests pr WHERE pr.location_id=v_location.id AND pr.stripe_reader_id=v_reader.stripe_reader_id AND pr.status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown') AND pr.expires_at>now()) INTO v_reader_has_active_payment;
  RETURN jsonb_build_object('available',COALESCE(v_reader.status='online' AND (COALESCE(v_reader.action_status,'idle') NOT IN('in_progress','processing') OR NOT v_reader_has_active_payment),false) AND NOT v_active,'provider_type',COALESCE(v_config.provider_type,'none'),'reader_online',COALESCE(v_reader.status='online',false),'reader_busy',(COALESCE(v_reader.action_status IN('in_progress','processing'),false) AND v_reader_has_active_payment) OR v_active,'active_payment',v_active,'active_payment_request_id',v_active_request.id,'active_payment_order_id',v_active_request.order_id,'active_payment_status',v_active_request.status,'reader_id',v_reader.id,'reader_label',v_reader.label,'failure_code',v_reader.last_error_code,'failure_message',v_reader.last_error_message);
END; $$;
GRANT EXECUTE ON FUNCTION public.terminal_payment_availability(UUID,UUID) TO anon, authenticated;
