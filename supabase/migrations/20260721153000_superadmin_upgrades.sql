-- Upgrades to Master / Super Admin Panel database schema
-- Additive tables, functions, RLS policies, and triggers

-- 1. Create refunds table if it does not exist
CREATE TABLE IF NOT EXISTS public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  original_order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  original_order_item_id UUID REFERENCES public.order_items(id) ON DELETE RESTRICT,
  refund_amount NUMERIC(14,4) NOT NULL CHECK (refund_amount >= 0),
  net_amount NUMERIC(14,4) NOT NULL CHECK (net_amount >= 0),
  vat_amount NUMERIC(14,4) NOT NULL CHECK (vat_amount >= 0),
  vat_rate NUMERIC(5,2) NOT NULL,
  payment_method TEXT,
  reason TEXT,
  cashier_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refunds_store_created_at ON public.refunds(store_id, created_at);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant accounting refunds" ON public.refunds;
CREATE POLICY "Tenant accounting refunds" ON public.refunds FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()) OR public.is_superadmin())
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()) OR public.is_superadmin());

-- 2. Create store_feature_flags table
CREATE TABLE IF NOT EXISTS public.store_feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT store_feature_flags_store_key UNIQUE (store_id, feature_key)
);

ALTER TABLE public.store_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select store feature flags" ON public.store_feature_flags;
CREATE POLICY "Select store feature flags" ON public.store_feature_flags FOR SELECT TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()) OR public.is_superadmin());

DROP POLICY IF EXISTS "Modify store feature flags" ON public.store_feature_flags;
CREATE POLICY "Modify store feature flags" ON public.store_feature_flags FOR ALL TO authenticated
USING (public.is_superadmin())
WITH CHECK (public.is_superadmin());

-- 3. Create superadmin_audit_logs table
CREATE TABLE IF NOT EXISTS public.superadmin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  store_id UUID,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_created_at ON public.superadmin_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_store_id ON public.superadmin_audit_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_action ON public.superadmin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_actor_user ON public.superadmin_audit_logs(actor_user_id);

ALTER TABLE public.superadmin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmin read audit logs" ON public.superadmin_audit_logs;
CREATE POLICY "Superadmin read audit logs" ON public.superadmin_audit_logs FOR SELECT TO authenticated
USING (public.is_superadmin());

-- 4. Create system_maintenance table
CREATE TABLE IF NOT EXISTS public.system_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('global', 'store')),
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  message_ar TEXT NOT NULL,
  message_en TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  expected_end_at TIMESTAMPTZ,
  enabled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled_at TIMESTAMPTZ,
  disabled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_maintenance_global ON public.system_maintenance (scope) WHERE (scope = 'global');
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_maintenance_store ON public.system_maintenance (scope, store_id) WHERE (scope = 'store');

ALTER TABLE public.system_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone read maintenance" ON public.system_maintenance;
CREATE POLICY "Everyone read maintenance" ON public.system_maintenance FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Superadmin manage maintenance" ON public.system_maintenance;
CREATE POLICY "Superadmin manage maintenance" ON public.system_maintenance FOR ALL TO authenticated
USING (public.is_superadmin())
WITH CHECK (public.is_superadmin());


-- 5. Create Audit Triggers functions
CREATE OR REPLACE FUNCTION public.trg_audit_store_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
BEGIN
  v_actor_id := auth.uid();
  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'store_created', 'store', NEW.id::text, NEW.id, NULL, to_jsonb(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.onboarding_completed <> NEW.onboarding_completed THEN
      INSERT INTO public.superadmin_audit_logs (
        actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
      ) VALUES (
        v_actor_id, v_actor_email, 
        CASE WHEN NEW.onboarding_completed THEN 'store_enabled' ELSE 'store_disabled' END,
        'store', NEW.id::text, NEW.id,
        jsonb_build_object('onboarding_completed', OLD.onboarding_completed),
        jsonb_build_object('onboarding_completed', NEW.onboarding_completed)
      );
    ELSE
      INSERT INTO public.superadmin_audit_logs (
        actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
      ) VALUES (
        v_actor_id, v_actor_email, 'store_updated', 'store', NEW.id::text, NEW.id, to_jsonb(OLD), to_jsonb(NEW)
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'store_deleted', 'store', OLD.id::text, OLD.id, to_jsonb(OLD), NULL
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_audit_store_user_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
BEGIN
  v_actor_id := auth.uid();
  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'user_added_to_store', 'store_user', NEW.id::text, NEW.store_id, NULL, to_jsonb(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'user_removed_from_store', 'store_user', OLD.id::text, OLD.store_id, to_jsonb(OLD), NULL
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_audit_payment_config_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
  v_store_id UUID;
BEGIN
  v_actor_id := auth.uid();
  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');

  SELECT store_id INTO v_store_id FROM public.restaurant_locations WHERE id = COALESCE(NEW.location_id, OLD.location_id);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'payment_config_created', 'payment_config', NEW.id::text, v_store_id, NULL, to_jsonb(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'payment_config_changed', 'payment_config', NEW.id::text, v_store_id, to_jsonb(OLD), to_jsonb(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'payment_config_deleted', 'payment_config', OLD.id::text, v_store_id, to_jsonb(OLD), NULL
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_audit_device_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
  v_store_id UUID;
BEGIN
  v_actor_id := auth.uid();
  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');

  IF TG_TABLE_NAME = 'pos_devices' THEN
    v_store_id := COALESCE(NEW.store_id, OLD.store_id);
    IF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
      INSERT INTO public.superadmin_audit_logs (
        actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
      ) VALUES (
        v_actor_id, v_actor_email, 'device_status_changed', 'pos_device', NEW.id::text, v_store_id,
        jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status)
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'terminal_devices' THEN
    SELECT store_id INTO v_store_id FROM public.restaurant_locations WHERE id = COALESCE(NEW.location_id, OLD.location_id);
    IF TG_OP = 'UPDATE' AND (OLD.status <> NEW.status OR OLD.reader_status <> NEW.reader_status) THEN
      INSERT INTO public.superadmin_audit_logs (
        actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
      ) VALUES (
        v_actor_id, v_actor_email, 'terminal_setting_changed', 'terminal_device', NEW.id::text, v_store_id,
        jsonb_build_object('status', OLD.status, 'reader_status', OLD.reader_status),
        jsonb_build_object('status', NEW.status, 'reader_status', NEW.reader_status)
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_audit_system_settings_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT;
BEGIN
  v_actor_id := auth.uid();
  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');

  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.superadmin_audit_logs (
      actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
    ) VALUES (
      v_actor_id, v_actor_email, 'system_setting_changed', 'system_settings', NEW.id::text, NULL, to_jsonb(OLD), to_jsonb(NEW)
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Attach triggers to tables
DROP TRIGGER IF EXISTS audit_store_changes_trigger ON public.stores;
CREATE TRIGGER audit_store_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_store_changes();

DROP TRIGGER IF EXISTS audit_store_user_changes_trigger ON public.store_users;
CREATE TRIGGER audit_store_user_changes_trigger
AFTER INSERT OR DELETE ON public.store_users
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_store_user_changes();

DROP TRIGGER IF EXISTS audit_payment_config_changes_trigger ON public.restaurant_payment_configs;
CREATE TRIGGER audit_payment_config_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.restaurant_payment_configs
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_payment_config_changes();

DROP TRIGGER IF EXISTS audit_pos_device_changes_trigger ON public.pos_devices;
CREATE TRIGGER audit_pos_device_changes_trigger
AFTER UPDATE ON public.pos_devices
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_device_changes();

DROP TRIGGER IF EXISTS audit_terminal_device_changes_trigger ON public.terminal_devices;
CREATE TRIGGER audit_terminal_device_changes_trigger
AFTER UPDATE ON public.terminal_devices
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_device_changes();

DROP TRIGGER IF EXISTS audit_system_settings_changes_trigger ON public.system_settings;
CREATE TRIGGER audit_system_settings_changes_trigger
AFTER UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.trg_audit_system_settings_changes();


-- 7. Feature flag update RPC
CREATE OR REPLACE FUNCTION public.superadmin_update_store_feature_flag(
  p_store_id UUID,
  p_feature_key TEXT,
  p_enabled BOOLEAN,
  p_configuration JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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


-- 8. Maintenance RPC
CREATE OR REPLACE FUNCTION public.superadmin_toggle_maintenance(
  p_scope TEXT,
  p_store_id UUID,
  p_enabled BOOLEAN,
  p_message_ar TEXT,
  p_message_en TEXT,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_expected_end_at TIMESTAMPTZ DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email TEXT;
  v_old_enabled BOOLEAN;
BEGIN
  -- Check superadmin authorization
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required';
  END IF;

  -- Validate scope
  IF p_scope NOT IN ('global', 'store') THEN
    RAISE EXCEPTION 'Invalid maintenance scope: %', p_scope;
  END IF;

  -- Delete existing row for scope/store
  IF p_scope = 'global' THEN
    SELECT enabled INTO v_old_enabled FROM public.system_maintenance WHERE scope = 'global' LIMIT 1;
    DELETE FROM public.system_maintenance WHERE scope = 'global';
  ELSE
    SELECT enabled INTO v_old_enabled FROM public.system_maintenance WHERE scope = 'store' AND store_id = p_store_id LIMIT 1;
    DELETE FROM public.system_maintenance WHERE scope = 'store' AND store_id = p_store_id;
  END IF;

  -- Insert new maintenance configuration
  INSERT INTO public.system_maintenance (scope, store_id, enabled, message_ar, message_en, starts_at, expected_end_at, enabled_by, enabled_at, disabled_by, disabled_at, updated_at)
  VALUES (p_scope, p_store_id, p_enabled, p_message_ar, p_message_en, p_starts_at, p_expected_end_at, 
          CASE WHEN p_enabled THEN auth.uid() END, CASE WHEN p_enabled THEN now() END,
          CASE WHEN NOT p_enabled THEN auth.uid() END, CASE WHEN NOT p_enabled THEN now() END, now());

  -- Backward compatibility with global settings
  IF p_scope = 'global' THEN
    UPDATE public.system_settings
    SET maintenance_mode = p_enabled
    WHERE id = 1;
  END IF;

  -- Audit
  v_actor_email := COALESCE(auth.jwt() ->> 'email', 'system');
  INSERT INTO public.superadmin_audit_logs (
    actor_user_id, actor_email, action, entity_type, entity_id, store_id, old_value, new_value
  ) VALUES (
    auth.uid(),
    v_actor_email,
    CASE WHEN p_enabled THEN 'maintenance_enabled' ELSE 'maintenance_disabled' END,
    'system_maintenance',
    COALESCE(p_store_id::text, 'global'),
    p_store_id,
    jsonb_build_object('enabled', COALESCE(v_old_enabled, false)),
    jsonb_build_object('enabled', p_enabled, 'scope', p_scope)
  );

END;
$$;


-- 9. Analytics RPC
CREATE OR REPLACE FUNCTION public.superadmin_global_analytics(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_store_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    'pending_orders', (SELECT count(*) FROM public.orders WHERE status = 'pending' AND (p_store_id IS NULL OR store_id = p_store_id)),
    'partially_paid_orders', (SELECT count(*) FROM public.orders WHERE status = 'partially_paid' AND (p_store_id IS NULL OR store_id = p_store_id)),
    'online_terminals', (SELECT count(*) FROM public.terminal_devices td JOIN public.restaurant_locations rl ON td.location_id = rl.id WHERE (p_store_id IS NULL OR rl.store_id = p_store_id) AND td.status = 'online' AND td.last_heartbeat_at >= now() - INTERVAL '60 seconds'),
    'offline_terminals', (SELECT count(*) FROM public.terminal_devices td JOIN public.restaurant_locations rl ON td.location_id = rl.id WHERE (p_store_id IS NULL OR rl.store_id = p_store_id) AND (td.status <> 'online' OR td.last_heartbeat_at < now() - INTERVAL '60 seconds'))
  ) INTO v_summary
  FROM public.orders o
  WHERE o.status = 'completed'
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND o.created_at >= p_start_date
    AND o.created_at <= p_end_date;

  -- Sales over time (daily)
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_sales_over_time
  FROM (
    SELECT 
      o.created_at::date::text AS day,
      COALESCE(SUM(o.total_amount), 0) - COALESCE((SELECT SUM(r.refund_amount) FROM public.refunds r WHERE r.store_id = o.store_id AND r.created_at::date = o.created_at::date), 0) AS gross_sales,
      COALESCE(SUM(o.subtotal_excl_vat), 0) - COALESCE((SELECT SUM(r.net_amount) FROM public.refunds r WHERE r.store_id = o.store_id AND r.created_at::date = o.created_at::date), 0) AS net_sales,
      COUNT(o.id) AS order_count
    FROM public.orders o
    WHERE o.status = 'completed'
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
      AND o.created_at >= p_start_date
      AND o.created_at <= p_end_date
    GROUP BY o.created_at::date, o.store_id
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

  -- VAT breakdown by rate
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_vat_breakdown
  FROM (
    SELECT 
      oi.vat_rate,
      SUM(oi.vat_amount) - COALESCE((SELECT SUM(r.vat_amount) FROM public.refunds r WHERE r.vat_rate = oi.vat_rate AND (p_store_id IS NULL OR r.store_id = oi.store_id) AND r.created_at >= p_start_date AND r.created_at <= p_end_date), 0) AS total_vat
    FROM public.order_items oi
    JOIN public.orders o ON oi.order_id = o.id
    WHERE o.status = 'completed'
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
      AND o.created_at >= p_start_date
      AND o.created_at <= p_end_date
    GROUP BY oi.vat_rate, oi.store_id
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

  -- Store performance table rows
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_store_performance
  FROM (
    SELECT 
      s.id AS store_id,
      s.name AS store_name,
      CASE WHEN s.onboarding_completed THEN 'Active' ELSE 'Pending' END AS store_status,
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


-- 10. Update create_accounting_order with maintenance checks
CREATE OR REPLACE FUNCTION public.create_accounting_order(
  p_store_id uuid,
  p_device_id uuid,
  p_cashier_session_id uuid,
  p_status text,
  p_payment_method text,
  p_order_type text,
  p_currency text,
  p_discount_amount numeric,
  p_subtotal_excl_vat numeric,
  p_vat_amount numeric,
  p_total_amount numeric,
  p_raw_payload jsonb,
  p_lines jsonb
) RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders;
  v_receipt BIGINT;
  v_line JSONB;
  v_product public.products;
  v_component RECORD;
  v_tax RECORD;
  v_gross NUMERIC;
  v_discount NUMERIC := 0;
  v_cart_gross NUMERIC := 0;
  v_net NUMERIC := 0;
  v_vat NUMERIC := 0;
  v_alloc NUMERIC := 0;
  v_line_discount NUMERIC;
  v_device public.pos_devices;
  v_session public.cashier_sessions;
  v_cashier_user_id UUID;
  v_raw_payload JSONB;
  v_modifier_total NUMERIC;
  v_coupon_code TEXT;
  v_coupon_type TEXT;
  v_coupon_value NUMERIC;
  v_quantity INTEGER;
  v_weight_total NUMERIC;
  v_component_gross NUMERIC;
  v_component_discount NUMERIC;
  v_component_quantity NUMERIC;
BEGIN
  -- 0. Check Maintenance Mode
  IF EXISTS (
    SELECT 1 FROM public.system_maintenance
    WHERE enabled = true 
      AND (scope = 'global' OR (scope = 'store' AND store_id = p_store_id))
  ) THEN
    -- Allow superadmin to bypass
    IF NOT (SELECT public.is_superadmin()) THEN
      RAISE EXCEPTION 'SYSTEM_UNDER_MAINTENANCE';
    END IF;
  END IF;

  -- 1. POS Device Validation
  IF p_device_id IS NULL THEN
    RAISE EXCEPTION 'POS_DEVICE_NOT_FOUND';
  END IF;

  SELECT * INTO v_device FROM public.pos_devices WHERE id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_DEVICE_NOT_FOUND';
  END IF;

  IF v_device.status::text <> 'active' THEN
    RAISE EXCEPTION 'POS_DEVICE_DISABLED_OR_REVOKED';
  END IF;

  IF v_device.store_id <> p_store_id THEN
    RAISE EXCEPTION 'POS_DEVICE_STORE_MISMATCH';
  END IF;

  -- 2. Cashier Session (Shift) Validation
  IF p_cashier_session_id IS NULL THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_REQUIRED';
  END IF;

  SELECT * INTO v_session FROM public.cashier_sessions WHERE id = p_cashier_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_NOT_FOUND';
  END IF;

  IF v_session.status::text <> 'open' THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_CLOSED';
  END IF;

  IF v_session.device_id <> p_device_id THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_DEVICE_MISMATCH';
  END IF;

  IF COALESCE(v_session.store_id, v_device.store_id) <> p_store_id THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_STORE_MISMATCH';
  END IF;

  -- 3. Tenant Authorization Check
  IF NOT (
    v_device.store_id = p_store_id
    OR EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = p_store_id AND su.user_id = (SELECT auth.uid()))
    OR (SELECT public.is_superadmin())
    OR (SELECT auth.role()) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Not allowed to create an order for this store';
  END IF;

  -- 4. Payload & State Validation
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Order requires lines';
  END IF;

  IF p_status NOT IN ('pending', 'completed')
     OR p_payment_method NOT IN ('cash', 'card', 'split')
     OR p_order_type NOT IN ('dine_in', 'takeaway') THEN
    RAISE EXCEPTION 'Invalid order state';
  END IF;

  -- Extract cashier user and merge cashier name into raw_payload
  v_cashier_user_id := COALESCE(v_session.cashier_user_id, (SELECT auth.uid()));
  v_raw_payload := COALESCE(p_raw_payload, '{}'::jsonb);
  IF v_session.cashier_name IS NOT NULL THEN
    v_raw_payload := v_raw_payload || jsonb_build_object('cashier_name', v_session.cashier_name);
  END IF;

  -- 5. Product & Cart Pre-calculation
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_line->>'productId')::uuid AND store_id = p_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING';
    END IF;
    PERFORM 1 FROM public.resolve_store_tax_rate(v_product.id, p_store_id, p_order_type);
    v_quantity := GREATEST(1, (v_line->>'quantity')::integer);
    IF EXISTS (SELECT 1 FROM public.product_bundle_components bc WHERE bc.bundle_product_id = v_product.id) THEN
      v_cart_gross := v_cart_gross + v_product.price * v_quantity;
    ELSE
      SELECT COALESCE(SUM(m.price_adjustment), 0) INTO v_modifier_total
      FROM public.modifiers m
      WHERE m.product_id = v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds', '[]'::jsonb)));
      v_cart_gross := v_cart_gross + (v_product.price + v_modifier_total) * v_quantity;
    END IF;
  END LOOP;

  -- 6. Coupon Processing
  v_coupon_code := NULLIF(trim(COALESCE(v_raw_payload->>'coupon_code', '')), '');
  IF v_coupon_code IS NOT NULL THEN
    IF to_regclass('public.coupons') IS NULL THEN
      RAISE EXCEPTION 'COUPON_INVALID';
    END IF;
    EXECUTE 'SELECT discount_type, discount_value FROM public.coupons WHERE store_id=$1 AND lower(code)=lower($2) AND is_active=true'
      INTO v_coupon_type, v_coupon_value USING p_store_id, v_coupon_code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COUPON_INVALID';
    END IF;
    v_discount := CASE v_coupon_type
      WHEN 'percentage' THEN ROUND(v_cart_gross * v_coupon_value / 100, 4)
      WHEN 'fixed' THEN v_coupon_value
      ELSE 0
    END;
  END IF;

  v_discount := LEAST(GREATEST(COALESCE(v_discount, 0), 0), v_cart_gross);
  v_receipt := public.next_store_receipt_number(p_store_id);

  -- 7. Insert Order Header
  INSERT INTO public.orders (
    store_id, status, total_amount, raw_payload, receipt_number, order_type,
    cashier_session_id, pos_device_id, completed_at, subtotal_excl_vat, vat_amount,
    discount_amount, currency, cashier_user_id
  ) VALUES (
    p_store_id, p_status, 0, v_raw_payload, v_receipt, p_order_type,
    p_cashier_session_id, p_device_id, CASE WHEN p_status = 'completed' THEN now() END,
    0, 0, v_discount, COALESCE(p_currency, 'EUR'), v_cashier_user_id
  ) RETURNING * INTO v_order;

  -- 8. Insert Order Items (with Bundles & Accounting Snapshots)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_line->>'productId')::uuid AND store_id = p_store_id;
    v_quantity := GREATEST(1, (v_line->>'quantity')::integer);

    IF EXISTS (SELECT 1 FROM public.product_bundle_components bc WHERE bc.bundle_product_id = v_product.id) THEN
      v_gross := v_product.price * v_quantity;
      v_line_discount := CASE WHEN v_alloc + v_gross = v_cart_gross THEN v_discount - v_alloc ELSE ROUND(v_discount * v_gross / NULLIF(v_cart_gross, 0), 4) END;
      v_alloc := v_alloc + v_line_discount;
      SELECT SUM(bc.allocation_weight * cp.price) INTO v_weight_total
      FROM public.product_bundle_components bc JOIN public.products cp ON cp.id = bc.component_product_id
      WHERE bc.bundle_product_id = v_product.id;
      IF COALESCE(v_weight_total, 0) <= 0 THEN
        RAISE EXCEPTION 'BUNDLE_CONFIGURATION_MISSING';
      END IF;

      FOR v_component IN
        SELECT bc.component_product_id, bc.quantity, bc.allocation_weight, cp.name, cp.price
        FROM public.product_bundle_components bc JOIN public.products cp ON cp.id = bc.component_product_id
        WHERE bc.bundle_product_id = v_product.id
      LOOP
        v_component_quantity := v_component.quantity * v_quantity;
        v_component_gross := ROUND(v_gross * (v_component.allocation_weight * v_component.price) / v_weight_total, 4);
        v_component_discount := ROUND(v_line_discount * (v_component.allocation_weight * v_component.price) / v_weight_total, 4);
        SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_component.component_product_id, p_store_id, p_order_type);
        v_component_gross := GREATEST(0, v_component_gross - v_component_discount);
        v_net := v_net + ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4);
        v_vat := v_vat + ROUND(v_component_gross - ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4), 4);

        INSERT INTO public.order_items (
          order_id, product_id, store_id, quantity, subtotal, product_name_snapshot,
          category_name_snapshot, vat_rate, vat_rate_snapshot, unit_price_incl_vat,
          discount_amount, net_amount, vat_amount, gross_amount, accounting_group_id_snapshot,
          accounting_group_name_snapshot, accounting_code_snapshot, tax_profile_name_snapshot,
          order_type_snapshot, bundle_product_id_snapshot, bundle_product_name_snapshot,
          bundle_component_weight_snapshot
        ) VALUES (
          v_order.id, v_component.component_product_id, p_store_id, v_component_quantity, v_component_gross,
          v_component.name, (SELECT name FROM public.categories c JOIN public.products p ON p.category_id = c.id WHERE p.id = v_component.component_product_id),
          v_tax.vat_rate, v_tax.vat_rate, ROUND(v_component_gross / NULLIF(v_component_quantity, 0), 4),
          v_component_discount, ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4),
          ROUND(v_component_gross - ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4), 4),
          v_component_gross, v_tax.accounting_group_id, v_tax.accounting_group_name,
          v_tax.accounting_code, v_tax.tax_profile_name, p_order_type, v_product.id,
          v_product.name, v_component.allocation_weight
        );
      END LOOP;
    ELSE
      SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_product.id, p_store_id, p_order_type);
      SELECT COALESCE(SUM(m.price_adjustment), 0) INTO v_modifier_total
      FROM public.modifiers m
      WHERE m.product_id = v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds', '[]'::jsonb)));
      v_gross := (v_product.price + v_modifier_total) * v_quantity;
      v_line_discount := CASE WHEN v_alloc + v_gross = v_cart_gross THEN v_discount - v_alloc ELSE ROUND(v_discount * v_gross / NULLIF(v_cart_gross, 0), 4) END;
      v_alloc := v_alloc + v_line_discount;
      v_gross := v_gross - v_line_discount;
      v_net := v_net + ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4);
      v_vat := v_vat + ROUND(v_gross - ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4), 4);

      INSERT INTO public.order_items (
        order_id, product_id, store_id, quantity, subtotal, product_name_snapshot,
        category_name_snapshot, vat_rate, vat_rate_snapshot, unit_price_incl_vat,
        discount_amount, net_amount, vat_amount, gross_amount, accounting_group_id_snapshot,
        accounting_group_name_snapshot, accounting_code_snapshot, tax_profile_name_snapshot,
        order_type_snapshot
      ) VALUES (
        v_order.id, v_product.id, p_store_id, v_quantity, v_gross, v_product.name,
        (SELECT name FROM public.categories WHERE id = v_product.category_id), v_tax.vat_rate,
        v_tax.vat_rate, v_product.price + v_modifier_total, v_line_discount,
        ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4),
        ROUND(v_gross - ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4), 4),
        v_gross, v_tax.accounting_group_id, v_tax.accounting_group_name,
        v_tax.accounting_code, v_tax.tax_profile_name, p_order_type
      );
    END IF;
  END LOOP;

  -- Update totals on Order
  UPDATE public.orders
  SET total_amount = ROUND(v_net + v_vat, 4),
      subtotal_excl_vat = ROUND(v_net, 4),
      vat_amount = ROUND(v_vat, 4)
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  -- Legacy Payment Insertion
  IF p_payment_method <> 'split' THEN
    INSERT INTO public.payments (
      store_id, order_id, method, status, amount, provider, paid_at
    ) VALUES (
      p_store_id, v_order.id, p_payment_method,
      CASE WHEN p_status = 'completed' THEN 'paid' ELSE 'pending' END,
      v_order.total_amount,
      CASE WHEN p_payment_method = 'card' THEN 'stripe' END,
      CASE WHEN p_status = 'completed' THEN now() END
    );
  END IF;

  RETURN v_order;
END $function$;


-- 11. Update request_terminal_card_payment with maintenance checks
CREATE OR REPLACE FUNCTION public.request_terminal_card_payment(
  p_order_id uuid,
  p_pos_device_id uuid DEFAULT NULL::uuid
) RETURNS payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders;
  v_location public.restaurant_locations;
  v_config public.restaurant_payment_configs;
  v_request public.payment_requests;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not available';
  END IF;

  -- Check Maintenance Mode
  IF EXISTS (
    SELECT 1 FROM public.system_maintenance
    WHERE enabled = true 
      AND (scope = 'global' OR (scope = 'store' AND store_id = v_order.store_id))
  ) THEN
    -- Allow superadmin to bypass
    IF NOT (SELECT public.is_superadmin()) THEN
      RAISE EXCEPTION 'SYSTEM_UNDER_MAINTENANCE';
    END IF;
  END IF;

  SELECT * INTO v_location FROM public.restaurant_locations WHERE store_id = v_order.store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store has no restaurant payment location';
  END IF;

  IF NOT (
    public.is_location_member(v_location.id)
    OR EXISTS (SELECT 1 FROM public.pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = v_order.store_id AND d.status = 'active')
  ) THEN
    RAISE EXCEPTION 'Order not available';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not awaiting card payment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_requests pr
    WHERE pr.location_id = v_location.id
      AND pr.order_id <> v_order.id
      AND pr.status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      AND pr.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Another terminal payment is already active for this location';
  END IF;

  SELECT * INTO v_config
  FROM public.restaurant_payment_configs
  WHERE location_id = v_location.id AND provider_type = 'stripe_android_bridge' AND is_enabled
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card terminal is not configured for this location';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.terminal_devices d
    WHERE d.location_id = v_location.id
      AND d.payment_config_id = v_config.id
      AND d.status = 'online'
      AND d.reader_status = 'connected'
      AND d.last_heartbeat_at > now() - INTERVAL '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Card payment bridge or reader is unavailable';
  END IF;

  INSERT INTO public.payment_requests (restaurant_id, location_id, order_id, payment_config_id, provider_type, idempotency_key)
  VALUES (v_location.restaurant_id, v_location.id, v_order.id, v_config.id, v_config.provider_type, 'terminal-payment:' || v_order.id::text)
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$function$;


-- 12. Update create_split_payment with maintenance checks
CREATE OR REPLACE FUNCTION public.create_split_payment(
  p_order_id uuid,
  p_cash_amount_cents bigint,
  p_card_amount_cents bigint,
  p_idempotency_key text,
  p_pos_device_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders;
  v_split public.payment_splits;
  v_cash_part public.payment_split_parts;
  v_card_part public.payment_split_parts;
  v_cash_payment public.payments;
  v_config public.restaurant_payment_configs;
  v_request public.payment_requests;
  v_total_cents BIGINT;
  v_flag BOOLEAN;
  v_existing_split public.payment_splits;
  v_loc_id UUID;
BEGIN
  -- Check idempotency key first
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;

  SELECT * INTO v_existing_split FROM public.payment_splits WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_request FROM public.payment_requests WHERE order_id = v_existing_split.order_id ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'split_id', v_existing_split.id,
      'card_payment_request_id', v_request.id,
      'status', v_existing_split.status,
      'is_duplicate', true
    );
  END IF;

  -- Lock and fetch order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  -- Check Maintenance Mode
  IF EXISTS (
    SELECT 1 FROM public.system_maintenance
    WHERE enabled = true 
      AND (scope = 'global' OR (scope = 'store' AND store_id = v_order.store_id))
  ) THEN
    -- Allow superadmin to bypass
    IF NOT (SELECT public.is_superadmin()) THEN
      RAISE EXCEPTION 'SYSTEM_UNDER_MAINTENANCE';
    END IF;
  END IF;

  -- Authorization check
  IF NOT (
    EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = v_order.store_id AND su.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = v_order.store_id AND d.status::text = 'active')
    OR (SELECT public.is_superadmin())
    OR (SELECT auth.role()) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Not allowed to create a split payment for this order';
  END IF;

  -- Feature flag check
  SELECT split_payment_enabled INTO v_flag FROM public.stores WHERE id = v_order.store_id;
  IF COALESCE(v_flag, false) = false THEN
    RAISE EXCEPTION 'Split payment feature is not enabled for this restaurant';
  END IF;

  -- Confirm order is unpaid
  IF v_order.status NOT IN ('new', 'pending', 'partially_paid') THEN
    RAISE EXCEPTION 'Order is not in an unpaid state';
  END IF;

  -- Amount validation using integer cents
  v_total_cents := round(v_order.total_amount * 100);
  IF p_cash_amount_cents <= 0 OR p_card_amount_cents <= 0 THEN
    RAISE EXCEPTION 'A split payment must contain positive cash and card amounts';
  END IF;
  IF (p_cash_amount_cents + p_card_amount_cents) <> v_total_cents THEN
    RAISE EXCEPTION 'Cash and card amounts do not equal the order total exactly';
  END IF;

  -- Find terminal card payment config
  SELECT * INTO v_config FROM public.restaurant_payment_configs
  WHERE (location_id = v_order.store_id OR location_id IN (SELECT id FROM public.restaurant_locations WHERE store_id = v_order.store_id))
    AND provider_type IN ('stripe_android_bridge','stripe_server_driven') AND is_primary AND is_enabled LIMIT 1;
  
  v_loc_id := COALESCE(v_config.location_id, v_order.store_id);

  IF v_config.id IS NULL THEN
    RAISE EXCEPTION 'Card terminal is not configured for this location';
  END IF;

  -- Create split header record
  INSERT INTO public.payment_splits (
    restaurant_id, location_id, store_id, order_id, total_amount_cents, currency, status, idempotency_key, created_by, cash_confirmed_by, cash_confirmed_at
  ) VALUES (
    v_loc_id, v_loc_id, v_order.store_id, v_order.id, v_total_cents, COALESCE(v_order.currency, 'EUR'),
    'awaiting_card', p_idempotency_key, (SELECT auth.uid()), (SELECT auth.uid()), now()
  ) RETURNING * INTO v_split;

  -- Create cash split part (succeeded)
  INSERT INTO public.payment_split_parts (
    split_id, order_id, method, amount_cents, status, completed_at
  ) VALUES (
    v_split.id, v_order.id, 'cash', p_cash_amount_cents, 'succeeded', now()
  ) RETURNING * INTO v_cash_part;

  -- Record cash payment row in payments table
  INSERT INTO public.payments (
    store_id, order_id, method, status, amount, paid_at
  ) VALUES (
    v_order.store_id, v_order.id, 'cash', 'paid', (p_cash_amount_cents / 100.0), now()
  ) RETURNING * INTO v_cash_payment;

  UPDATE public.payment_split_parts SET payment_id = v_cash_payment.id WHERE id = v_cash_part.id;

  -- Update order status to partially_paid
  UPDATE public.orders SET status = 'partially_paid' WHERE id = v_order.id;

  -- Create card split part (pending)
  INSERT INTO public.payment_split_parts (
    split_id, order_id, method, amount_cents, status
  ) VALUES (
    v_split.id, v_order.id, 'card', p_card_amount_cents, 'pending'
  ) RETURNING * INTO v_card_part;

  -- Create card payment_request for card_amount_cents ONLY
  INSERT INTO public.payment_requests (
    restaurant_id, location_id, order_id, payment_config_id, provider_type, status, idempotency_key, amount_cents, split_part_id
  ) VALUES (
    v_loc_id, v_loc_id, v_order.id, v_config.id, v_config.provider_type, 'pending',
    'split-card:' || v_card_part.id::text, p_card_amount_cents, v_card_part.id
  ) RETURNING * INTO v_request;

  UPDATE public.payment_split_parts SET payment_request_id = v_request.id WHERE id = v_card_part.id;

  RETURN jsonb_build_object(
    'split_id', v_split.id,
    'card_payment_request_id', v_request.id,
    'cash_part_id', v_cash_part.id,
    'card_part_id', v_card_part.id,
    'status', 'awaiting_card',
    'cash_amount_cents', p_cash_amount_cents,
    'card_amount_cents', p_card_amount_cents,
    'is_duplicate', false
  );
END;
$function$;
