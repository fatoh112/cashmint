-- Drop broad open security policies
DROP POLICY IF EXISTS "Allow authenticated selects" ON public.stores;
DROP POLICY IF EXISTS "Allow authenticated inserts" ON public.stores;
DROP POLICY IF EXISTS "Allow users to select their mapped stores" ON public.stores;
DROP POLICY IF EXISTS "Allow members to update their stores" ON public.stores;
DROP POLICY IF EXISTS "Allow authenticated users to insert stores" ON public.stores;
DROP POLICY IF EXISTS "Allow superadmin SELECT on stores" ON public.stores;
DROP POLICY IF EXISTS "Allow superadmin INSERT on stores" ON public.stores;
DROP POLICY IF EXISTS "Allow superadmin UPDATE on stores" ON public.stores;
DROP POLICY IF EXISTS "Allow superadmin DELETE on stores" ON public.stores;

-- Enforce tenant-isolation policies on stores
CREATE POLICY "Allow members to select their store"
ON public.stores FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  ) OR is_superadmin()
);

CREATE POLICY "Allow members to update their store"
ON public.stores FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) OR is_superadmin()
)
WITH CHECK (
  id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) OR is_superadmin()
);

-- Superadmins manage creation/deletion
CREATE POLICY "Allow superadmins to create stores"
ON public.stores FOR INSERT
TO authenticated
WITH CHECK (is_superadmin());

CREATE POLICY "Allow superadmins to delete stores"
ON public.stores FOR DELETE
TO authenticated
USING (is_superadmin());

-- Allow users to create stores during onboarding wizard if they lack active stores
CREATE POLICY "Allow onboarding wizard store creation"
ON public.stores FOR INSERT
TO authenticated
WITH CHECK (
  NOT EXISTS (
    SELECT 1 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  )
);
