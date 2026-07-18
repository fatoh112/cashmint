-- Storage upsert requires SELECT in addition to INSERT and UPDATE.
CREATE POLICY "Store members read their logo for replacement" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'logos' AND (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id::text = (storage.foldername(name))[1] AND su.user_id = (SELECT auth.uid())) OR (SELECT public.is_superadmin())));
