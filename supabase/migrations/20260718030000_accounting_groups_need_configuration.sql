-- Imported categories may become Accounting Groups before the owner has chosen
-- a legal tax profile. Catalog work remains possible; trusted checkout rejects
-- any product that reaches an unconfigured group.
ALTER TABLE public.accounting_groups ALTER COLUMN tax_profile_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_accounting_group_store() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tax_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tax_profiles p WHERE p.id = NEW.tax_profile_id AND p.store_id = NEW.store_id
  ) THEN
    RAISE EXCEPTION 'Accounting group tax profile must belong to the same store';
  END IF;
  RETURN NEW;
END $$;
