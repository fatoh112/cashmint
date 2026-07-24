-- Safe, tenant-scoped store deletion. Financial records are never deleted.
CREATE OR REPLACE FUNCTION public.superadmin_delete_store(
  p_store_id UUID,
  p_confirmation_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_store public.stores;
  v_is_service_role BOOLEAN := (SELECT auth.role()) = 'service_role';
  v_locations UUID[];
  v_counts JSONB := '{}'::jsonb;
  v_count BIGINT;
  v_active_statuses TEXT[] := ARRAY['pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown'];
BEGIN
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'STORE_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_service_role AND NOT COALESCE(public.is_superadmin(), false) THEN
    RAISE EXCEPTION 'SUPERADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_store
  FROM public.stores
  WHERE id = p_store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_confirmation_name IS NULL OR p_confirmation_name <> v_store.name THEN
    RAISE EXCEPTION 'CONFIRMATION_NAME_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) INTO v_locations
  FROM public.restaurant_locations
  WHERE store_id = p_store_id;

  IF EXISTS (
    SELECT 1 FROM public.payment_requests
    WHERE (location_id = ANY(v_locations) OR order_id IN (SELECT id FROM public.orders WHERE store_id = p_store_id))
      AND status = ANY(v_active_statuses)
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'ACTIVE_TERMINAL_PAYMENT_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  -- Any order, paid payment, refund, split, or successful terminal request is history.
  IF EXISTS (SELECT 1 FROM public.orders WHERE store_id = p_store_id)
     OR EXISTS (SELECT 1 FROM public.payments WHERE store_id = p_store_id)
     OR EXISTS (SELECT 1 FROM public.refunds WHERE store_id = p_store_id)
     OR EXISTS (SELECT 1 FROM public.payment_splits WHERE store_id = p_store_id)
     OR EXISTS (
       SELECT 1 FROM public.payment_requests
       WHERE location_id = ANY(v_locations) AND status = 'succeeded'
     ) THEN
    RAISE EXCEPTION 'STORE_HAS_FINANCIAL_HISTORY' USING ERRCODE = 'P0001';
  END IF;

  -- Delete terminal work before its restrictive location/configuration parents.
  DELETE FROM public.payment_requests
  WHERE location_id = ANY(v_locations);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('payment_requests', v_count);

  DELETE FROM public.payment_split_parts WHERE order_id IN (SELECT id FROM public.orders WHERE store_id = p_store_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('payment_split_parts', v_count);
  DELETE FROM public.payment_splits WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('payment_splits', v_count);

  DELETE FROM public.terminal_enrollment_codes WHERE location_id = ANY(v_locations);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('terminal_enrollment_codes', v_count);
  DELETE FROM public.stripe_terminal_readers WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('stripe_terminal_readers', v_count);
  DELETE FROM public.terminal_devices WHERE location_id = ANY(v_locations);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('terminal_devices', v_count);
  DELETE FROM public.restaurant_payment_configs WHERE location_id = ANY(v_locations);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('restaurant_payment_configs', v_count);

  DELETE FROM public.restaurant_locations WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('restaurant_locations', v_count);

  -- Catalog and configuration dependency order is intentional.
  DELETE FROM public.group_item_mapping WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('group_item_mapping', v_count);
  DELETE FROM public.product_bundle_components WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('product_bundle_components', v_count);
  DELETE FROM public.modifiers WHERE product_id IN (SELECT id FROM public.products WHERE store_id = p_store_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('modifiers', v_count);
  DELETE FROM public.products WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('products', v_count);
  DELETE FROM public.categories WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('categories', v_count);
  DELETE FROM public.accounting_groups WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('accounting_groups', v_count);
  DELETE FROM public.tax_profiles WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('tax_profiles', v_count);
  DELETE FROM public.tax_rates WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('tax_rates', v_count);

  DELETE FROM public.cashier_sessions WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('cashier_sessions', v_count);
  DELETE FROM public.pos_activation_codes WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pos_activation_codes', v_count);
  DELETE FROM public.pos_devices WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('pos_devices', v_count);
  DELETE FROM public.receipt_templates WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('receipt_templates', v_count);
  DELETE FROM public.store_feature_flags WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('store_feature_flags', v_count);
  DELETE FROM public.store_receipt_counters WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('store_receipt_counters', v_count);
  DELETE FROM public.system_maintenance WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('system_maintenance', v_count);
  DELETE FROM public.store_users WHERE store_id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('store_users', v_count);

  DELETE FROM public.stores WHERE id = p_store_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('stores', v_count);

  RETURN jsonb_build_object('deleted', true, 'store_id', p_store_id, 'store_name', v_store.name, 'deleted_counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_delete_store(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_delete_store(UUID, TEXT) TO authenticated, service_role;
