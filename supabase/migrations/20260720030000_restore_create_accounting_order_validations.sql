-- Migration: Restore full POS device & cashier shift audit validations in create_accounting_order RPC with Split Payment support

CREATE OR REPLACE FUNCTION public.create_accounting_order(
  p_store_id UUID,
  p_device_id UUID,
  p_cashier_session_id UUID,
  p_status TEXT,
  p_payment_method TEXT,
  p_order_type TEXT,
  p_currency TEXT,
  p_discount_amount NUMERIC,
  p_subtotal_excl_vat NUMERIC,
  p_vat_amount NUMERIC,
  p_total_amount NUMERIC,
  p_raw_payload JSONB,
  p_lines JSONB
) RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_receipt BIGINT;
  v_line JSONB;
  v_product public.products;
  v_component RECORD;
  v_tax RECORD;
  v_gross NUMERIC;
  v_discount NUMERIC := 0;
  v_cart_gross NUMERIC := 0;
  v_net NUMERIC := 0;
  v_vat NUMERIC := 0;
  v_alloc NUMERIC := 0;
  v_line_discount NUMERIC;
  v_device public.pos_devices;
  v_session public.cashier_sessions;
  v_cashier_user_id UUID;
  v_raw_payload JSONB;
  v_modifier_total NUMERIC;
  v_coupon_code TEXT;
  v_coupon_type TEXT;
  v_coupon_value NUMERIC;
  v_quantity INTEGER;
  v_weight_total NUMERIC;
  v_component_gross NUMERIC;
  v_component_discount NUMERIC;
  v_component_quantity NUMERIC;
BEGIN
  -- 1. POS Device Validation
  IF p_device_id IS NULL THEN
    RAISE EXCEPTION 'POS_DEVICE_NOT_FOUND';
  END IF;

  SELECT * INTO v_device FROM public.pos_devices WHERE id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_DEVICE_NOT_FOUND';
  END IF;

  IF v_device.status::text <> 'active' THEN
    RAISE EXCEPTION 'POS_DEVICE_DISABLED_OR_REVOKED';
  END IF;

  IF v_device.store_id <> p_store_id THEN
    RAISE EXCEPTION 'POS_DEVICE_STORE_MISMATCH';
  END IF;

  -- 2. Cashier Session (Shift) Validation
  IF p_cashier_session_id IS NULL THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_REQUIRED';
  END IF;

  SELECT * INTO v_session FROM public.cashier_sessions WHERE id = p_cashier_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_NOT_FOUND';
  END IF;

  IF v_session.status::text <> 'open' THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_CLOSED';
  END IF;

  IF v_session.device_id <> p_device_id THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_DEVICE_MISMATCH';
  END IF;

  IF COALESCE(v_session.store_id, v_device.store_id) <> p_store_id THEN
    RAISE EXCEPTION 'CASHIER_SHIFT_STORE_MISMATCH';
  END IF;

  -- 3. Tenant Authorization Check
  IF NOT (
    v_device.store_id = p_store_id
    OR EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = p_store_id AND su.user_id = (SELECT auth.uid()))
    OR (SELECT public.is_superadmin())
    OR (SELECT auth.role()) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Not allowed to create an order for this store';
  END IF;

  -- 4. Payload & State Validation
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Order requires lines';
  END IF;

  IF p_status NOT IN ('pending', 'completed')
     OR p_payment_method NOT IN ('cash', 'card', 'split')
     OR p_order_type NOT IN ('dine_in', 'takeaway') THEN
    RAISE EXCEPTION 'Invalid order state';
  END IF;

  -- Extract cashier user and merge cashier name into raw_payload
  v_cashier_user_id := COALESCE(v_session.cashier_user_id, (SELECT auth.uid()));
  v_raw_payload := COALESCE(p_raw_payload, '{}'::jsonb);
  IF v_session.cashier_name IS NOT NULL THEN
    v_raw_payload := v_raw_payload || jsonb_build_object('cashier_name', v_session.cashier_name);
  END IF;

  -- 5. Product & Cart Pre-calculation
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_line->>'productId')::uuid AND store_id = p_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TAX_CONFIGURATION_MISSING';
    END IF;
    PERFORM 1 FROM public.resolve_store_tax_rate(v_product.id, p_store_id, p_order_type);
    v_quantity := GREATEST(1, (v_line->>'quantity')::integer);
    IF EXISTS (SELECT 1 FROM public.product_bundle_components bc WHERE bc.bundle_product_id = v_product.id) THEN
      v_cart_gross := v_cart_gross + v_product.price * v_quantity;
    ELSE
      SELECT COALESCE(SUM(m.price_adjustment), 0) INTO v_modifier_total
      FROM public.modifiers m
      WHERE m.product_id = v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds', '[]'::jsonb)));
      v_cart_gross := v_cart_gross + (v_product.price + v_modifier_total) * v_quantity;
    END IF;
  END LOOP;

  -- 6. Coupon Processing
  v_coupon_code := NULLIF(trim(COALESCE(v_raw_payload->>'coupon_code', '')), '');
  IF v_coupon_code IS NOT NULL THEN
    IF to_regclass('public.coupons') IS NULL THEN
      RAISE EXCEPTION 'COUPON_INVALID';
    END IF;
    EXECUTE 'SELECT discount_type, discount_value FROM public.coupons WHERE store_id=$1 AND lower(code)=lower($2) AND is_active=true'
      INTO v_coupon_type, v_coupon_value USING p_store_id, v_coupon_code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COUPON_INVALID';
    END IF;
    v_discount := CASE v_coupon_type
      WHEN 'percentage' THEN ROUND(v_cart_gross * v_coupon_value / 100, 4)
      WHEN 'fixed' THEN v_coupon_value
      ELSE 0
    END;
  END IF;

  v_discount := LEAST(GREATEST(COALESCE(v_discount, 0), 0), v_cart_gross);
  v_receipt := public.next_store_receipt_number(p_store_id);

  -- 7. Insert Order Header
  INSERT INTO public.orders (
    store_id, status, total_amount, raw_payload, receipt_number, order_type,
    cashier_session_id, pos_device_id, completed_at, subtotal_excl_vat, vat_amount,
    discount_amount, currency, cashier_user_id
  ) VALUES (
    p_store_id, p_status, 0, v_raw_payload, v_receipt, p_order_type,
    p_cashier_session_id, p_device_id, CASE WHEN p_status = 'completed' THEN now() END,
    0, 0, v_discount, COALESCE(p_currency, 'EUR'), v_cashier_user_id
  ) RETURNING * INTO v_order;

  -- 8. Insert Order Items (with Bundles & Accounting Snapshots)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_line->>'productId')::uuid AND store_id = p_store_id;
    v_quantity := GREATEST(1, (v_line->>'quantity')::integer);

    IF EXISTS (SELECT 1 FROM public.product_bundle_components bc WHERE bc.bundle_product_id = v_product.id) THEN
      v_gross := v_product.price * v_quantity;
      v_line_discount := CASE WHEN v_alloc + v_gross = v_cart_gross THEN v_discount - v_alloc ELSE ROUND(v_discount * v_gross / NULLIF(v_cart_gross, 0), 4) END;
      v_alloc := v_alloc + v_line_discount;
      SELECT SUM(bc.allocation_weight * cp.price) INTO v_weight_total
      FROM public.product_bundle_components bc JOIN public.products cp ON cp.id = bc.component_product_id
      WHERE bc.bundle_product_id = v_product.id;
      IF COALESCE(v_weight_total, 0) <= 0 THEN
        RAISE EXCEPTION 'BUNDLE_CONFIGURATION_MISSING';
      END IF;

      FOR v_component IN
        SELECT bc.component_product_id, bc.quantity, bc.allocation_weight, cp.name, cp.price
        FROM public.product_bundle_components bc JOIN public.products cp ON cp.id = bc.component_product_id
        WHERE bc.bundle_product_id = v_product.id
      LOOP
        v_component_quantity := v_component.quantity * v_quantity;
        v_component_gross := ROUND(v_gross * (v_component.allocation_weight * v_component.price) / v_weight_total, 4);
        v_component_discount := ROUND(v_line_discount * (v_component.allocation_weight * v_component.price) / v_weight_total, 4);
        SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_component.component_product_id, p_store_id, p_order_type);
        v_component_gross := GREATEST(0, v_component_gross - v_component_discount);
        v_net := v_net + ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4);
        v_vat := v_vat + ROUND(v_component_gross - ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4), 4);

        INSERT INTO public.order_items (
          order_id, product_id, store_id, quantity, subtotal, product_name_snapshot,
          category_name_snapshot, vat_rate, vat_rate_snapshot, unit_price_incl_vat,
          discount_amount, net_amount, vat_amount, gross_amount, accounting_group_id_snapshot,
          accounting_group_name_snapshot, accounting_code_snapshot, tax_profile_name_snapshot,
          order_type_snapshot, bundle_product_id_snapshot, bundle_product_name_snapshot,
          bundle_component_weight_snapshot
        ) VALUES (
          v_order.id, v_component.component_product_id, p_store_id, v_component_quantity, v_component_gross,
          v_component.name, (SELECT name FROM public.categories c JOIN public.products p ON p.category_id = c.id WHERE p.id = v_component.component_product_id),
          v_tax.vat_rate, v_tax.vat_rate, ROUND(v_component_gross / NULLIF(v_component_quantity, 0), 4),
          v_component_discount, ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4),
          ROUND(v_component_gross - ROUND(v_component_gross / (1 + v_tax.vat_rate / 100), 4), 4),
          v_component_gross, v_tax.accounting_group_id, v_tax.accounting_group_name,
          v_tax.accounting_code, v_tax.tax_profile_name, p_order_type, v_product.id,
          v_product.name, v_component.allocation_weight
        );
      END LOOP;
    ELSE
      SELECT * INTO v_tax FROM public.resolve_store_tax_rate(v_product.id, p_store_id, p_order_type);
      SELECT COALESCE(SUM(m.price_adjustment), 0) INTO v_modifier_total
      FROM public.modifiers m
      WHERE m.product_id = v_product.id AND m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_line->'modifierIds', '[]'::jsonb)));
      v_gross := (v_product.price + v_modifier_total) * v_quantity;
      v_line_discount := CASE WHEN v_alloc + v_gross = v_cart_gross THEN v_discount - v_alloc ELSE ROUND(v_discount * v_gross / NULLIF(v_cart_gross, 0), 4) END;
      v_alloc := v_alloc + v_line_discount;
      v_gross := v_gross - v_line_discount;
      v_net := v_net + ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4);
      v_vat := v_vat + ROUND(v_gross - ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4), 4);

      INSERT INTO public.order_items (
        order_id, product_id, store_id, quantity, subtotal, product_name_snapshot,
        category_name_snapshot, vat_rate, vat_rate_snapshot, unit_price_incl_vat,
        discount_amount, net_amount, vat_amount, gross_amount, accounting_group_id_snapshot,
        accounting_group_name_snapshot, accounting_code_snapshot, tax_profile_name_snapshot,
        order_type_snapshot
      ) VALUES (
        v_order.id, v_product.id, p_store_id, v_quantity, v_gross, v_product.name,
        (SELECT name FROM public.categories WHERE id = v_product.category_id), v_tax.vat_rate,
        v_tax.vat_rate, v_product.price + v_modifier_total, v_line_discount,
        ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4),
        ROUND(v_gross - ROUND(v_gross / (1 + v_tax.vat_rate / 100), 4), 4),
        v_gross, v_tax.accounting_group_id, v_tax.accounting_group_name,
        v_tax.accounting_code, v_tax.tax_profile_name, p_order_type
      );
    END IF;
  END LOOP;

  -- Update totals on Order
  UPDATE public.orders
  SET total_amount = ROUND(v_net + v_vat, 4),
      subtotal_excl_vat = ROUND(v_net, 4),
      vat_amount = ROUND(v_vat, 4)
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  -- 9. Legacy Payment Insertion (Skipped for Split Payments)
  IF p_payment_method <> 'split' THEN
    INSERT INTO public.payments (
      store_id, order_id, method, status, amount, provider, paid_at
    ) VALUES (
      p_store_id, v_order.id, p_payment_method,
      CASE WHEN p_status = 'completed' THEN 'paid' ELSE 'pending' END,
      v_order.total_amount,
      CASE WHEN p_payment_method = 'card' THEN 'stripe' END,
      CASE WHEN p_status = 'completed' THEN now() END
    );
  END IF;

  RETURN v_order;
END $$;

NOTIFY pgrst, 'reload schema';
