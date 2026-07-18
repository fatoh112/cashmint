-- REVIEW ONLY. Do not execute without a tested backup and approved maintenance window.
-- Additive repair for the checkout dependency gap found on 2026-07-19.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS receipt_number BIGINT,
  ADD COLUMN IF NOT EXISTS order_type TEXT,
  ADD COLUMN IF NOT EXISTS cashier_session_id UUID REFERENCES public.cashier_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_device_id UUID REFERENCES public.pos_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subtotal_excl_vat NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS category_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS unit_price_incl_vat NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS accounting_group_id_snapshot UUID,
  ADD COLUMN IF NOT EXISTS accounting_group_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS accounting_code_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS tax_profile_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS vat_rate_snapshot NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS order_type_snapshot TEXT;

CREATE TABLE IF NOT EXISTS public.store_receipt_counters (
  store_id UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  last_receipt_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  amount NUMERIC(14,4) NOT NULL CHECK (amount >= 0),
  processor_fee NUMERIC(14,4) NOT NULL DEFAULT 0,
  net_settlement NUMERIC(14,4), provider TEXT, provider_reference TEXT,
  paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing orders keep NULL receipt_number. Seed counters under a write lock only;
-- receipt generation itself never uses MAX and is atomic per store.
LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.store_receipt_counters (store_id, last_receipt_number)
SELECT s.id, COALESCE(MAX(o.receipt_number), 0)
FROM public.stores AS s LEFT JOIN public.orders AS o ON o.store_id = s.id
GROUP BY s.id
ON CONFLICT (store_id) DO UPDATE
SET last_receipt_number = GREATEST(public.store_receipt_counters.last_receipt_number, EXCLUDED.last_receipt_number), updated_at = now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_receipt_number
  ON public.orders (store_id, receipt_number) WHERE receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_store_completed_at ON public.orders (store_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_store_id ON public.order_items (store_id);
CREATE INDEX IF NOT EXISTS idx_payments_store_paid_at ON public.payments (store_id, paid_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_reference
  ON public.payments (provider, provider_reference) WHERE provider_reference IS NOT NULL;

ALTER TABLE public.store_receipt_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='store_receipt_counters' AND policyname='Tenant receipt counters read') THEN
    CREATE POLICY "Tenant receipt counters read" ON public.store_receipt_counters FOR SELECT TO authenticated
      USING (store_id IN (SELECT su.store_id FROM public.store_users su WHERE su.user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payments' AND policyname='Tenant payments access') THEN
    CREATE POLICY "Tenant payments access" ON public.payments FOR ALL TO authenticated
      USING (store_id IN (SELECT su.store_id FROM public.store_users su WHERE su.user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()))
      WITH CHECK (store_id IN (SELECT su.store_id FROM public.store_users su WHERE su.user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.next_store_receipt_number(p_store_id UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next BIGINT;
BEGIN
  INSERT INTO public.store_receipt_counters (store_id, last_receipt_number)
  VALUES (p_store_id, 1)
  ON CONFLICT (store_id) DO UPDATE
    SET last_receipt_number = public.store_receipt_counters.last_receipt_number + 1, updated_at = now()
  RETURNING last_receipt_number INTO v_next;
  RETURN v_next;
END $$;

-- Reinstalls the server-authoritative variant already present in the local trusted-checkout migration.
CREATE OR REPLACE FUNCTION public.create_accounting_order(
  p_store_id UUID, p_device_id UUID, p_cashier_session_id UUID, p_status TEXT,
  p_payment_method TEXT, p_order_type TEXT, p_currency TEXT, p_discount_amount NUMERIC,
  p_subtotal_excl_vat NUMERIC, p_vat_amount NUMERIC, p_total_amount NUMERIC,
  p_raw_payload JSONB, p_lines JSONB
) RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders; v_receipt BIGINT; v_line JSONB; v_product public.products; v_tax RECORD;
  v_gross NUMERIC; v_discount NUMERIC:=0; v_cart_gross NUMERIC:=0; v_net NUMERIC:=0; v_vat NUMERIC:=0;
  v_alloc NUMERIC:=0; v_line_discount NUMERIC; v_device_store UUID; v_modifier_total NUMERIC;
  v_coupon_code TEXT; v_coupon_type TEXT; v_coupon_value NUMERIC;
BEGIN
  SELECT store_id INTO v_device_store FROM public.pos_devices WHERE id=p_device_id AND status::text='active';
  IF NOT (v_device_store=p_store_id OR EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=p_store_id AND su.user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()) OR (SELECT auth.role())='service_role') THEN RAISE EXCEPTION 'Not allowed to create an order for this store'; END IF;
  IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'Order requires lines'; END IF;
  IF p_status NOT IN ('pending','completed') OR p_payment_method NOT IN ('cash','card') OR p_order_type NOT IN ('dine_in','takeaway','delivery') THEN RAISE EXCEPTION 'Invalid order state'; END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_line->>'productId')::uuid AND store_id=p_store_id;
    IF NOT FOUND OR v_product.accounting_group_id IS NULL THEN RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING'; END IF;
    SELECT COALESCE(SUM(m.price_adjustment),0) INTO v_modifier_total FROM public.modifiers m WHERE m.product_id=v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds','[]'::jsonb)));
    v_cart_gross:=v_cart_gross+(v_product.price+v_modifier_total)*GREATEST(1,(v_line->>'quantity')::integer);
  END LOOP;
  v_coupon_code:=NULLIF(trim(COALESCE(p_raw_payload->>'coupon_code','')), '');
  IF v_coupon_code IS NOT NULL THEN
    IF to_regclass('public.coupons') IS NULL THEN RAISE EXCEPTION 'COUPON_INVALID'; END IF;
    EXECUTE 'SELECT discount_type, discount_value FROM public.coupons WHERE store_id=$1 AND lower(code)=lower($2) AND is_active=true' INTO v_coupon_type,v_coupon_value USING p_store_id,v_coupon_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVALID'; END IF;
    v_discount:=CASE v_coupon_type WHEN 'percentage' THEN round(v_cart_gross*v_coupon_value/100,4) WHEN 'fixed' THEN v_coupon_value ELSE 0 END;
  END IF;
  v_discount:=LEAST(GREATEST(COALESCE(v_discount,0),0),v_cart_gross); v_receipt:=public.next_store_receipt_number(p_store_id);
  INSERT INTO public.orders(store_id,status,total_amount,raw_payload,receipt_number,order_type,cashier_session_id,pos_device_id,completed_at,subtotal_excl_vat,vat_amount,discount_amount,currency)
  VALUES(p_store_id,p_status,0,p_raw_payload,v_receipt,p_order_type,p_cashier_session_id,p_device_id,CASE WHEN p_status='completed' THEN now() END,0,0,v_discount,COALESCE(p_currency,'EUR')) RETURNING * INTO v_order;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_line->>'productId')::uuid AND store_id=p_store_id;
    SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_product.id,p_store_id,p_order_type);
    SELECT COALESCE(SUM(m.price_adjustment),0) INTO v_modifier_total FROM public.modifiers m WHERE m.product_id=v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds','[]'::jsonb)));
    v_gross:=(v_product.price+v_modifier_total)*GREATEST(1,(v_line->>'quantity')::integer);
    v_line_discount:=CASE WHEN v_alloc+v_gross=v_cart_gross THEN v_discount-v_alloc ELSE round(v_discount*v_gross/NULLIF(v_cart_gross,0),4) END;
    v_alloc:=v_alloc+v_line_discount; v_gross:=v_gross-v_line_discount;
    v_net:=v_net+round(v_gross/(1+v_tax.vat_rate/100),4); v_vat:=v_vat+round(v_gross-round(v_gross/(1+v_tax.vat_rate/100),4),4);
    INSERT INTO public.order_items(order_id,product_id,store_id,quantity,subtotal,product_name_snapshot,category_name_snapshot,vat_rate,vat_rate_snapshot,unit_price_incl_vat,discount_amount,net_amount,vat_amount,gross_amount,accounting_group_id_snapshot,accounting_group_name_snapshot,accounting_code_snapshot,tax_profile_name_snapshot,order_type_snapshot)
    VALUES(v_order.id,v_product.id,p_store_id,GREATEST(1,(v_line->>'quantity')::integer),v_gross,v_product.name,(SELECT name FROM public.categories WHERE id=v_product.category_id),v_tax.vat_rate,v_tax.vat_rate,v_product.price+v_modifier_total,v_line_discount,round(v_gross/(1+v_tax.vat_rate/100),4),round(v_gross-round(v_gross/(1+v_tax.vat_rate/100),4),4),v_gross,v_tax.accounting_group_id,v_tax.accounting_group_name,v_tax.accounting_code,v_tax.tax_profile_name,p_order_type);
  END LOOP;
  UPDATE public.orders SET total_amount=round(v_net+v_vat,4),subtotal_excl_vat=round(v_net,4),vat_amount=round(v_vat,4) WHERE id=v_order.id RETURNING * INTO v_order;
  INSERT INTO public.payments(store_id,order_id,method,status,amount,provider,paid_at) VALUES(p_store_id,v_order.id,p_payment_method,CASE WHEN p_status='completed' THEN 'paid' ELSE 'pending' END,v_order.total_amount,CASE WHEN p_payment_method='card' THEN 'stripe' END,CASE WHEN p_status='completed' THEN now() END);
  RETURN v_order;
END $$;

REVOKE ALL ON FUNCTION public.next_store_receipt_number(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_accounting_order(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,JSONB,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_accounting_order(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,JSONB,JSONB) TO anon, authenticated;
COMMIT;
