-- Repair active terminal provider switching without the removed store-admin helper.
CREATE OR REPLACE FUNCTION public.set_active_terminal_provider(
  p_location_id UUID,
  p_provider_type TEXT,
  p_payment_config_id UUID DEFAULT NULL
)
RETURNS public.restaurant_payment_configs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target public.restaurant_payment_configs;
  v_store_id UUID;
  v_actor_email TEXT;
BEGIN
  IF p_provider_type NOT IN ('stripe_android_bridge', 'stripe_server_driven') THEN
    RAISE EXCEPTION 'Unsupported terminal provider';
  END IF;

  SELECT store_id
    INTO v_store_id
    FROM public.restaurant_locations
   WHERE id = p_location_id;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Location not found';
  END IF;

  IF NOT (
    COALESCE(public.is_superadmin(), false)
    OR EXISTS (
      SELECT 1
        FROM public.store_users su
       WHERE su.user_id = auth.uid()
         AND su.store_id = v_store_id
         AND su.role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'Store admin access required';
  END IF;

  -- Serialize provider switches for this location before validating or changing state.
  PERFORM 1
    FROM public.restaurant_payment_configs
   WHERE location_id = p_location_id
   FOR UPDATE;

  IF p_payment_config_id IS NULL THEN
    SELECT *
      INTO v_target
      FROM public.restaurant_payment_configs
     WHERE location_id = p_location_id
       AND provider_type = p_provider_type
     ORDER BY is_primary DESC, id
     LIMIT 1
     FOR UPDATE;
  ELSE
    SELECT *
      INTO v_target
      FROM public.restaurant_payment_configs
     WHERE id = p_payment_config_id
       AND location_id = p_location_id
       AND provider_type = p_provider_type
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider configuration does not belong to this location';
  END IF;

  IF p_provider_type = 'stripe_server_driven' AND NOT EXISTS (
    SELECT 1
      FROM public.stripe_terminal_readers r
     WHERE r.payment_config_id = v_target.id
       AND r.location_id = p_location_id
       AND r.is_enabled
       AND r.status = 'online'
  ) THEN
    RAISE EXCEPTION 'WisePOS E reader must be registered and online before activation';
  END IF;

  UPDATE public.restaurant_payment_configs
     SET is_primary = false,
         is_enabled = false,
         updated_at = now()
   WHERE location_id = p_location_id
     AND id <> v_target.id;

  UPDATE public.restaurant_payment_configs
     SET is_primary = true,
         is_enabled = true,
         updated_at = now()
   WHERE id = v_target.id
  RETURNING * INTO v_target;

  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');
  INSERT INTO public.superadmin_audit_logs (
    actor_user_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    store_id,
    old_value,
    new_value,
    metadata
  )
  VALUES (
    auth.uid(),
    v_actor_email,
    'active_terminal_provider_switched',
    'terminal_provider',
    v_target.id::text,
    v_store_id,
    NULL,
    jsonb_build_object(
      'location_id', p_location_id,
      'provider_type', p_provider_type,
      'payment_config_id', v_target.id
    ),
    jsonb_build_object('provider_type', p_provider_type)
  );

  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_terminal_provider(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_terminal_provider(UUID, TEXT, UUID) TO authenticated, service_role;
