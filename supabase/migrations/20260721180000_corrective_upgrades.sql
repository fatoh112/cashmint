-- 1. Insert superadmin role dynamically for the existing superadmin user
INSERT INTO public.store_users (user_id, store_id, role, ai_enabled)
SELECT u.id, s.id, 'superadmin', false
FROM auth.users u
CROSS JOIN (SELECT id FROM public.stores LIMIT 1) s
WHERE u.email = 'superadmin@cashmint.online'
ON CONFLICT (user_id, store_id) DO UPDATE SET role = 'superadmin';

-- 2. Secure public.is_superadmin() function
CREATE OR REPLACE FUNCTION public.is_superadmin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN COALESCE(
    EXISTS (
      SELECT 1 FROM public.store_users
      WHERE user_id = auth.uid() AND role = 'superadmin'
    ),
    false
  );
END;
$function$;

-- 3. Correct superadmin_global_analytics definitions
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

  -- Summary metrics
  SELECT jsonb_build_object(
    'total_stores', (SELECT count(*) FROM public.stores),
    'active_stores', (SELECT count(*) FROM public.stores WHERE onboarding_completed = true),
    'disabled_stores', (SELECT count(*) FROM public.stores WHERE onboarding_completed = false),
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

-- 4. Synchronization trigger for store split_payment_enabled column
CREATE OR REPLACE FUNCTION public.trg_sync_store_split_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.split_payment_enabled IS DISTINCT FROM NEW.split_payment_enabled) OR (TG_OP = 'INSERT') THEN
    INSERT INTO public.store_feature_flags (store_id, feature_key, enabled, configuration, updated_by, updated_at)
    VALUES (NEW.id, 'split_payment', NEW.split_payment_enabled, '{}'::jsonb, null, now())
    ON CONFLICT (store_id, feature_key) DO UPDATE
    SET enabled = NEW.split_payment_enabled,
        updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS sync_store_split_payment_trigger ON public.stores;
CREATE TRIGGER sync_store_split_payment_trigger
AFTER INSERT OR UPDATE OF split_payment_enabled ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_store_split_payment();
