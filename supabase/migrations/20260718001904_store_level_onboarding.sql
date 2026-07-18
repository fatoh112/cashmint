-- Store-level first-login onboarding. Existing configured stores remain available.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS theme_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'store_name_required',
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_onboarding_status_check;
ALTER TABLE public.stores ADD CONSTRAINT stores_onboarding_status_check
  CHECK (onboarding_status IN ('store_name_required', 'branding_required', 'completed'));

-- Do not unexpectedly lock existing real stores. Newly inserted stores retain the
-- default incomplete state and are explicitly initialized by the superadmin UI.
UPDATE public.stores
SET onboarding_status = 'completed', onboarding_completed = true,
    onboarding_completed_at = COALESCE(onboarding_completed_at, now())
WHERE onboarding_completed = false
  AND NULLIF(btrim(name), '') IS NOT NULL
  AND lower(btrim(name)) NOT IN ('awaiting setup')
  AND lower(btrim(name)) NOT LIKE 'store for %';

UPDATE storage.buckets
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg']
WHERE id = 'logos';

-- Replace pre-existing permissive store policies with membership-scoped policies.
DROP POLICY IF EXISTS "Allow authenticated inserts" ON public.stores;
DROP POLICY IF EXISTS "Allow authenticated selects" ON public.stores;
DROP POLICY IF EXISTS "Allow store access" ON public.stores;
CREATE POLICY "Store members can read their assigned store" ON public.stores FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = stores.id AND su.user_id = (SELECT auth.uid())) OR (SELECT public.is_superadmin()));
CREATE POLICY "Superadmins can create stores" ON public.stores FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_superadmin()));
CREATE POLICY "Superadmins can update stores" ON public.stores FOR UPDATE TO authenticated
USING ((SELECT public.is_superadmin())) WITH CHECK ((SELECT public.is_superadmin()));

DROP POLICY IF EXISTS "Allow authenticated users to insert store_users mappings" ON public.store_users;

-- Storage uses a predictable per-store directory: logos/{store_id}/logo.ext.
DROP POLICY IF EXISTS "Allow Authenticated Uploads" ON storage.objects;
CREATE POLICY "Store members upload their logo" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'logos' AND (storage.foldername(name))[1] IS NOT NULL AND
  (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id::text = (storage.foldername(name))[1] AND su.user_id = (SELECT auth.uid())) OR (SELECT public.is_superadmin()))
);
CREATE POLICY "Store members replace their logo" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'logos' AND (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id::text = (storage.foldername(name))[1] AND su.user_id = (SELECT auth.uid())) OR (SELECT public.is_superadmin())))
WITH CHECK (bucket_id = 'logos' AND (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id::text = (storage.foldername(name))[1] AND su.user_id = (SELECT auth.uid())) OR (SELECT public.is_superadmin())));
CREATE POLICY "Store members remove their logo" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'logos' AND (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id::text = (storage.foldername(name))[1] AND su.user_id = (SELECT auth.uid())) OR (SELECT public.is_superadmin())));

-- A narrow, authorization-checked function prevents the browser from changing
-- arbitrary store fields while allowing an assigned administrator to progress.
CREATE OR REPLACE FUNCTION public.save_store_onboarding(
  p_store_name TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_theme_config JSONB DEFAULT NULL,
  p_complete BOOLEAN DEFAULT false
) RETURNS public.stores
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store_id UUID; v_store public.stores;
BEGIN
  SELECT store_id INTO v_store_id FROM public.store_users WHERE user_id = (SELECT auth.uid()) ORDER BY created_at LIMIT 1;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'No store is assigned to this user'; END IF;
  IF p_store_name IS NOT NULL THEN
    p_store_name := btrim(p_store_name);
    IF char_length(p_store_name) < 2 OR char_length(p_store_name) > 80 THEN RAISE EXCEPTION 'Store name must be between 2 and 80 characters'; END IF;
    UPDATE public.stores SET name = p_store_name, onboarding_status = 'branding_required', onboarding_completed = false WHERE id = v_store_id RETURNING * INTO v_store;
    RETURN v_store;
  END IF;
  IF p_complete THEN
    IF NULLIF(btrim(COALESCE(p_logo_url, '')), '') IS NULL OR p_theme_config IS NULL OR p_theme_config = '{}'::jsonb THEN RAISE EXCEPTION 'Logo and theme are required to complete onboarding'; END IF;
    UPDATE public.stores SET logo_url = p_logo_url, theme_config = p_theme_config, onboarding_status = 'completed', onboarding_completed = true, onboarding_completed_at = now() WHERE id = v_store_id RETURNING * INTO v_store;
    RETURN v_store;
  END IF;
  RAISE EXCEPTION 'Invalid onboarding request';
END;
$$;
REVOKE ALL ON FUNCTION public.save_store_onboarding(TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_store_onboarding(TEXT, TEXT, JSONB, BOOLEAN) TO authenticated;
