-- Helper function to get email from user ID
CREATE OR REPLACE FUNCTION public.get_user_email(user_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email TEXT;
BEGIN
  SELECT email INTO user_email
  FROM auth.users
  WHERE id = user_uuid;
  
  RETURN user_email;
END;
$$;

-- Helper function to resolve email to user ID
CREATE OR REPLACE FUNCTION public.resolve_user_email(email_input TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_uuid UUID;
BEGIN
  SELECT id INTO user_uuid
  FROM auth.users
  WHERE email = email_input;
  
  RETURN user_uuid;
END;
$$;

-- Enable Row Level Security policies for superadmins on store_users
DROP POLICY IF EXISTS "Allow superadmin SELECT on store_users" ON public.store_users;
DROP POLICY IF EXISTS "Allow superadmin INSERT on store_users" ON public.store_users;
DROP POLICY IF EXISTS "Allow superadmin UPDATE on store_users" ON public.store_users;
DROP POLICY IF EXISTS "Allow superadmin DELETE on store_users" ON public.store_users;

CREATE POLICY "Allow superadmin SELECT on store_users"
ON public.store_users FOR SELECT
TO authenticated
USING (is_superadmin());

CREATE POLICY "Allow superadmin INSERT on store_users"
ON public.store_users FOR INSERT
TO authenticated
WITH CHECK (is_superadmin());

CREATE POLICY "Allow superadmin UPDATE on store_users"
ON public.store_users FOR UPDATE
TO authenticated
USING (is_superadmin())
WITH CHECK (is_superadmin());

CREATE POLICY "Allow superadmin DELETE on store_users"
ON public.store_users FOR DELETE
TO authenticated
USING (is_superadmin());

-- Enable Realtime for store_users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON pr.prpubid = p.oid
    JOIN pg_class c ON pr.prrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'store_users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.store_users;
  END IF;
END;
$$;
