-- 1. Enable Row Level Security (RLS) on both tables
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies to prevent conflicts if they exist
DROP POLICY IF EXISTS "Allow authenticated users to insert stores" ON public.stores;
DROP POLICY IF EXISTS "Allow users to select their mapped stores" ON public.stores;
DROP POLICY IF EXISTS "Allow members to update their stores" ON public.stores;

DROP POLICY IF EXISTS "Allow authenticated users to insert store_users mappings" ON public.store_users;
DROP POLICY IF EXISTS "Allow users to read their own store mapping" ON public.store_users;
DROP POLICY IF EXISTS "Allow store admins to update mappings" ON public.store_users;
DROP POLICY IF EXISTS "Allow store admins to delete mappings" ON public.store_users;


-- ==========================================
-- POLICIES FOR 'stores' TABLE
-- ==========================================

-- Policy: Allow any authenticated user to create a new store (during onboarding)
CREATE POLICY "Allow authenticated users to insert stores" 
ON public.stores FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Policy: Allow store members to select/read the store details they belong to
CREATE POLICY "Allow users to select their mapped stores"
ON public.stores FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  )
);

-- Policy: Allow store members to update their store details
CREATE POLICY "Allow members to update their stores"
ON public.stores FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  )
);


-- ==========================================
-- POLICIES FOR 'store_users' TABLE
-- ==========================================

-- Policy: Allow authenticated users to link themselves to a store (during onboarding)
CREATE POLICY "Allow authenticated users to insert store_users mappings"
ON public.store_users FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Policy: Allow users to select/read mapping records of stores they belong to
CREATE POLICY "Allow users to read their own store mapping"
ON public.store_users FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() 
  OR store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  )
);

-- Policy: Allow store admins to update store mappings (e.g. change roles)
CREATE POLICY "Allow store admins to update mappings"
ON public.store_users FOR UPDATE
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Policy: Allow store admins to delete store mappings (e.g. remove employees)
CREATE POLICY "Allow store admins to delete mappings"
ON public.store_users FOR DELETE
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
