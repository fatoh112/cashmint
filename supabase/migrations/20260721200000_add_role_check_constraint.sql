-- Additive migration to enforce database-level CHECK constraints on allowed user roles
ALTER TABLE public.store_users
ADD CONSTRAINT store_users_role_check CHECK (role IN ('cashier', 'admin', 'superadmin'));
