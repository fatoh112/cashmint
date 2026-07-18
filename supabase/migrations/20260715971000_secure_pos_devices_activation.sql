-- Drop public read policies that expose raw activation codes
DROP POLICY IF EXISTS "Allow public read of devices" ON public.pos_devices;
DROP POLICY IF EXISTS "Allow store admins to manage devices" ON public.pos_devices;

-- Create secure verify function
CREATE OR REPLACE FUNCTION public.verify_pos_device_activation(code_input TEXT)
RETURNS TABLE (device_id UUID, store_id UUID, device_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT id, public.pos_devices.store_id, public.pos_devices.device_name
  FROM public.pos_devices
  WHERE activation_code = code_input AND status = 'active';
END;
$$;

-- Create secure, tenant-isolated read policies
CREATE POLICY "Allow authenticated read of devices"
ON public.pos_devices FOR SELECT
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid()
  ) OR is_superadmin()
);

-- Manage policies for store admins
CREATE POLICY "Allow store admins full control of devices"
ON public.pos_devices FOR ALL
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) OR is_superadmin()
)
WITH CHECK (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) OR is_superadmin()
);
