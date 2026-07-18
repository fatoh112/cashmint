-- Create helper function to bypass RLS and verify store admin privileges
CREATE OR REPLACE FUNCTION public.check_user_is_store_admin(target_store_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.store_users
    WHERE user_id = auth.uid() AND store_id = target_store_id AND role = 'admin'
  );
END;
$$;

-- Drop recursive policies
DROP POLICY IF EXISTS "Allow users to read their own store mapping" ON public.store_users;
DROP POLICY IF EXISTS "Allow store admins to update mappings" ON public.store_users;
DROP POLICY IF EXISTS "Allow store admins to delete mappings" ON public.store_users;
DROP POLICY IF EXISTS "Allow authenticated users to insert store_users mappings" ON public.store_users;
DROP POLICY IF EXISTS "Allow superadmin SELECT on store_users" ON public.store_users;
DROP POLICY IF EXISTS "Allow superadmin INSERT on store_users" ON public.store_users;
DROP POLICY IF EXISTS "Allow superadmin UPDATE on store_users" ON public.store_users;
DROP POLICY IF EXISTS "Allow superadmin DELETE on store_users" ON public.store_users;

-- Create secure, non-recursive policies on store_users
CREATE POLICY "Allow select store_users mappings"
ON public.store_users FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR check_user_is_store_admin(store_id) OR is_superadmin());

CREATE POLICY "Allow insert store_users mappings"
ON public.store_users FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR check_user_is_store_admin(store_id) OR is_superadmin());

CREATE POLICY "Allow update store_users mappings"
ON public.store_users FOR UPDATE
TO authenticated
USING (check_user_is_store_admin(store_id) OR is_superadmin())
WITH CHECK (check_user_is_store_admin(store_id) OR is_superadmin());

CREATE POLICY "Allow delete store_users mappings"
ON public.store_users FOR DELETE
TO authenticated
USING (check_user_is_store_admin(store_id) OR is_superadmin());
