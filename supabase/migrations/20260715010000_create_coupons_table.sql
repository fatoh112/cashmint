-- Create coupons table
CREATE TABLE public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC NOT NULL CHECK (discount_value >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Ensure code is unique per store
  CONSTRAINT unique_store_coupon UNIQUE (store_id, code)
);

-- Enable RLS
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists
DROP POLICY IF EXISTS "Allow store members to select coupons" ON public.coupons;
DROP POLICY IF EXISTS "Allow store admins to manage coupons" ON public.coupons;

-- Policy: Allow store members (admins and cashiers) to read coupons for their store
CREATE POLICY "Allow store members to select coupons"
ON public.coupons FOR SELECT
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  )
);

-- Policy: Allow store admins to manage (insert/update/delete) coupons for their store
CREATE POLICY "Allow store admins to manage coupons"
ON public.coupons FOR ALL
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
