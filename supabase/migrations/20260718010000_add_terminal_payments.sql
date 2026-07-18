-- Restaurant-neutral terminal payment foundation.  Existing stores are modelled as
-- locations so the current POS can be migrated without changing its workflow.
CREATE TABLE IF NOT EXISTS public.restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.restaurant_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  store_id UUID UNIQUE REFERENCES public.stores(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[a-z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, name)
);

-- One configuration is active per provider at a location.  Stripe account and
-- Location IDs belong here, never in a web or Android client.
CREATE TABLE IF NOT EXISTS public.restaurant_payment_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  currency TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, provider_type),
  CHECK (provider_type IN ('stripe_android_bridge', 'stripe_smart_reader', 'adyen', 'mollie', 'worldline'))
);

CREATE TABLE IF NOT EXISTS public.terminal_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  payment_config_id UUID NOT NULL REFERENCES public.restaurant_payment_configs(id) ON DELETE RESTRICT,
  bridge_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  hardware_type TEXT NOT NULL DEFAULT 'bbpos_wisepad_3',
  stripe_reader_serial TEXT,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','online','disabled')),
  reader_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (reader_status IN ('disconnected','discovering','connected','error')),
  last_heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, display_name)
);

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_config_id UUID NOT NULL REFERENCES public.restaurant_payment_configs(id) ON DELETE RESTRICT,
  provider_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','succeeded','failed','cancel_requested','cancelled','expired','unknown')),
  claimed_by_device_id UUID REFERENCES public.terminal_devices(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_payment_intent_client_secret TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  failure_code TEXT,
  failure_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES public.restaurants(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.restaurant_locations(id);
CREATE INDEX IF NOT EXISTS idx_terminal_devices_location_status ON public.terminal_devices(location_id, status, reader_status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_dispatch ON public.payment_requests(location_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_location ON public.orders(id, location_id);

-- Backfill the single-tenant store model. New restaurant/location rows should be
-- provisioned with the same transaction as a new store.
INSERT INTO public.restaurants (id, name)
SELECT s.id, s.name FROM public.stores s ON CONFLICT (id) DO NOTHING;
INSERT INTO public.restaurant_locations (id, restaurant_id, store_id, name, currency)
SELECT s.id, s.id, s.id, s.name, lower(COALESCE(s.currency, 'EUR')) FROM public.stores s
ON CONFLICT (id) DO NOTHING;
UPDATE public.orders o SET restaurant_id = l.restaurant_id, location_id = l.id
FROM public.restaurant_locations l WHERE l.store_id = o.store_id AND (o.restaurant_id IS NULL OR o.location_id IS NULL);

ALTER TABLE public.orders ALTER COLUMN restaurant_id SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN location_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_order_payment_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.location_id IS NULL THEN
    SELECT id, restaurant_id INTO NEW.location_id, NEW.restaurant_id
    FROM restaurant_locations WHERE store_id = NEW.store_id;
  END IF;
  IF NEW.location_id IS NULL OR NEW.restaurant_id IS NULL THEN RAISE EXCEPTION 'Store has no restaurant payment location'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_set_payment_tenant ON public.orders;
CREATE TRIGGER orders_set_payment_tenant BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_order_payment_tenant();
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_location_member(p_location_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM restaurant_locations l JOIN store_users su ON su.store_id = l.store_id
    WHERE l.id = p_location_id AND su.user_id = (SELECT auth.uid())
  ) OR (SELECT is_superadmin());
$$;

REVOKE ALL ON FUNCTION public.is_location_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_order_payment_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_location_member(UUID) TO authenticated;

CREATE POLICY "Restaurant members can read restaurants" ON public.restaurants FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM restaurant_locations l WHERE l.restaurant_id = id AND is_location_member(l.id)));
CREATE POLICY "Restaurant members can read locations" ON public.restaurant_locations FOR SELECT TO authenticated USING (is_location_member(id));
CREATE POLICY "Restaurant members can read payment configs" ON public.restaurant_payment_configs FOR SELECT TO authenticated USING (is_location_member(location_id));
CREATE POLICY "Restaurant members can read terminals" ON public.terminal_devices FOR SELECT TO authenticated USING (is_location_member(location_id) OR bridge_user_id = (SELECT auth.uid()));
CREATE POLICY "Restaurant members can read payment requests" ON public.payment_requests FOR SELECT TO authenticated
USING (is_location_member(location_id) OR (claimed_by_device_id IN (SELECT id FROM terminal_devices WHERE bridge_user_id = (SELECT auth.uid()))));

-- The bridge only receives pending work for its own location and can never write
-- arbitrary data. State changes go through the RPC below.
CREATE POLICY "Bridge can read pending work for its location" ON public.payment_requests FOR SELECT TO authenticated
USING (status = 'pending' AND EXISTS (SELECT 1 FROM terminal_devices d WHERE d.location_id = payment_requests.location_id AND d.bridge_user_id = (SELECT auth.uid()) AND d.status = 'online'));

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
  SELECT * INTO v_config FROM restaurant_payment_configs
    WHERE location_id = v_order.location_id AND provider_type = 'stripe_android_bridge' AND is_enabled LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card terminal is not configured for this location'; END IF;
  IF NOT EXISTS (SELECT 1 FROM terminal_devices d WHERE d.location_id = v_order.location_id AND d.payment_config_id = v_config.id AND d.status = 'online' AND d.reader_status = 'connected') THEN
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
DECLARE v_location public.restaurant_locations; v_available BOOLEAN;
BEGIN
  SELECT * INTO v_location FROM restaurant_locations WHERE store_id = p_store_id;
  IF NOT FOUND OR NOT (is_location_member(v_location.id) OR EXISTS (SELECT 1 FROM pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = p_store_id AND d.status::text = 'active')) THEN
    RAISE EXCEPTION 'Not allowed to inspect terminal availability';
  END IF;
  SELECT EXISTS (SELECT 1 FROM terminal_devices d JOIN restaurant_payment_configs c ON c.id = d.payment_config_id
    WHERE d.location_id = v_location.id AND d.status = 'online' AND d.reader_status = 'connected' AND c.provider_type = 'stripe_android_bridge' AND c.is_enabled)
  INTO v_available;
  RETURN jsonb_build_object('available', v_available);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_terminal_payment_request(p_payment_request_id UUID)
RETURNS public.payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_device public.terminal_devices; v_request public.payment_requests;
BEGIN
  SELECT * INTO v_device FROM terminal_devices WHERE bridge_user_id = (SELECT auth.uid()) AND status = 'online' AND reader_status = 'connected' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered online reader bridge required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_device.id::text));
  UPDATE payment_requests SET status = 'claimed', claimed_by_device_id = v_device.id, claimed_at = now(), updated_at = now()
  WHERE id = p_payment_request_id AND location_id = v_device.location_id AND status = 'pending' AND expires_at > now()
  RETURNING * INTO v_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request is no longer claimable'; END IF;
  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_update_terminal_payment(p_payment_request_id UUID, p_status TEXT, p_failure_code TEXT DEFAULT NULL, p_failure_message TEXT DEFAULT NULL)
RETURNS public.payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.payment_requests; v_device_id UUID;
BEGIN
  SELECT id INTO v_device_id FROM terminal_devices WHERE bridge_user_id = (SELECT auth.uid());
  UPDATE payment_requests SET status = p_status, failure_code = p_failure_code, failure_message = p_failure_message, updated_at = now()
  WHERE id = p_payment_request_id AND claimed_by_device_id = v_device_id
    AND p_status IN ('creating_payment_intent','waiting_for_card','processing','failed','cancelled','unknown')
  RETURNING * INTO v_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request is not owned by this bridge'; END IF;
  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_heartbeat(p_reader_status TEXT, p_last_error TEXT DEFAULT NULL)
RETURNS public.terminal_devices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_device public.terminal_devices;
BEGIN
  UPDATE terminal_devices SET status = 'online', reader_status = p_reader_status, last_error = p_last_error, last_heartbeat_at = now(), updated_at = now()
  WHERE bridge_user_id = (SELECT auth.uid()) AND status <> 'disabled' RETURNING * INTO v_device;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered bridge required'; END IF;
  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public.request_terminal_card_payment(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.terminal_payment_availability(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_terminal_payment_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_update_terminal_payment(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_heartbeat(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_terminal_card_payment(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminal_payment_availability(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_terminal_payment_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_update_terminal_payment(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_heartbeat(TEXT, TEXT) TO authenticated;

-- Realtime is required by both the iPad and bridge. Tables retain RLS checks.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
