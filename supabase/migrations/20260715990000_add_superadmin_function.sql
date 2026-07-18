CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.store_users
    WHERE user_id = auth.uid() AND role = 'superadmin'
  ) OR (
    auth.jwt() ->> 'email' IN ('picabeans@gmail.com', 'superadmin@cashmint.online')
  );
END;
$$;
