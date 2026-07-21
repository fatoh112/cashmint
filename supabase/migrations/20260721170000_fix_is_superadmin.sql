-- Fix is_superadmin function to return FALSE instead of NULL for unauthenticated sessions
CREATE OR REPLACE FUNCTION public.is_superadmin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN COALESCE(
    EXISTS (
      SELECT 1 FROM public.store_users
      WHERE user_id = auth.uid() AND role = 'superadmin'
    ) OR (
      auth.jwt() ->> 'email' IN ('picabeans@gmail.com', 'superadmin@cashmint.online')
    ),
    false
  );
END;
$function$;
