-- Accounting groups and order-type tax profiles. products.vat_rate is retained
-- temporarily for legacy compatibility only; new checkout calculations must not
-- read it. Historical accounting snapshots are intentionally untouched.

CREATE TABLE public.tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL, code TEXT, rate NUMERIC(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT true, is_system_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);
CREATE UNIQUE INDEX tax_rates_store_code_unique ON public.tax_rates(store_id, code) WHERE code IS NOT NULL;

CREATE TABLE public.tax_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL, dine_in_tax_rate_id UUID REFERENCES public.tax_rates(id), takeaway_tax_rate_id UUID REFERENCES public.tax_rates(id),
  delivery_tax_rate_id UUID REFERENCES public.tax_rates(id), default_tax_rate_id UUID REFERENCES public.tax_rates(id),
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);

CREATE TABLE public.accounting_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL, accounting_code TEXT, tax_profile_id UUID NOT NULL REFERENCES public.tax_profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT true, is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);
CREATE UNIQUE INDEX accounting_groups_store_code_unique ON public.accounting_groups(store_id, accounting_code) WHERE accounting_code IS NOT NULL;
CREATE UNIQUE INDEX accounting_groups_one_default_per_store ON public.accounting_groups(store_id) WHERE is_default;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS accounting_group_id UUID REFERENCES public.accounting_groups(id);
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS accounting_group_id_snapshot UUID,
  ADD COLUMN IF NOT EXISTS accounting_group_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS accounting_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS tax_profile_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vat_rate_snapshot NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS order_type_snapshot TEXT;
CREATE INDEX idx_tax_rates_store_id ON public.tax_rates(store_id);
CREATE INDEX idx_tax_profiles_store_id ON public.tax_profiles(store_id);
CREATE INDEX idx_accounting_groups_store_id ON public.accounting_groups(store_id);
CREATE INDEX idx_accounting_groups_tax_profile_id ON public.accounting_groups(tax_profile_id);
CREATE INDEX idx_products_accounting_group_id ON public.products(accounting_group_id);

CREATE OR REPLACE FUNCTION public.assert_tax_profile_rate_store() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[NEW.dine_in_tax_rate_id, NEW.takeaway_tax_rate_id, NEW.delivery_tax_rate_id, NEW.default_tax_rate_id]) rate_id
             LEFT JOIN public.tax_rates r ON r.id = rate_id WHERE rate_id IS NOT NULL AND (r.id IS NULL OR r.store_id <> NEW.store_id)) THEN
    RAISE EXCEPTION 'Tax profile rates must belong to the same store';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.assert_accounting_group_store() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tax_profiles p WHERE p.id = NEW.tax_profile_id AND p.store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'Accounting group tax profile must belong to the same store';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.assert_product_accounting_group_store() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accounting_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounting_groups g WHERE g.id = NEW.accounting_group_id AND g.store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'Product accounting group must belong to the same store';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_profiles_same_store BEFORE INSERT OR UPDATE ON public.tax_profiles FOR EACH ROW EXECUTE FUNCTION public.assert_tax_profile_rate_store();
CREATE TRIGGER accounting_groups_same_store BEFORE INSERT OR UPDATE ON public.accounting_groups FOR EACH ROW EXECUTE FUNCTION public.assert_accounting_group_store();
CREATE TRIGGER products_accounting_group_same_store BEFORE INSERT OR UPDATE OF accounting_group_id, store_id ON public.products FOR EACH ROW EXECUTE FUNCTION public.assert_product_accounting_group_store();

CREATE OR REPLACE FUNCTION public.provision_store_tax_template(p_store_id UUID) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r0 UUID; r6 UUID; r12 UUID; r21 UUID; legacy_profile UUID;
BEGIN
  INSERT INTO public.tax_rates(store_id,name,code,rate,is_system_default) VALUES
    (p_store_id,'VAT 0%','VAT0',0,true),(p_store_id,'VAT 6%','VAT6',6,true),(p_store_id,'VAT 12%','VAT12',12,true),(p_store_id,'VAT 21%','VAT21',21,true)
  ON CONFLICT (store_id,name) DO UPDATE SET rate=EXCLUDED.rate, updated_at=now();
  SELECT id INTO r0 FROM public.tax_rates WHERE store_id=p_store_id AND name='VAT 0%';
  SELECT id INTO r6 FROM public.tax_rates WHERE store_id=p_store_id AND name='VAT 6%';
  SELECT id INTO r12 FROM public.tax_rates WHERE store_id=p_store_id AND name='VAT 12%';
  SELECT id INTO r21 FROM public.tax_rates WHERE store_id=p_store_id AND name='VAT 21%';
  INSERT INTO public.tax_profiles(store_id,name,dine_in_tax_rate_id,takeaway_tax_rate_id,delivery_tax_rate_id,default_tax_rate_id) VALUES
    (p_store_id,'Food',r12,r6,r6,r12),(p_store_id,'Soft Drinks',NULL,NULL,NULL,NULL),
    (p_store_id,'Alcohol',r21,r21,r21,r21),(p_store_id,'Tax Exempt',r0,r0,r0,r0),(p_store_id,'Legacy 12%',r12,r12,r12,r12)
  ON CONFLICT (store_id,name) DO NOTHING;
  SELECT id INTO legacy_profile FROM public.tax_profiles WHERE store_id=p_store_id AND name='Legacy 12%';
  INSERT INTO public.accounting_groups(store_id,name,accounting_code,tax_profile_id,is_default) VALUES
    (p_store_id,'Food','FOOD', (SELECT id FROM public.tax_profiles WHERE store_id=p_store_id AND name='Food'),false),
    (p_store_id,'Soft Drinks','SOFT_DRINKS',(SELECT id FROM public.tax_profiles WHERE store_id=p_store_id AND name='Soft Drinks'),false),
    (p_store_id,'Alcohol','ALCOHOL',(SELECT id FROM public.tax_profiles WHERE store_id=p_store_id AND name='Alcohol'),false),
    (p_store_id,'Other','OTHER',legacy_profile,false),(p_store_id,'Tax Exempt','EXEMPT',(SELECT id FROM public.tax_profiles WHERE store_id=p_store_id AND name='Tax Exempt'),false),
    (p_store_id,'Unassigned / Legacy','LEGACY',legacy_profile,true)
  ON CONFLICT (store_id,name) DO NOTHING;
  UPDATE public.products SET accounting_group_id=(SELECT id FROM public.accounting_groups WHERE store_id=p_store_id AND name='Unassigned / Legacy')
  WHERE store_id=p_store_id AND accounting_group_id IS NULL;
END $$;
SELECT public.provision_store_tax_template(id) FROM public.stores;

ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY; ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.accounting_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tax configuration readable by store members" ON public.tax_rates FOR SELECT TO authenticated USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()));
CREATE POLICY "Tax profiles readable by store members" ON public.tax_profiles FOR SELECT TO authenticated USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()));
CREATE POLICY "Accounting groups readable by store members" ON public.accounting_groups FOR SELECT TO authenticated USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()));
CREATE POLICY "Store admins manage tax rates" ON public.tax_rates FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=tax_rates.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin())) WITH CHECK (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=tax_rates.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin()));
CREATE POLICY "Store admins manage tax profiles" ON public.tax_profiles FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=tax_profiles.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin())) WITH CHECK (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=tax_profiles.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin()));
CREATE POLICY "Store admins manage accounting groups" ON public.accounting_groups FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=accounting_groups.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin())) WITH CHECK (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=accounting_groups.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_rates, public.tax_profiles, public.accounting_groups TO authenticated;

-- Trusted tax resolver used by checkout. Soft Drinks deliberately has no preset;
-- an administrator must configure it before a product in that group can sell.
CREATE OR REPLACE FUNCTION public.resolve_store_tax_rate(p_product_id UUID, p_store_id UUID, p_order_type TEXT)
RETURNS TABLE(accounting_group_id UUID, accounting_group_name TEXT, accounting_code TEXT, tax_profile_name TEXT, vat_rate NUMERIC) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_group_id UUID; v_group_name TEXT; v_code TEXT; v_profile_name TEXT; v_rate NUMERIC;
BEGIN
  SELECT g.id,g.name,g.accounting_code,tp.name,tr.rate INTO v_group_id,v_group_name,v_code,v_profile_name,v_rate FROM public.products p
  JOIN public.accounting_groups g ON g.id=p.accounting_group_id AND g.store_id=p.store_id AND g.is_active
  JOIN public.tax_profiles tp ON tp.id=g.tax_profile_id AND tp.store_id=p.store_id AND tp.is_active
  LEFT JOIN public.tax_rates tr ON tr.id=CASE p_order_type WHEN 'dine_in' THEN tp.dine_in_tax_rate_id WHEN 'takeaway' THEN tp.takeaway_tax_rate_id WHEN 'delivery' THEN tp.delivery_tax_rate_id ELSE tp.default_tax_rate_id END
    AND tr.store_id=p.store_id AND tr.is_active
  WHERE p.id=p_product_id AND p.store_id=p_store_id;
  IF NOT FOUND OR v_rate IS NULL THEN RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING'; END IF;
  RETURN QUERY SELECT v_group_id,v_group_name,v_code,v_profile_name,v_rate;
END $$;
REVOKE ALL ON FUNCTION public.provision_store_tax_template(UUID), public.resolve_store_tax_rate(UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_store_tax_rate(UUID,UUID,TEXT) TO anon, authenticated;
