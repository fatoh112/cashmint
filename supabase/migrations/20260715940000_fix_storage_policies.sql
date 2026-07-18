-- Secure storage.objects policies for logos bucket

-- Requiring authentication for uploads (instead of public access)
DROP POLICY IF EXISTS "Allow Authenticated Uploads" ON storage.objects;

CREATE POLICY "Allow Authenticated Uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'logos'::text);

-- Admins can update/delete logo assets in storage
DROP POLICY IF EXISTS "Allow admins to delete logos" ON storage.objects;

CREATE POLICY "Allow admins to delete logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'logos'::text AND check_user_is_store_admin((SPLIT_PART(name, '-', 1))::uuid));

DROP POLICY IF EXISTS "Allow admins to update logos" ON storage.objects;

CREATE POLICY "Allow admins to update logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'logos'::text AND check_user_is_store_admin((SPLIT_PART(name, '-', 1))::uuid))
WITH CHECK (bucket_id = 'logos'::text AND check_user_is_store_admin((SPLIT_PART(name, '-', 1))::uuid));
