-- The onboarding policies are only enforceable when RLS is enabled.
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;
