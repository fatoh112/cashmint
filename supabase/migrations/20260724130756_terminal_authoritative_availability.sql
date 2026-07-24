-- Make the availability contract explicit.  This is intentionally a snapshot
-- RPC: Stripe-authoritative decisions are made by terminal-payment-availability
-- before a card order is created and again by the start Edge Function.
CREATE OR REPLACE FUNCTION public.terminal_payment_availability(
  p_store_id UUID,
  p_pos_device_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location public.restaurant_locations;
  v_config public.restaurant_payment_configs;
  v_reader public.stripe_terminal_readers;
  v_active public.payment_requests;
  v_reader_request public.payment_requests;
  v_is_service_role BOOLEAN := (SELECT auth.role()) = 'service_role';
  v_is_superadmin BOOLEAN := false;
  v_is_store_member BOOLEAN := false;
  v_is_active_device BOOLEAN := false;
  v_reason TEXT := 'READY';
  v_available BOOLEAN := false;
  v_active_age BIGINT;
BEGIN
  IF p_store_id IS NULL THEN RAISE EXCEPTION 'Not allowed to inspect terminal availability'; END IF;
  IF NOT v_is_service_role THEN v_is_superadmin := COALESCE(public.is_superadmin(), false); END IF;
  SELECT EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = p_store_id AND su.user_id = (SELECT auth.uid())) INTO v_is_store_member;
  IF p_pos_device_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = p_store_id AND d.status::text = 'active') INTO v_is_active_device;
  END IF;
  IF NOT (v_is_service_role OR v_is_superadmin OR v_is_store_member OR v_is_active_device) THEN RAISE EXCEPTION 'Not allowed to inspect terminal availability'; END IF;

  SELECT * INTO v_location FROM public.restaurant_locations WHERE store_id = p_store_id ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configured',false,'available',false,'reason','TERMINAL_NOT_CONFIGURED','reader_status',NULL,'reader_action_status',NULL,'active_payment_request_id',NULL,'active_payment_age_seconds',NULL,'last_seen_at',NULL,'last_synced_at',NULL,'provider_type','none','reader_online',false,'reader_busy',false,'active_payment',false);
  END IF;
  SELECT * INTO v_config FROM public.restaurant_payment_configs WHERE location_id=v_location.id AND is_primary AND is_enabled AND provider_type IN ('stripe_android_bridge','stripe_server_driven') LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configured',false,'available',false,'reason','TERMINAL_NOT_CONFIGURED','reader_status',NULL,'reader_action_status',NULL,'active_payment_request_id',NULL,'active_payment_age_seconds',NULL,'last_seen_at',NULL,'last_synced_at',NULL,'provider_type','none','reader_online',false,'reader_busy',false,'active_payment',false);
  END IF;

  SELECT * INTO v_active FROM public.payment_requests WHERE location_id=v_location.id AND status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown') ORDER BY updated_at DESC LIMIT 1;
  IF FOUND THEN v_active_age := GREATEST(0, EXTRACT(EPOCH FROM (now()-COALESCE(v_active.started_at,v_active.created_at)))::BIGINT); END IF;

  IF v_config.provider_type = 'stripe_android_bridge' THEN
    v_reason := CASE WHEN v_active.id IS NOT NULL THEN 'ACTIVE_CURRENT_PAYMENT' ELSE 'READER_SYNC_FAILED' END;
    v_available := false;
    RETURN jsonb_build_object('configured',true,'available',v_available,'reason',v_reason,'reader_status',NULL,'reader_action_status',NULL,'active_payment_request_id',v_active.id,'active_payment_age_seconds',v_active_age,'last_seen_at',NULL,'last_synced_at',NULL,'provider_type',v_config.provider_type,'reader_online',false,'reader_busy',false,'active_payment',v_active.id IS NOT NULL);
  END IF;

  SELECT * INTO v_reader FROM public.stripe_terminal_readers WHERE location_id=v_location.id AND payment_config_id=v_config.id AND is_enabled ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configured',true,'available',false,'reason','TERMINAL_NOT_CONFIGURED','reader_status',NULL,'reader_action_status',NULL,'active_payment_request_id',v_active.id,'active_payment_age_seconds',v_active_age,'last_seen_at',NULL,'last_synced_at',NULL,'provider_type',v_config.provider_type,'reader_online',false,'reader_busy',false,'active_payment',v_active.id IS NOT NULL);
  END IF;
  SELECT * INTO v_reader_request FROM public.payment_requests WHERE location_id=v_location.id AND stripe_reader_id=v_reader.stripe_reader_id AND status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown') ORDER BY updated_at DESC LIMIT 1;
  IF v_reader.status IS DISTINCT FROM 'online' THEN v_reason := 'READER_OFFLINE';
  ELSIF COALESCE(v_reader.action_status,'idle') IN ('in_progress','processing') THEN v_reason := 'READER_BUSY';
  ELSIF v_reader_request.id IS NOT NULL AND COALESCE(v_reader_request.expires_at, now()) < now() THEN v_reason := 'STALE_PAYMENT_REQUEST';
  ELSIF v_active.id IS NOT NULL THEN v_reason := 'ACTIVE_CURRENT_PAYMENT';
  ELSIF v_reader.last_synced_at IS NULL OR v_reader.last_synced_at < now()-interval '2 minutes' THEN v_reason := 'READER_SYNC_FAILED';
  ELSE v_reason := 'READY'; END IF;
  v_available := v_reason='READY';
  RETURN jsonb_build_object('configured',true,'available',v_available,'reason',v_reason,'reader_status',v_reader.status,'reader_action_status',COALESCE(v_reader.action_status,'idle'),'active_payment_request_id',COALESCE(v_reader_request.id,v_active.id),'active_payment_age_seconds',CASE WHEN v_reader_request.id IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (now()-COALESCE(v_reader_request.started_at,v_reader_request.created_at)))::BIGINT) ELSE v_active_age END,'last_seen_at',v_reader.last_seen_at,'last_synced_at',v_reader.last_synced_at,'provider_type',v_config.provider_type,'reader_online',v_reader.status='online','reader_busy',v_reason='READER_BUSY','active_payment',v_active.id IS NOT NULL,'reader_id',v_reader.id,'reader_label',v_reader.label,'failure_code',v_reader.last_error_code,'failure_message',v_reader.last_error_message);
END;
$$;

REVOKE ALL ON FUNCTION public.terminal_payment_availability(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_payment_availability(UUID, UUID) TO anon, authenticated, service_role;
