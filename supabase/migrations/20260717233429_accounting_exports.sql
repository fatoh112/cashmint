-- Accountant exports: additive accounting snapshots and transactional checkout.
-- Existing orders remain unchanged and may be reported as legacy/incomplete.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Brussels',
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';

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
  ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(14,4);

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
  net_settlement NUMERIC(14,4),
  provider TEXT,
  provider_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  original_order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  original_order_item_id UUID REFERENCES public.order_items(id) ON DELETE RESTRICT,
  refund_amount NUMERIC(14,4) NOT NULL CHECK (refund_amount >= 0),
  net_amount NUMERIC(14,4) NOT NULL CHECK (net_amount >= 0),
  vat_amount NUMERIC(14,4) NOT NULL CHECK (vat_amount >= 0),
  vat_rate NUMERIC(5,2) NOT NULL,
  payment_method TEXT,
  reason TEXT,
  cashier_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  cashier_session_id UUID REFERENCES public.cashier_sessions(id) ON DELETE SET NULL,
  business_date DATE NOT NULL,
  closing_number BIGINT NOT NULL,
  first_receipt_number BIGINT,
  last_receipt_number BIGINT,
  gross_sales NUMERIC(14,4) NOT NULL DEFAULT 0,
  net_sales NUMERIC(14,4) NOT NULL DEFAULT 0,
  vat_total NUMERIC(14,4) NOT NULL DEFAULT 0,
  discounts_total NUMERIC(14,4) NOT NULL DEFAULT 0,
  refunds_total NUMERIC(14,4) NOT NULL DEFAULT 0,
  vat_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT daily_closings_store_date_number UNIQUE (store_id, business_date, closing_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_store_completed_at ON public.orders(store_id, completed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_receipt_number ON public.orders(store_id, receipt_number) WHERE receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_store_paid_at ON public.payments(store_id, paid_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_reference ON public.payments(provider, provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_store_created_at ON public.refunds(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_daily_closings_store_date ON public.daily_closings(store_id, business_date);

ALTER TABLE public.store_receipt_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;

-- Accounting data is accessible only to the tenant or platform superadmin.
CREATE POLICY "Tenant accounting payments" ON public.payments FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()))
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()));
CREATE POLICY "Tenant accounting refunds" ON public.refunds FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()))
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()));
CREATE POLICY "Tenant daily closings" ON public.daily_closings FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()))
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()));
CREATE POLICY "Tenant receipt counters" ON public.store_receipt_counters FOR SELECT TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()));

CREATE OR REPLACE FUNCTION public.next_store_receipt_number(p_store_id UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_number BIGINT;
BEGIN
  INSERT INTO public.store_receipt_counters(store_id, last_receipt_number)
  VALUES (p_store_id, 1)
  ON CONFLICT (store_id) DO UPDATE
    SET last_receipt_number = public.store_receipt_counters.last_receipt_number + 1,
        updated_at = now()
  RETURNING last_receipt_number INTO next_number;
  RETURN next_number;
END;
$$;

-- Inserts order, immutable line snapshots, payment and receipt number in one transaction.
CREATE OR REPLACE FUNCTION public.create_accounting_order(
  p_store_id UUID, p_device_id UUID, p_cashier_session_id UUID, p_status TEXT,
  p_payment_method TEXT, p_order_type TEXT, p_currency TEXT, p_discount_amount NUMERIC,
  p_subtotal_excl_vat NUMERIC, p_vat_amount NUMERIC, p_total_amount NUMERIC,
  p_raw_payload JSONB, p_lines JSONB
) RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders; v_receipt BIGINT; v_line JSONB; v_device_store UUID;
BEGIN
  SELECT store_id INTO v_device_store FROM public.pos_devices WHERE id = p_device_id AND status::text = 'active';
  -- Anonymous POS calls must present an active device. Authenticated tenant users
  -- and the service role can also create orders for their own store.
  IF NOT (
    v_device_store = p_store_id
    OR EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = p_store_id AND su.user_id = (SELECT auth.uid()))
    OR (SELECT is_superadmin())
    OR (SELECT auth.role()) = 'service_role'
  ) THEN RAISE EXCEPTION 'Not allowed to create an order for this store'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'Order requires lines'; END IF;
  IF p_total_amount < 0 OR p_subtotal_excl_vat < 0 OR p_vat_amount < 0 OR p_discount_amount < 0 THEN RAISE EXCEPTION 'Invalid accounting totals'; END IF;
  IF ABS((SELECT COALESCE(SUM((line->>'grossAmount')::numeric), 0) FROM jsonb_array_elements(p_lines) line) - p_total_amount) > 0.0001
    OR ABS((SELECT COALESCE(SUM((line->>'netAmount')::numeric), 0) FROM jsonb_array_elements(p_lines) line) - p_subtotal_excl_vat) > 0.0001
    OR ABS((SELECT COALESCE(SUM((line->>'vatAmount')::numeric), 0) FROM jsonb_array_elements(p_lines) line) - p_vat_amount) > 0.0001
  THEN RAISE EXCEPTION 'Accounting totals do not match line snapshots'; END IF;
  v_receipt := public.next_store_receipt_number(p_store_id);
  INSERT INTO public.orders(store_id, status, total_amount, raw_payload, receipt_number, order_type, cashier_session_id, pos_device_id, completed_at, subtotal_excl_vat, vat_amount, discount_amount, currency)
  VALUES (p_store_id, p_status, p_total_amount, p_raw_payload, v_receipt, p_order_type, p_cashier_session_id, p_device_id,
    CASE WHEN p_status = 'completed' THEN now() ELSE NULL END, p_subtotal_excl_vat, p_vat_amount, p_discount_amount, COALESCE(p_currency, 'EUR'))
  RETURNING * INTO v_order;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF COALESCE((v_line->>'quantity')::integer, 0) <= 0
      OR COALESCE((v_line->>'grossAmount')::numeric, -1) < 0
      OR COALESCE((v_line->>'netAmount')::numeric, -1) < 0
      OR COALESCE((v_line->>'vatAmount')::numeric, -1) < 0
    THEN RAISE EXCEPTION 'Invalid order line'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (v_line->>'productId')::uuid AND p.store_id = p_store_id) THEN
      RAISE EXCEPTION 'Product does not belong to this store';
    END IF;
    INSERT INTO public.order_items(order_id, product_id, store_id, quantity, subtotal, product_name_snapshot, category_name_snapshot, vat_rate, unit_price_incl_vat, discount_amount, net_amount, vat_amount, gross_amount)
    VALUES (v_order.id, (v_line->>'productId')::uuid, p_store_id, (v_line->>'quantity')::integer, (v_line->>'grossAmount')::numeric,
      v_line->>'productName', v_line->>'categoryName', (v_line->>'vatRate')::numeric, (v_line->>'unitPriceInclVat')::numeric,
      (v_line->>'discountAmount')::numeric, (v_line->>'netAmount')::numeric, (v_line->>'vatAmount')::numeric, (v_line->>'grossAmount')::numeric);
  END LOOP;
  INSERT INTO public.payments(store_id, order_id, method, status, amount, provider, paid_at)
  VALUES (p_store_id, v_order.id, p_payment_method, CASE WHEN p_status = 'completed' THEN 'paid' ELSE 'pending' END, p_total_amount,
    CASE WHEN p_payment_method = 'card' THEN 'stripe' ELSE NULL END, CASE WHEN p_status = 'completed' THEN now() ELSE NULL END);
  RETURN v_order;
END;
$$;

-- Called only after the payment provider confirms a card payment. The unique
-- provider reference makes retries safe and prevents duplicate settlement rows.
CREATE OR REPLACE FUNCTION public.complete_accounting_card_payment(
  p_order_id UUID, p_provider_reference TEXT, p_processor_fee NUMERIC DEFAULT 0
) RETURNS public.payments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payment public.payments; v_store_id UUID;
BEGIN
  IF NULLIF(trim(p_provider_reference), '') IS NULL OR p_processor_fee < 0 THEN
    RAISE EXCEPTION 'A provider reference and non-negative fee are required';
  END IF;
  SELECT store_id INTO v_store_id FROM public.orders WHERE id = p_order_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = v_store_id AND su.user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to complete this payment';
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE provider = 'stripe' AND provider_reference = p_provider_reference;
  IF FOUND THEN
    IF v_payment.order_id <> p_order_id THEN RAISE EXCEPTION 'Provider reference is already assigned to another order'; END IF;
    RETURN v_payment;
  END IF;
  UPDATE public.payments
  SET status = 'paid', provider = 'stripe', provider_reference = p_provider_reference,
      processor_fee = p_processor_fee, net_settlement = amount - p_processor_fee, paid_at = now()
  WHERE order_id = p_order_id AND method = 'card' AND status = 'pending'
  RETURNING * INTO v_payment;
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending card payment exists for this order'; END IF;
  UPDATE public.orders SET status = 'completed', completed_at = now() WHERE id = p_order_id AND status = 'pending';
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_accounting_card_payment(p_order_id UUID, p_device_id UUID)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pos_devices d WHERE d.id = p_device_id AND d.store_id = v_order.store_id AND d.status::text = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = v_order.store_id AND su.user_id = (SELECT auth.uid()))
    AND NOT (SELECT is_superadmin())
  THEN RAISE EXCEPTION 'Not allowed to cancel this payment'; END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'Only pending orders can be cancelled'; END IF;
  UPDATE public.payments SET status = 'cancelled' WHERE order_id = p_order_id AND method = 'card' AND status = 'pending';
  UPDATE public.orders SET status = 'cancelled' WHERE id = p_order_id RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;

-- Locks each store/day while generating a close so concurrent cashiers cannot
-- create duplicate closing numbers or inconsistent snapshots.
CREATE OR REPLACE FUNCTION public.finalize_daily_closing(p_store_id UUID, p_business_date DATE, p_cashier_session_id UUID DEFAULT NULL)
RETURNS public.daily_closings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_closing public.daily_closings; v_closing_number BIGINT;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM public.store_users su WHERE su.store_id = p_store_id AND su.user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to close this store';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_store_id::text || ':' || p_business_date::text));
  SELECT COALESCE(MAX(closing_number), 0) + 1 INTO v_closing_number FROM public.daily_closings WHERE store_id = p_store_id AND business_date = p_business_date;
  INSERT INTO public.daily_closings (
    store_id, cashier_session_id, business_date, closing_number, first_receipt_number, last_receipt_number,
    gross_sales, net_sales, vat_total, discounts_total, refunds_total, vat_breakdown, payment_breakdown
  )
  SELECT p_store_id, p_cashier_session_id, p_business_date, v_closing_number,
    MIN(receipt_number), MAX(receipt_number),
    COALESCE(SUM(gross_amount), 0), COALESCE(SUM(net_amount), 0), COALESCE(SUM(vat_amount), 0), COALESCE(SUM(discount_amount), 0), 0,
    COALESCE(jsonb_agg(jsonb_build_object('vat_rate', vat_rate, 'net', net_amount, 'vat', vat_amount, 'gross', gross_amount)), '[]'::jsonb),
    '[]'::jsonb
  FROM (
    SELECT t.receipt_number, t.vat_rate, SUM(t.net_amount) net_amount, SUM(t.vat_amount) vat_amount, SUM(t.gross_amount) gross_amount, SUM(t.discount_amount) discount_amount
    FROM public.accountant_sales_transactions t WHERE t.store_id = p_store_id AND t.business_date = p_business_date
    GROUP BY t.receipt_number, t.vat_rate
  ) sales
  RETURNING * INTO v_closing;
  UPDATE public.daily_closings dc
  SET refunds_total = COALESCE((SELECT SUM(refund_amount) FROM public.refunds r WHERE r.store_id = p_store_id AND (r.created_at AT TIME ZONE COALESCE((SELECT timezone FROM public.stores WHERE id = p_store_id), 'Europe/Brussels'))::date = p_business_date), 0),
      payment_breakdown = COALESCE((SELECT jsonb_agg(jsonb_build_object('method', method, 'status', status, 'amount', amount, 'processor_fee', processor_fee, 'net_settlement', net_settlement)) FROM (SELECT method, status, SUM(amount) amount, SUM(processor_fee) processor_fee, SUM(COALESCE(net_settlement, amount)) net_settlement FROM public.accountant_payments_summary WHERE store_id = p_store_id AND business_date = p_business_date GROUP BY method, status) payments), '[]'::jsonb)
  WHERE id = v_closing.id RETURNING * INTO v_closing;
  RETURN v_closing;
END;
$$;

CREATE OR REPLACE VIEW public.accountant_sales_transactions WITH (security_invoker = true) AS
SELECT o.store_id, (o.completed_at AT TIME ZONE COALESCE(s.timezone, 'Europe/Brussels'))::date AS business_date,
  o.completed_at, o.receipt_number, o.id AS order_id, o.order_type, o.status AS order_status,
  oi.product_name_snapshot AS product_name, oi.category_name_snapshot AS category_name, oi.quantity,
  oi.unit_price_incl_vat, oi.discount_amount, oi.vat_rate, oi.net_amount, oi.vat_amount, oi.gross_amount,
  o.cashier_session_id, o.pos_device_id, 'sale'::text AS row_type
FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id JOIN public.stores s ON s.id = o.store_id
WHERE o.status = 'completed' AND oi.product_name_snapshot IS NOT NULL;

CREATE OR REPLACE VIEW public.accountant_vat_summary WITH (security_invoker = true) AS
WITH sales AS (SELECT store_id, business_date, vat_rate, sum(net_amount) net_sales, sum(vat_amount) vat_sales, sum(gross_amount) gross_sales FROM public.accountant_sales_transactions GROUP BY 1,2,3),
refund_totals AS (SELECT r.store_id, (r.created_at AT TIME ZONE COALESCE(s.timezone, 'Europe/Brussels'))::date business_date, r.vat_rate, sum(r.net_amount) refund_net, sum(r.vat_amount) refund_vat, sum(r.refund_amount) refund_gross FROM public.refunds r JOIN public.stores s ON s.id=r.store_id GROUP BY 1,2,3)
SELECT COALESCE(s.store_id,r.store_id) store_id, COALESCE(s.business_date,r.business_date) business_date, COALESCE(s.vat_rate,r.vat_rate) vat_rate,
COALESCE(s.net_sales,0) net_sales, COALESCE(s.vat_sales,0) vat_amount, COALESCE(s.gross_sales,0) gross_sales, COALESCE(r.refund_net,0) refund_net, COALESCE(r.refund_vat,0) refund_vat, COALESCE(r.refund_gross,0) refund_gross,
COALESCE(s.net_sales,0)-COALESCE(r.refund_net,0) final_net, COALESCE(s.vat_sales,0)-COALESCE(r.refund_vat,0) final_vat, COALESCE(s.gross_sales,0)-COALESCE(r.refund_gross,0) final_gross FROM sales s FULL JOIN refund_totals r USING(store_id,business_date,vat_rate);

CREATE OR REPLACE VIEW public.accountant_payments_summary WITH (security_invoker = true) AS
SELECT p.store_id, (COALESCE(p.paid_at,p.created_at) AT TIME ZONE COALESCE(s.timezone, 'Europe/Brussels'))::date business_date, COALESCE(p.paid_at,p.created_at) paid_at,
o.id order_id, o.receipt_number, p.method, p.provider, p.status, p.amount, p.processor_fee, p.net_settlement, p.provider_reference
FROM public.payments p JOIN public.orders o ON o.id=p.order_id JOIN public.stores s ON s.id=p.store_id;

REVOKE ALL ON FUNCTION public.next_store_receipt_number(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_accounting_order(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_accounting_card_payment(UUID, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_accounting_card_payment(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_daily_closing(UUID, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_accounting_order(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_accounting_card_payment(UUID, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_accounting_card_payment(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_daily_closing(UUID, DATE, UUID) TO authenticated;
GRANT SELECT ON public.accountant_sales_transactions, public.accountant_vat_summary, public.accountant_payments_summary TO authenticated;
