-- Provider-aware payment request and availability fields/RPCs.
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS stripe_reader_id TEXT,
  ADD COLUMN IF NOT EXISTS reader_action_id TEXT,
  ADD COLUMN IF NOT EXISTS reader_action_status TEXT,
  ADD COLUMN IF NOT EXISTS reader_action_type TEXT,
  ADD COLUMN IF NOT EXISTS reader_failure_code TEXT,
  ADD COLUMN IF NOT EXISTS reader_failure_message TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_requests_provider_active
  ON public.payment_requests(location_id, provider_type, status) WHERE status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown');

CREATE OR REPLACE FUNCTION public.set_active_terminal_provider(
  p_location_id UUID, p_provider_type TEXT, p_payment_config_id UUID DEFAULT NULL
) RETURNS public.restaurant_payment_configs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_target public.restaurant_payment_configs; v_store_id UUID; v_actor_email TEXT;
BEGIN
  IF p_provider_type NOT IN ('stripe_android_bridge','stripe_server_driven') THEN RAISE EXCEPTION 'Unsupported terminal provider'; END IF;
  SELECT store_id INTO v_store_id FROM public.restaurant_locations WHERE id = p_location_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Location not found'; END IF;
  IF NOT (public.is_superadmin() OR public.check_user_is_store_admin(v_store_id)) THEN RAISE EXCEPTION 'Store admin access required'; END IF;
  SELECT * INTO v_target FROM public.restaurant_payment_configs
    WHERE id = COALESCE(p_payment_config_id, id) AND location_id = p_location_id AND provider_type = p_provider_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider configuration does not belong to this location'; END IF;
  IF p_provider_type = 'stripe_server_driven' AND NOT EXISTS (
    SELECT 1 FROM public.stripe_terminal_readers r WHERE r.payment_config_id=v_target.id AND r.location_id=p_location_id AND r.is_enabled AND r.status='online'
  ) THEN RAISE EXCEPTION 'WisePOS E reader must be registered and online before activation'; END IF;
  UPDATE public.restaurant_payment_configs SET is_primary=false WHERE location_id=p_location_id;
  UPDATE public.restaurant_payment_configs SET is_enabled=true, is_primary=true, updated_at=now() WHERE id=v_target.id RETURNING * INTO v_target;
  v_actor_email := COALESCE(auth.jwt() ->> 'email','system');
  INSERT INTO public.superadmin_audit_logs(actor_user_id,actor_email,action,entity_type,entity_id,store_id,old_value,new_value,metadata)
  VALUES(auth.uid(),v_actor_email,'active_terminal_provider_switched','terminal_provider',v_target.id::text,v_store_id,NULL,
    jsonb_build_object('location_id',p_location_id,'provider_type',p_provider_type,'payment_config_id',v_target.id),jsonb_build_object('provider_type',p_provider_type));
  RETURN v_target;
END; $$;

DO $$ DECLARE v_def TEXT; BEGIN
  SELECT pg_get_functiondef('public.create_split_payment(uuid,bigint,bigint,text,uuid)'::regprocedure) INTO v_def;
  v_def := replace(v_def, 'provider_type = ''stripe_android_bridge'' AND is_enabled', 'provider_type IN (''stripe_android_bridge'',''stripe_server_driven'') AND is_primary AND is_enabled');
  EXECUTE v_def;
  SELECT pg_get_functiondef('public.retry_split_card_payment(uuid,text,uuid)'::regprocedure) INTO v_def;
  v_def := replace(v_def, 'provider_type = ''stripe_android_bridge'' AND is_enabled', 'provider_type IN (''stripe_android_bridge'',''stripe_server_driven'') AND is_primary AND is_enabled');
  EXECUTE v_def;
END $$;
REVOKE ALL ON FUNCTION public.set_active_terminal_provider(UUID,TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_terminal_provider(UUID,TEXT,UUID) TO authenticated;

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
  IF v_config.provider_type='stripe_server_driven' AND NOT EXISTS(SELECT 1 FROM public.stripe_terminal_readers WHERE location_id=v_location.id AND payment_config_id=v_config.id AND is_enabled AND status='online' AND COALESCE(action_status,'idle') NOT IN('in_progress','processing')) THEN RAISE EXCEPTION 'WisePOS E reader is unavailable or busy'; END IF;
  INSERT INTO public.payment_requests(restaurant_id,location_id,order_id,payment_config_id,provider_type,idempotency_key)
  VALUES(v_location.restaurant_id,v_location.id,p_order_id,v_config.id,v_config.provider_type,'terminal-payment:'||p_order_id::text)
  ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=now() RETURNING * INTO v_request;
  RETURN v_request;
END; $$;

CREATE OR REPLACE FUNCTION public.terminal_payment_availability(p_store_id UUID, p_pos_device_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_location public.restaurant_locations; v_config public.restaurant_payment_configs; v_reader public.stripe_terminal_readers; v_active BOOLEAN;
BEGIN
  SELECT * INTO v_location FROM public.restaurant_locations WHERE store_id=p_store_id;
  IF NOT FOUND OR NOT(public.is_location_member(v_location.id) OR EXISTS(SELECT 1 FROM public.pos_devices WHERE id=p_pos_device_id AND store_id=p_store_id AND status='active')) THEN RAISE EXCEPTION 'Not allowed to inspect terminal availability'; END IF;
  SELECT * INTO v_config FROM public.restaurant_payment_configs WHERE location_id=v_location.id AND is_primary=true AND is_enabled AND provider_type IN('stripe_android_bridge','stripe_server_driven') LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM public.payment_requests WHERE location_id=v_location.id AND status IN('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown') AND expires_at>now()) INTO v_active;
  IF v_config.provider_type='stripe_android_bridge' THEN
    RETURN jsonb_build_object('available',EXISTS(SELECT 1 FROM public.terminal_devices d WHERE d.location_id=v_location.id AND d.payment_config_id=v_config.id AND d.status='online' AND d.reader_status='connected' AND d.reader_action_status='idle' AND d.current_payment_request_id IS NULL AND d.last_heartbeat_at>now()-interval '60 seconds') AND NOT v_active,'provider_type',v_config.provider_type,'reader_online',true,'reader_busy',v_active,'active_payment',v_active);
  END IF;
  SELECT * INTO v_reader FROM public.stripe_terminal_readers WHERE location_id=v_location.id AND payment_config_id=v_config.id AND is_enabled ORDER BY updated_at DESC LIMIT 1;
  RETURN jsonb_build_object('available',COALESCE(v_reader.status='online' AND COALESCE(v_reader.action_status,'idle') NOT IN('in_progress','processing'),false) AND NOT v_active,'provider_type',COALESCE(v_config.provider_type,'none'),'reader_online',COALESCE(v_reader.status='online',false),'reader_busy',COALESCE(v_reader.action_status IN('in_progress','processing'),false) OR v_active,'active_payment',v_active,'reader_id',v_reader.id,'reader_label',v_reader.label,'failure_code',v_reader.last_error_code,'failure_message',v_reader.last_error_message);
END; $$;
