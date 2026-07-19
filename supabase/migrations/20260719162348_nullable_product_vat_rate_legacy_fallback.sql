-- Accounting groups are now the primary product tax source. Keep products.vat_rate
-- only as a nullable legacy fallback for older products/snapshots.
ALTER TABLE public.products
  ALTER COLUMN vat_rate DROP NOT NULL;

COMMENT ON COLUMN public.products.vat_rate IS
  'Deprecated legacy fallback. Accounting groups and category defaults are the authoritative VAT source for new product tax resolution.';

CREATE INDEX IF NOT EXISTS idx_products_accounting_group_id
  ON public.products(accounting_group_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.products'::regclass AND attname = 'accounting_group_id')
      ]::smallint[]
      AND confrelid = 'public.accounting_groups'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_accounting_group_id_fkey
      FOREIGN KEY (accounting_group_id) REFERENCES public.accounting_groups(id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_store_tax_rate(p_product_id UUID, p_store_id UUID, p_order_type TEXT)
RETURNS TABLE(accounting_group_id UUID, accounting_group_name TEXT, accounting_code TEXT, tax_profile_name TEXT, vat_rate NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_product public.products;
  v_group_id UUID;
  v_group_name TEXT;
  v_code TEXT;
  v_profile_name TEXT;
  v_rate NUMERIC;
BEGIN
  IF p_order_type NOT IN ('dine_in','takeaway') THEN
    RAISE EXCEPTION 'TAX_ORDER_TYPE_UNSUPPORTED';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING';
  END IF;

  SELECT g.id, g.name, g.accounting_code, tp.name, tr.rate
    INTO v_group_id, v_group_name, v_code, v_profile_name, v_rate
  FROM public.accounting_groups g
  JOIN public.tax_profiles tp
    ON tp.id = g.tax_profile_id
   AND tp.store_id = g.store_id
   AND tp.is_active
  LEFT JOIN public.tax_rates tr
    ON tr.id = CASE p_order_type
      WHEN 'dine_in' THEN tp.dine_in_tax_rate_id
      WHEN 'takeaway' THEN tp.takeaway_tax_rate_id
    END
   AND tr.store_id = g.store_id
   AND tr.is_active
  WHERE g.id = COALESCE(
      v_product.accounting_group_id,
      (SELECT c.default_accounting_group_id FROM public.categories c WHERE c.id = v_product.category_id AND c.store_id = v_product.store_id)
    )
    AND g.store_id = v_product.store_id
    AND g.is_active;

  IF v_rate IS NULL THEN
    IF v_product.accounting_group_id IS NULL AND v_product.vat_rate IS NOT NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, 'Legacy product VAT'::TEXT, v_product.vat_rate;
      RETURN;
    END IF;
    RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING';
  END IF;

  RETURN QUERY SELECT v_group_id, v_group_name, v_code, v_profile_name, v_rate;
END $$;

REVOKE ALL ON FUNCTION public.resolve_store_tax_rate(UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_store_tax_rate(UUID,UUID,TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_accounting_order(
  p_store_id UUID,p_device_id UUID,p_cashier_session_id UUID,p_status TEXT,p_payment_method TEXT,p_order_type TEXT,p_currency TEXT,
  p_discount_amount NUMERIC,p_subtotal_excl_vat NUMERIC,p_vat_amount NUMERIC,p_total_amount NUMERIC,p_raw_payload JSONB,p_lines JSONB
) RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders; v_receipt BIGINT; v_line JSONB; v_product public.products; v_component RECORD; v_tax RECORD;
  v_gross NUMERIC; v_discount NUMERIC:=0; v_cart_gross NUMERIC:=0; v_net NUMERIC:=0; v_vat NUMERIC:=0; v_alloc NUMERIC:=0;
  v_line_discount NUMERIC; v_device_store UUID; v_modifier_total NUMERIC; v_coupon_code TEXT; v_coupon_type TEXT; v_coupon_value NUMERIC;
  v_quantity INTEGER; v_weight_total NUMERIC; v_component_gross NUMERIC; v_component_discount NUMERIC; v_component_quantity NUMERIC;
BEGIN
  SELECT store_id INTO v_device_store FROM public.pos_devices WHERE id=p_device_id AND status::text='active';
  IF NOT (v_device_store=p_store_id OR EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=p_store_id AND su.user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()) OR (SELECT auth.role())='service_role') THEN RAISE EXCEPTION 'Not allowed to create an order for this store'; END IF;
  IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'Order requires lines'; END IF;
  IF p_status NOT IN ('pending','completed') OR p_payment_method NOT IN ('cash','card') OR p_order_type NOT IN ('dine_in','takeaway') THEN RAISE EXCEPTION 'Invalid order state'; END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_line->>'productId')::uuid AND store_id=p_store_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING'; END IF;
    PERFORM 1 FROM public.resolve_store_tax_rate(v_product.id,p_store_id,p_order_type);
    v_quantity:=GREATEST(1,(v_line->>'quantity')::integer);
    IF EXISTS (SELECT 1 FROM public.product_bundle_components bc WHERE bc.bundle_product_id=v_product.id) THEN
      v_cart_gross:=v_cart_gross + v_product.price*v_quantity;
    ELSE
      SELECT COALESCE(SUM(m.price_adjustment),0) INTO v_modifier_total FROM public.modifiers m WHERE m.product_id=v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds','[]'::jsonb)));
      v_cart_gross:=v_cart_gross+(v_product.price+v_modifier_total)*v_quantity;
    END IF;
  END LOOP;
  v_coupon_code:=NULLIF(trim(COALESCE(p_raw_payload->>'coupon_code','')), '');
  IF v_coupon_code IS NOT NULL THEN
    IF to_regclass('public.coupons') IS NULL THEN RAISE EXCEPTION 'COUPON_INVALID'; END IF;
    EXECUTE 'SELECT discount_type,discount_value FROM public.coupons WHERE store_id=$1 AND lower(code)=lower($2) AND is_active=true' INTO v_coupon_type,v_coupon_value USING p_store_id,v_coupon_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVALID'; END IF;
    v_discount:=CASE v_coupon_type WHEN 'percentage' THEN ROUND(v_cart_gross*v_coupon_value/100,4) WHEN 'fixed' THEN v_coupon_value ELSE 0 END;
  END IF;
  v_discount:=LEAST(GREATEST(COALESCE(v_discount,0),0),v_cart_gross); v_receipt:=public.next_store_receipt_number(p_store_id);
  INSERT INTO public.orders(store_id,status,total_amount,raw_payload,receipt_number,order_type,cashier_session_id,pos_device_id,completed_at,subtotal_excl_vat,vat_amount,discount_amount,currency)
  VALUES(p_store_id,p_status,0,p_raw_payload,v_receipt,p_order_type,p_cashier_session_id,p_device_id,CASE WHEN p_status='completed' THEN now() END,0,0,v_discount,COALESCE(p_currency,'EUR')) RETURNING * INTO v_order;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_line->>'productId')::uuid AND store_id=p_store_id; v_quantity:=GREATEST(1,(v_line->>'quantity')::integer);
    IF EXISTS (SELECT 1 FROM public.product_bundle_components bc WHERE bc.bundle_product_id=v_product.id) THEN
      v_gross:=v_product.price*v_quantity;
      v_line_discount:=CASE WHEN v_alloc+v_gross=v_cart_gross THEN v_discount-v_alloc ELSE ROUND(v_discount*v_gross/NULLIF(v_cart_gross,0),4) END; v_alloc:=v_alloc+v_line_discount;
      SELECT SUM(bc.allocation_weight*cp.price) INTO v_weight_total FROM public.product_bundle_components bc JOIN public.products cp ON cp.id=bc.component_product_id WHERE bc.bundle_product_id=v_product.id;
      IF COALESCE(v_weight_total,0)<=0 THEN RAISE EXCEPTION 'BUNDLE_CONFIGURATION_MISSING'; END IF;
      FOR v_component IN SELECT bc.component_product_id,bc.quantity,bc.allocation_weight,cp.name,cp.price FROM public.product_bundle_components bc JOIN public.products cp ON cp.id=bc.component_product_id WHERE bc.bundle_product_id=v_product.id LOOP
        v_component_quantity:=v_component.quantity*v_quantity;
        v_component_gross:=ROUND(v_gross*(v_component.allocation_weight*v_component.price)/v_weight_total,4);
        v_component_discount:=ROUND(v_line_discount*(v_component.allocation_weight*v_component.price)/v_weight_total,4);
        SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_component.component_product_id,p_store_id,p_order_type);
        v_component_gross:=GREATEST(0,v_component_gross-v_component_discount);
        v_net:=v_net+ROUND(v_component_gross/(1+v_tax.vat_rate/100),4); v_vat:=v_vat+ROUND(v_component_gross-ROUND(v_component_gross/(1+v_tax.vat_rate/100),4),4);
        INSERT INTO public.order_items(order_id,product_id,store_id,quantity,subtotal,product_name_snapshot,category_name_snapshot,vat_rate,vat_rate_snapshot,unit_price_incl_vat,discount_amount,net_amount,vat_amount,gross_amount,accounting_group_id_snapshot,accounting_group_name_snapshot,accounting_code_snapshot,tax_profile_name_snapshot,order_type_snapshot,bundle_product_id_snapshot,bundle_product_name_snapshot,bundle_component_weight_snapshot)
        VALUES(v_order.id,v_component.component_product_id,p_store_id,v_component_quantity,v_component_gross,v_component.name,(SELECT name FROM public.categories c JOIN public.products p ON p.category_id=c.id WHERE p.id=v_component.component_product_id),v_tax.vat_rate,v_tax.vat_rate,ROUND(v_component_gross/NULLIF(v_component_quantity,0),4),v_component_discount,ROUND(v_component_gross/(1+v_tax.vat_rate/100),4),ROUND(v_component_gross-ROUND(v_component_gross/(1+v_tax.vat_rate/100),4),4),v_component_gross,v_tax.accounting_group_id,v_tax.accounting_group_name,v_tax.accounting_code,v_tax.tax_profile_name,p_order_type,v_product.id,v_product.name,v_component.allocation_weight);
      END LOOP;
    ELSE
      SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_product.id,p_store_id,p_order_type); SELECT COALESCE(SUM(m.price_adjustment),0) INTO v_modifier_total FROM public.modifiers m WHERE m.product_id=v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds','[]'::jsonb)));
      v_gross:=(v_product.price+v_modifier_total)*v_quantity; v_line_discount:=CASE WHEN v_alloc+v_gross=v_cart_gross THEN v_discount-v_alloc ELSE ROUND(v_discount*v_gross/NULLIF(v_cart_gross,0),4) END; v_alloc:=v_alloc+v_line_discount; v_gross:=v_gross-v_line_discount;
      v_net:=v_net+ROUND(v_gross/(1+v_tax.vat_rate/100),4); v_vat:=v_vat+ROUND(v_gross-ROUND(v_gross/(1+v_tax.vat_rate/100),4),4);
      INSERT INTO public.order_items(order_id,product_id,store_id,quantity,subtotal,product_name_snapshot,category_name_snapshot,vat_rate,vat_rate_snapshot,unit_price_incl_vat,discount_amount,net_amount,vat_amount,gross_amount,accounting_group_id_snapshot,accounting_group_name_snapshot,accounting_code_snapshot,tax_profile_name_snapshot,order_type_snapshot)
      VALUES(v_order.id,v_product.id,p_store_id,v_quantity,v_gross,v_product.name,(SELECT name FROM public.categories WHERE id=v_product.category_id),v_tax.vat_rate,v_tax.vat_rate,v_product.price+v_modifier_total,v_line_discount,ROUND(v_gross/(1+v_tax.vat_rate/100),4),ROUND(v_gross-ROUND(v_gross/(1+v_tax.vat_rate/100),4),4),v_gross,v_tax.accounting_group_id,v_tax.accounting_group_name,v_tax.accounting_code,v_tax.tax_profile_name,p_order_type);
    END IF;
  END LOOP;
  UPDATE public.orders SET total_amount=ROUND(v_net+v_vat,4),subtotal_excl_vat=ROUND(v_net,4),vat_amount=ROUND(v_vat,4) WHERE id=v_order.id RETURNING * INTO v_order;
  INSERT INTO public.payments(store_id,order_id,method,status,amount,provider,paid_at) VALUES(p_store_id,v_order.id,p_payment_method,CASE WHEN p_status='completed' THEN 'paid' ELSE 'pending' END,v_order.total_amount,CASE WHEN p_payment_method='card' THEN 'stripe' END,CASE WHEN p_status='completed' THEN now() END);
  RETURN v_order;
END $$;

NOTIFY pgrst, 'reload schema';
