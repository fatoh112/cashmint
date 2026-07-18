-- Drop public policies
DROP POLICY IF EXISTS "Allow public insert of cashier sessions" ON public.cashier_sessions;
DROP POLICY IF EXISTS "Allow public select/update of cashier sessions" ON public.cashier_sessions;
DROP POLICY IF EXISTS "Allow store admins to select cashier sessions" ON public.cashier_sessions;

-- Allow inserts via device validation RPC context
CREATE POLICY "Allow public insert of sessions"
ON public.cashier_sessions FOR INSERT
WITH CHECK (
  device_id IN (
    SELECT id 
    FROM public.pos_devices 
    WHERE status = 'active'
  )
);

-- Secure select/update policies scoped to authenticated tenant
CREATE POLICY "Allow shift control of cashier sessions"
ON public.cashier_sessions FOR ALL
TO authenticated
USING (
  device_id IN (
    SELECT id 
    FROM public.pos_devices 
    WHERE store_id IN (
      SELECT store_id 
      FROM public.store_users 
      WHERE user_id = auth.uid()
    )
  ) OR is_superadmin()
)
WITH CHECK (
  device_id IN (
    SELECT id 
    FROM public.pos_devices 
    WHERE store_id IN (
      SELECT store_id 
      FROM public.store_users 
      WHERE user_id = auth.uid()
    )
  ) OR is_superadmin()
);
