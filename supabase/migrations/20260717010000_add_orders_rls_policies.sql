-- Create RLS policies for orders and order_items tables

-- Drop existing broad open policies if they exist
DROP POLICY IF EXISTS "Allow store members to select orders" ON public.orders;
DROP POLICY IF EXISTS "Allow store members to insert orders" ON public.orders;
DROP POLICY IF EXISTS "Allow store members to select order_items" ON public.order_items;
DROP POLICY IF EXISTS "Allow store members to insert order_items" ON public.order_items;

-- 1. Enable RLS (already enabled in previous migration, but done here for robustness)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- 2. CREATE SELECT POLICY FOR ORDERS
CREATE POLICY "Allow store members to select orders"
ON public.orders FOR SELECT
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  ) OR is_superadmin()
);

-- 3. CREATE INSERT POLICY FOR ORDERS
CREATE POLICY "Allow store members to insert orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  ) OR is_superadmin()
);

-- 4. CREATE SELECT POLICY FOR ORDER_ITEMS
CREATE POLICY "Allow store members to select order_items"
ON public.order_items FOR SELECT
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  ) OR is_superadmin()
);

-- 5. CREATE INSERT POLICY FOR ORDER_ITEMS
CREATE POLICY "Allow store members to insert order_items"
ON public.order_items FOR INSERT
TO authenticated
WITH CHECK (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  ) OR is_superadmin()
);
