-- The public bucket serves known logo URLs; an explicit broad SELECT policy is
-- unnecessary and would allow bucket-wide object listing.
DROP POLICY IF EXISTS "Public Access to Logos" ON storage.objects;
