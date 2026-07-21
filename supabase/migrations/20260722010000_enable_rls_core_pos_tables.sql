-- This migration mirrors security changes already applied to the connected production Supabase project.

-- Enable Row Level Security on core POS tables
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_sessions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Categories Policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anonymous read on categories" ON public.categories;
CREATE POLICY "Allow anonymous read on categories"
ON public.categories
FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Allow superadmin ALL on categories" ON public.categories;
CREATE POLICY "Allow superadmin ALL on categories"
ON public.categories
FOR ALL
TO authenticated
USING (is_superadmin())
WITH CHECK (is_superadmin());

DROP POLICY IF EXISTS "Enforce tenant isolation on categories" ON public.categories;
CREATE POLICY "Enforce tenant isolation on categories"
ON public.categories
FOR ALL
TO authenticated
USING (store_id IN (SELECT get_user_stores()))
WITH CHECK (store_id IN (SELECT get_user_stores()));

-- -----------------------------------------------------------------------------
-- Products Policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anonymous read on products" ON public.products;
CREATE POLICY "Allow anonymous read on products"
ON public.products
FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Allow superadmin ALL on products" ON public.products;
CREATE POLICY "Allow superadmin ALL on products"
ON public.products
FOR ALL
TO authenticated
USING (is_superadmin())
WITH CHECK (is_superadmin());

DROP POLICY IF EXISTS "Enforce tenant isolation on products" ON public.products;
CREATE POLICY "Enforce tenant isolation on products"
ON public.products
FOR ALL
TO authenticated
USING (store_id IN (SELECT get_user_stores()))
WITH CHECK (store_id IN (SELECT get_user_stores()));

-- -----------------------------------------------------------------------------
-- POS Devices Policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read of devices" ON public.pos_devices;

DROP POLICY IF EXISTS "Allow store members to read pos_devices" ON public.pos_devices;
CREATE POLICY "Allow store members to read pos_devices"
ON public.pos_devices
FOR SELECT
TO authenticated
USING (is_superadmin() OR (store_id IN (SELECT get_user_stores())));

DROP POLICY IF EXISTS "Allow store admins to manage devices" ON public.pos_devices;
CREATE POLICY "Allow store admins to manage devices"
ON public.pos_devices
FOR ALL
TO authenticated
USING (store_id IN (SELECT store_users.store_id FROM public.store_users WHERE store_users.user_id = auth.uid() AND store_users.role = 'admin'))
WITH CHECK (store_id IN (SELECT store_users.store_id FROM public.store_users WHERE store_users.user_id = auth.uid() AND store_users.role = 'admin'));

DROP POLICY IF EXISTS "Allow superadmin ALL on pos_devices" ON public.pos_devices;
CREATE POLICY "Allow superadmin ALL on pos_devices"
ON public.pos_devices
FOR ALL
TO authenticated
USING (is_superadmin())
WITH CHECK (is_superadmin());

-- -----------------------------------------------------------------------------
-- Cashier Sessions Policies
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow store members to read cashier sessions" ON public.cashier_sessions;
CREATE POLICY "Allow store members to read cashier sessions"
ON public.cashier_sessions
FOR SELECT
TO authenticated
USING (is_superadmin() OR (COALESCE(store_id, (SELECT d.store_id FROM public.pos_devices d WHERE d.id = cashier_sessions.device_id)) IN (SELECT get_user_stores())));

DROP POLICY IF EXISTS "Allow store admins to manage cashier sessions" ON public.cashier_sessions;
CREATE POLICY "Allow store admins to manage cashier sessions"
ON public.cashier_sessions
FOR ALL
TO authenticated
USING (is_superadmin() OR (EXISTS (SELECT 1 FROM public.store_users su WHERE su.user_id = auth.uid() AND su.role = 'admin' AND su.store_id = COALESCE(cashier_sessions.store_id, (SELECT d.store_id FROM public.pos_devices d WHERE d.id = cashier_sessions.device_id)))))
WITH CHECK (is_superadmin() OR (EXISTS (SELECT 1 FROM public.store_users su WHERE su.user_id = auth.uid() AND su.role = 'admin' AND su.store_id = COALESCE(cashier_sessions.store_id, (SELECT d.store_id FROM public.pos_devices d WHERE d.id = cashier_sessions.device_id)))));

-- -----------------------------------------------------------------------------
-- Dangerous Privileges & Table Grants
-- -----------------------------------------------------------------------------
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.categories FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.products FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.pos_devices FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.cashier_sessions FROM anon, authenticated;

-- Revoke anonymous write & access permissions
REVOKE ALL ON public.pos_devices FROM anon;
REVOKE ALL ON public.cashier_sessions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.products FROM anon;

GRANT SELECT ON public.categories TO anon;
GRANT SELECT ON public.products TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashier_sessions TO authenticated;
