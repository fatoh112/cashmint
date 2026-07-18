-- Replace the legacy browser-trusted accounting calculation. The existing RPC
-- signature is preserved for compatibility; header and line totals sent by the
-- browser are deliberately recalculated from the catalog.
CREATE OR REPLACE FUNCTION public.create_accounting_order(
  p_store_id UUID, p_device_id UUID, p_cashier_session_id UUID, p_status TEXT,
  p_payment_method TEXT, p_order_type TEXT, p_currency TEXT, p_discount_amount NUMERIC,
  p_subtotal_excl_vat NUMERIC, p_vat_amount NUMERIC, p_total_amount NUMERIC,
  p_raw_payload JSONB, p_lines JSONB
) RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders; v_receipt BIGINT; v_line JSONB; v_product public.products;
  v_tax RECORD; v_gross NUMERIC; v_discount NUMERIC:=0;
  v_cart_gross NUMERIC:=0; v_net NUMERIC:=0; v_vat NUMERIC:=0; v_alloc NUMERIC:=0; v_line_discount NUMERIC;
  v_device_store UUID; v_modifier_total NUMERIC; v_coupon_code TEXT; v_coupon_type TEXT; v_coupon_value NUMERIC;
BEGIN
  SELECT store_id INTO v_device_store FROM public.pos_devices WHERE id=p_device_id AND status::text='active';
  IF NOT (v_device_store=p_store_id OR EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id=p_store_id AND su.user_id=(SELECT auth.uid())) OR (SELECT public.is_superadmin()) OR (SELECT auth.role())='service_role') THEN RAISE EXCEPTION 'Not allowed to create an order for this store'; END IF;
  IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'Order requires lines'; END IF;
  IF p_status NOT IN ('pending','completed') OR p_payment_method NOT IN ('cash','card') OR p_order_type NOT IN ('dine_in','takeaway','delivery') THEN
    RAISE EXCEPTION 'Invalid order state';
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_line->>'productId')::uuid AND store_id=p_store_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product does not belong to this store'; END IF;
    IF v_product.accounting_group_id IS NULL THEN RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING'; END IF;
    SELECT coalesce(sum(m.price_adjustment),0) INTO v_modifier_total FROM public.modifiers m WHERE m.product_id=v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(coalesce(v_line->'modifierIds','[]'::jsonb)));
    v_gross:=(v_product.price+v_modifier_total)*greatest(1,(v_line->>'quantity')::integer);
    v_cart_gross:=v_cart_gross+v_gross;
  END LOOP;
  -- Coupon values are derived from the server-side coupon record, never from
  -- the browser-supplied p_discount_amount. This avoids manipulated discounts.
  v_coupon_code:=nullif(trim(coalesce(p_raw_payload->>'coupon_code','')), '');
  IF v_coupon_code IS NOT NULL THEN
    -- Some legacy deployments have not yet installed the coupon module. In
    -- that case, a supplied coupon is rejected rather than trusting a number.
    IF to_regclass('public.coupons') IS NULL THEN RAISE EXCEPTION 'COUPON_INVALID'; END IF;
    EXECUTE 'SELECT discount_type, discount_value FROM public.coupons WHERE store_id=$1 AND lower(code)=lower($2) AND is_active=true'
      INTO v_coupon_type, v_coupon_value USING p_store_id, v_coupon_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_INVALID'; END IF;
    v_discount:=CASE v_coupon_type
      WHEN 'percentage' THEN round(v_cart_gross * v_coupon_value / 100,4)
      WHEN 'fixed' THEN v_coupon_value
      ELSE 0
    END;
  END IF;
  v_discount:=least(greatest(coalesce(v_discount,0),0),v_cart_gross);
  v_receipt:=public.next_store_receipt_number(p_store_id);
  INSERT INTO public.orders(store_id,status,total_amount,raw_payload,receipt_number,order_type,cashier_session_id,pos_device_id,completed_at,subtotal_excl_vat,vat_amount,discount_amount,currency)
  VALUES(p_store_id,p_status,0,p_raw_payload,v_receipt,p_order_type,p_cashier_session_id,p_device_id,CASE WHEN p_status='completed' THEN now() END,0,0,v_discount,coalesce(p_currency,'EUR')) RETURNING * INTO v_order;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_line->>'productId')::uuid AND store_id=p_store_id;
    SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_product.id,p_store_id,p_order_type);
    SELECT coalesce(sum(m.price_adjustment),0) INTO v_modifier_total FROM public.modifiers m WHERE m.product_id=v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(coalesce(v_line->'modifierIds','[]'::jsonb)));
    v_gross:=(v_product.price+v_modifier_total)*greatest(1,(v_line->>'quantity')::integer);
    v_line_discount:=CASE WHEN v_alloc+v_gross=v_cart_gross THEN v_discount-v_alloc ELSE round(v_discount*v_gross/nullif(v_cart_gross,0),4) END;
    v_alloc:=v_alloc+v_line_discount; v_gross:=v_gross-v_line_discount;
    v_net:=v_net+round(v_gross/(1+v_tax.vat_rate/100),4); v_vat:=v_vat+round(v_gross-round(v_gross/(1+v_tax.vat_rate/100),4),4);
    INSERT INTO public.order_items(order_id,product_id,store_id,quantity,subtotal,product_name_snapshot,category_name_snapshot,vat_rate,vat_rate_snapshot,unit_price_incl_vat,discount_amount,net_amount,vat_amount,gross_amount,accounting_group_id_snapshot,accounting_group_name_snapshot,accounting_code_snapshot,tax_profile_name_snapshot,order_type_snapshot)
    VALUES(v_order.id,v_product.id,p_store_id,greatest(1,(v_line->>'quantity')::integer),v_gross,v_product.name,(SELECT name FROM public.categories WHERE id=v_product.category_id),v_tax.vat_rate,v_tax.vat_rate,v_product.price+v_modifier_total,v_line_discount,round(v_gross/(1+v_tax.vat_rate/100),4),round(v_gross-round(v_gross/(1+v_tax.vat_rate/100),4),4),v_gross,v_tax.accounting_group_id,v_tax.accounting_group_name,v_tax.accounting_code,v_tax.tax_profile_name,p_order_type);
  END LOOP;
  UPDATE public.orders SET total_amount=round(v_net+v_vat,4),subtotal_excl_vat=round(v_net,4),vat_amount=round(v_vat,4) WHERE id=v_order.id RETURNING * INTO v_order;
  INSERT INTO public.payments(store_id,order_id,method,status,amount,provider,paid_at) VALUES(p_store_id,v_order.id,p_payment_method,CASE WHEN p_status='completed' THEN 'paid' ELSE 'pending' END,v_order.total_amount,CASE WHEN p_payment_method='card' THEN 'stripe' END,CASE WHEN p_status='completed' THEN now() END);
  RETURN v_order;
END $$;
