-- Tax assignment is maintained at category level. Products inherit that choice
-- when created, while an explicit product-level choice remains an allowed override.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS default_accounting_group_id UUID REFERENCES public.accounting_groups(id);

CREATE OR REPLACE FUNCTION public.assert_category_accounting_group_store()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.default_accounting_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounting_groups g
    WHERE g.id = NEW.default_accounting_group_id AND g.store_id = NEW.store_id
  ) THEN
    RAISE EXCEPTION 'Category accounting group must belong to the same store';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS categories_accounting_group_same_store ON public.categories;
CREATE TRIGGER categories_accounting_group_same_store
  BEFORE INSERT OR UPDATE OF default_accounting_group_id, store_id ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.assert_category_accounting_group_store();

CREATE OR REPLACE FUNCTION public.apply_category_accounting_group()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accounting_group_id IS NULL THEN
    SELECT c.default_accounting_group_id INTO NEW.accounting_group_id
    FROM public.categories c WHERE c.id = NEW.category_id AND c.store_id = NEW.store_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS products_apply_category_accounting_group ON public.products;
CREATE TRIGGER products_apply_category_accounting_group
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.apply_category_accounting_group();

-- A bundle is a sellable product whose price is allocated to its component
-- products before VAT is calculated. Each component therefore keeps its own tax profile.
CREATE TABLE IF NOT EXISTS public.product_bundle_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  bundle_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  allocation_weight NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (allocation_weight > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bundle_product_id, component_product_id)
);
CREATE INDEX IF NOT EXISTS idx_product_bundle_components_bundle ON public.product_bundle_components(bundle_product_id);

CREATE OR REPLACE FUNCTION public.assert_bundle_component_store()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=NEW.bundle_product_id AND p.store_id=NEW.store_id)
     OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=NEW.component_product_id AND p.store_id=NEW.store_id) THEN
    RAISE EXCEPTION 'Bundle components must belong to the same store';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS product_bundle_components_same_store ON public.product_bundle_components;
CREATE TRIGGER product_bundle_components_same_store
  BEFORE INSERT OR UPDATE OF store_id,bundle_product_id,component_product_id ON public.product_bundle_components
  FOR EACH ROW EXECUTE FUNCTION public.assert_bundle_component_store();

ALTER TABLE public.product_bundle_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Store members can read bundle components" ON public.product_bundle_components FOR SELECT TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()));
CREATE POLICY "Store admins manage bundle components" ON public.product_bundle_components FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=product_bundle_components.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin()))
WITH CHECK (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=product_bundle_components.store_id AND su.user_id=(SELECT auth.uid()) AND su.role='admin') OR (SELECT public.is_superadmin()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundle_components TO authenticated;
