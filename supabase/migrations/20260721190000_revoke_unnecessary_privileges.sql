-- 1. Drop existing functions to avoid parameter defaults conflicts
DROP FUNCTION IF EXISTS public.superadmin_update_store_feature_flag(UUID, TEXT, BOOLEAN, JSONB);
DROP FUNCTION IF EXISTS public.superadmin_global_analytics(TIMESTAMPTZ, TIMESTAMPTZ, UUID);

-- 2. Hardened superadmin_update_store_feature_flag RPC definition
CREATE OR REPLACE FUNCTION public.superadmin_update_store_feature_flag(
  p_store_id UUID,
  p_feature_key TEXT,
  p_enabled BOOLEAN,
  p_configuration JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_enabled BOOLEAN;
  v_old_config JSONB;
  v_actor_email TEXT;
BEGIN
  -- Check superadmin authorization
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required';
  END IF;

  -- Validate allowed feature keys
  IF p_feature_key NOT IN ('split_payment', 'stripe_terminal', 'menu_import', 'accounting_exports', 'onboarding_wizard', 'experimental_features') THEN
    RAISE EXCEPTION 'Invalid feature key: %', p_feature_key;
  END IF;

  -- Fetch old values if any
  SELECT enabled, configuration INTO v_old_enabled, v_old_config
  FROM public.store_feature_flags
  WHERE store_id = p_store_id AND feature_key = p_feature_key;

  -- Upsert feature flag
  INSERT INTO public.store_feature_flags (store_id, feature_key, enabled, configuration, updated_by, updated_at)
  VALUES (p_store_id, p_feature_key, p_enabled, p_configuration, auth.uid(), now())
  ON CONFLICT (store_id, feature_key) DO UPDATE
  SET enabled = p_enabled,
      configuration = p_configuration,
      updated_by = auth.uid(),
      updated_at = now();

  -- Backward compatibility for split_payment
  IF p_feature_key = 'split_payment' THEN
    UPDATE public.stores
    SET split_payment_enabled = p_enabled
    WHERE id = p_store_id;
  END IF;

  -- Write Audit Log
  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');
  INSERT INTO public.superadmin_audit_logs (
    actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value, metadata
  ) VALUES (
    auth.uid(),
    v_actor_email,
    'update_feature_flag',
    'store_feature_flag',
    p_store_id::text || ':' || p_feature_key,
    p_store_id,
    jsonb_build_object('enabled', v_old_enabled, 'configuration', v_old_config),
    jsonb_build_object('enabled', p_enabled, 'configuration', p_configuration),
    jsonb_build_object('feature_key', p_feature_key)
  );

END;
$$;

-- 2. Corrected and hardened superadmin_global_analytics RPC definition
CREATE OR REPLACE FUNCTION public.superadmin_global_analytics(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_store_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_summary JSONB;
  v_sales_over_time JSONB;
  v_payment_breakdown JSONB;
  v_vat_breakdown JSONB;
  v_top_stores JSONB;
  v_failed_payments JSONB;
  v_terminal_status JSONB;
  v_store_performance JSONB;
BEGIN
  -- Check superadmin authorization
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required';
  END IF;

  -- Summary metrics with corrected, non-misleading keys (onboarded_stores, pending_onboarding_stores)
  SELECT jsonb_build_object(
    'total_stores', (SELECT count(*) FROM public.stores),
    'onboarded_stores', (SELECT count(*) FROM public.stores WHERE onboarding_completed = true),
    'pending_onboarding_stores', (SELECT count(*) FROM public.stores WHERE onboarding_completed = false),
    'total_gross_sales', COALESCE(SUM(o.total_amount), 0) - COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE (p_store_id IS NULL OR r.store_id = p_store_id) AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0),
    'total_net_sales', COALESCE(SUM(o.subtotal_excl_vat), 0) - COALESCE((SELECT SUM(r.net_amount) FROM public.refunds r WHERE (p_store_id IS NULL OR r.store_id = p_store_id) AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0),
    'total_vat', COALESCE(SUM(o.vat_amount), 0) - COALESCE((SELECT SUM(r.vat_amount) FROM public.refunds r WHERE (p_store_id IS NULL OR r.store_id = p_store_id) AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0),
    'completed_orders', COUNT(o.id),
    'avg_order_value', CASE WHEN COUNT(o.id) > 0 THEN (COALESCE(SUM(o.total_amount), 0) - COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE (p_store_id IS NULL OR r.store_id = p_store_id) AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0)) / COUNT(o.id) ELSE 0 END,
    'refund_total', COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE (p_store_id IS NULL OR r.store_id = p_store_id) AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0),
    'failed_card_payments', COALESCE((SELECT count(*) FROM public.payment_requests pr JOIN public.restaurant_locations rl ON pr.location_id = rl.id WHERE (p_store_id IS NULL OR rl.store_id = p_store_id) AND pr.status = 'failed' AND pr.created_at >= p_start_date AND pr.created_at <= p_end_date), 0),
    'pending_orders', (SELECT count(*) FROM public.orders WHERE status = 'pending' AND (p_store_id IS NULL OR store_id = p_store_id) AND created_at >= p_start_date AND created_at <= p_end_date),
    'partially_paid_orders', (SELECT count(*) FROM public.orders WHERE status = 'partially_paid' AND (p_store_id IS NULL OR store_id = p_store_id) AND created_at >= p_start_date AND created_at <= p_end_date),
    'online_terminals', (SELECT count(*) FROM public.terminal_devices td JOIN public.restaurant_locations rl ON td.location_id = rl.id WHERE (p_store_id IS NULL OR rl.store_id = p_store_id) AND td.status = 'online' AND td.last_heartbeat_at >= now() - INTERVAL '60 seconds'),
    'offline_terminals', (SELECT count(*) FROM public.terminal_devices td JOIN public.restaurant_locations rl ON td.location_id = rl.id WHERE (p_store_id IS NULL OR rl.store_id = p_store_id) AND (td.status <> 'online' OR td.last_heartbeat_at < now() - INTERVAL '60 seconds'))
  ) INTO v_summary
  FROM public.orders o
  WHERE o.status = 'completed'
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND o.created_at >= p_start_date
    AND o.created_at <= p_end_date;

  -- Sales over time (daily) - Group by date only for all stores
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_sales_over_time
  FROM (
    SELECT 
      o.created_at::date::text AS day,
      COALESCE(SUM(o.total_amount), 0) - COALESCE(
        (SELECT SUM(r.refund_amount) 
         FROM public.refunds r 
         WHERE (p_store_id IS NULL OR r.store_id = p_store_id) 
           AND r.created_at::date = o.created_at::date
        ), 0
      ) AS gross_sales,
      COALESCE(SUM(o.subtotal_excl_vat), 0) - COALESCE(
        (SELECT SUM(r.net_amount) 
         FROM public.refunds r 
         WHERE (p_store_id IS NULL OR r.store_id = p_store_id) 
           AND r.created_at::date = o.created_at::date
        ), 0
      ) AS net_sales,
      COUNT(o.id) AS order_count
    FROM public.orders o
    WHERE o.status = 'completed'
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
      AND o.created_at >= p_start_date
      AND o.created_at <= p_end_date
    GROUP BY o.created_at::date
    ORDER BY o.created_at::date
  ) t;

  -- Payment breakdown (Cash vs Card)
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_payment_breakdown
  FROM (
    SELECT 
      p.method,
      SUM(p.amount) AS total_amount
    FROM public.payments p
    WHERE p.status = 'paid'
      AND (p_store_id IS NULL OR p.store_id = p_store_id)
      AND p.created_at >= p_start_date
      AND p.created_at <= p_end_date
    GROUP BY p.method
  ) t;

  -- VAT breakdown by rate - Group by vat_rate only for all stores
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_vat_breakdown
  FROM (
    SELECT 
      oi.vat_rate,
      SUM(oi.vat_amount) - COALESCE(
        (SELECT SUM(r.vat_amount) 
         FROM public.refunds r 
         WHERE r.vat_rate = oi.vat_rate 
           AND (p_store_id IS NULL OR r.store_id = p_store_id) 
           AND r.created_at >= p_start_date 
           AND r.created_at <= p_end_date
        ), 0
      ) AS total_vat
    FROM public.order_items oi
    JOIN public.orders o ON oi.order_id = o.id
    WHERE o.status = 'completed'
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
      AND o.created_at >= p_start_date
      AND o.created_at <= p_end_date
    GROUP BY oi.vat_rate
  ) t;

  -- Top stores by gross sales
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top_stores
  FROM (
    SELECT 
      s.name AS store_name,
      SUM(o.total_amount) - COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE r.store_id = s.id AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0) AS gross_sales
    FROM public.orders o
    JOIN public.stores s ON o.store_id = s.id
    WHERE o.status = 'completed'
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
      AND o.created_at >= p_start_date
      AND o.created_at <= p_end_date
    GROUP BY s.id, s.name
    ORDER BY gross_sales DESC
    LIMIT 10
  ) t;

  -- Failed payment requests by store
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_failed_payments
  FROM (
    SELECT 
      s.name AS store_name,
      COUNT(pr.id) AS failed_count
    FROM public.payment_requests pr
    JOIN public.restaurant_locations rl ON pr.location_id = rl.id
    JOIN public.stores s ON rl.store_id = s.id
    WHERE pr.status = 'failed'
      AND (p_store_id IS NULL OR s.id = p_store_id)
      AND pr.created_at >= p_start_date
      AND pr.created_at <= p_end_date
    GROUP BY s.id, s.name
    ORDER BY failed_count DESC
  ) t;

  -- Terminal online/offline status
  SELECT jsonb_build_object(
    'online', (SELECT count(*) FROM public.terminal_devices td JOIN public.restaurant_locations rl ON td.location_id = rl.id WHERE (p_store_id IS NULL OR rl.store_id = p_store_id) AND td.status = 'online' AND td.last_heartbeat_at >= now() - INTERVAL '60 seconds'),
    'offline', (SELECT count(*) FROM public.terminal_devices td JOIN public.restaurant_locations rl ON td.location_id = rl.id WHERE (p_store_id IS NULL OR rl.store_id = p_store_id) AND (td.status <> 'online' OR td.last_heartbeat_at < now() - INTERVAL '60 seconds'))
  ) INTO v_terminal_status;

  -- Store performance table rows - Display Onboarded / Pending Onboarding
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_store_performance
  FROM (
    SELECT 
      s.id AS store_id,
      s.name AS store_name,
      CASE WHEN s.onboarding_completed THEN 'Onboarded' ELSE 'Pending Onboarding' END AS store_status,
      COALESCE(SUM(o.total_amount), 0) - COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE r.store_id = s.id AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0) AS gross_sales,
      COALESCE(SUM(o.subtotal_excl_vat), 0) - COALESCE((SELECT SUM(r.net_amount) FROM public.refunds r WHERE r.store_id = s.id AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0) AS net_sales,
      COALESCE(SUM(o.vat_amount), 0) - COALESCE((SELECT SUM(r.vat_amount) FROM public.refunds r WHERE r.store_id = s.id AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0) AS vat,
      COUNT(o.id) AS order_count,
      CASE WHEN COUNT(o.id) > 0 THEN (COALESCE(SUM(o.total_amount), 0) - COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE r.store_id = s.id AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0)) / COUNT(o.id) ELSE 0 END AS avg_order_value,
      COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.store_id = s.id AND p.method = 'cash' AND p.status = 'paid' AND p.created_at >= p_start_date AND p.created_at <= p_end_date), 0) AS cash_collected,
      COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.store_id = s.id AND p.method = 'card' AND p.status = 'paid' AND p.created_at >= p_start_date AND p.created_at <= p_end_date), 0) AS card_collected,
      COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE r.store_id = s.id AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0) AS refunds,
      COALESCE((SELECT COUNT(pr.id) FROM public.payment_requests pr JOIN public.restaurant_locations rl ON pr.location_id = rl.id WHERE rl.store_id = s.id AND pr.status = 'failed' AND pr.created_at >= p_start_date AND pr.created_at <= p_end_date), 0) AS failed_payments,
      (SELECT MAX(created_at) FROM public.orders WHERE store_id = s.id AND status = 'completed') AS last_completed_order_time,
      CASE WHEN EXISTS (SELECT 1 FROM public.terminal_devices td JOIN public.restaurant_locations rl ON td.location_id = rl.id WHERE rl.store_id = s.id AND td.status = 'online' AND td.last_heartbeat_at >= now() - INTERVAL '60 seconds') THEN 'Online' ELSE 'Offline' END AS terminal_status
    FROM public.stores s
    LEFT JOIN public.orders o ON o.store_id = s.id AND o.status = 'completed' AND o.created_at >= p_start_date AND o.created_at <= p_end_date
    WHERE (p_store_id IS NULL OR s.id = p_store_id)
    GROUP BY s.id, s.name, s.onboarding_completed
  ) t;

  -- Return consolidated JSON
  RETURN jsonb_build_object(
    'summary', v_summary,
    'sales_over_time', v_sales_over_time,
    'payment_breakdown', v_payment_breakdown,
    'vat_breakdown', v_vat_breakdown,
    'top_stores', v_top_stores,
    'failed_payments', v_failed_payments,
    'terminal_status', v_terminal_status,
    'store_performance', v_store_performance
  );

END;
$$;

-- 3. Revoke unnecessary privileges from anon and authenticated roles
-- RLS does not protect against TRUNCATE, and anon/authenticated do not need TRIGGER or REFERENCES privileges.

REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.store_users FROM anon, authenticated, public;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.superadmin_audit_logs FROM anon, authenticated, public;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.system_maintenance FROM anon, authenticated, public;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.store_feature_flags FROM anon, authenticated, public;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.refunds FROM anon, authenticated, public;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.orders FROM anon, authenticated, public;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.payments FROM anon, authenticated, public;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.payment_requests FROM anon, authenticated, public;
