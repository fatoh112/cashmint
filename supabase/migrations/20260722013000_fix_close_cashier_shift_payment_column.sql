-- Fix close_cashier_shift to use the payments.method column used by the live schema.
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_session_id UUID,
  p_device_id UUID,
  p_device_token UUID,
  p_closing_cash_counted NUMERIC,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device RECORD;
  v_session RECORD;
  v_total_sales NUMERIC := 0.00;
  v_cash_sales NUMERIC := 0.00;
  v_card_sales NUMERIC := 0.00;
  v_expected_cash NUMERIC := 0.00;
  v_difference NUMERIC := 0.00;
BEGIN
  SELECT id, store_id INTO v_device
  FROM public.pos_devices
  WHERE id = p_device_id
    AND (p_device_token IS NULL OR device_token = p_device_token);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid POS device credentials');
  END IF;

  SELECT * INTO v_session
  FROM public.cashier_sessions
  WHERE id = p_session_id
    AND device_id = p_device_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active session not found or already closed');
  END IF;

  SELECT COALESCE(SUM(total_amount), 0.00) INTO v_total_sales
  FROM public.orders
  WHERE cashier_session_id = p_session_id
    AND status = 'completed'
    AND store_id = v_device.store_id;

  SELECT COALESCE(SUM(p.amount), 0.00) INTO v_cash_sales
  FROM public.payments p
  JOIN public.orders o ON o.id = p.order_id
  WHERE o.cashier_session_id = p_session_id
    AND o.status = 'completed'
    AND o.store_id = v_device.store_id
    AND p.method = 'cash'
    AND p.status IN ('paid', 'completed');

  SELECT COALESCE(SUM(p.amount), 0.00) INTO v_card_sales
  FROM public.payments p
  JOIN public.orders o ON o.id = p.order_id
  WHERE o.cashier_session_id = p_session_id
    AND o.status = 'completed'
    AND o.store_id = v_device.store_id
    AND p.method IN ('card', 'stripe_terminal', 'terminal')
    AND p.status IN ('paid', 'completed');

  v_expected_cash := COALESCE(v_session.opening_balance, 0.00) + v_cash_sales;
  v_difference := COALESCE(p_closing_cash_counted, 0.00) - v_expected_cash;

  UPDATE public.cashier_sessions
  SET status = 'closed',
      closed_at = now(),
      metadata = jsonb_build_object(
        'closing_cash_counted', p_closing_cash_counted,
        'expected_cash', v_expected_cash,
        'cash_difference', v_difference,
        'total_sales', v_total_sales,
        'cash_sales', v_cash_sales,
        'card_sales', v_card_sales,
        'notes', p_notes
      )
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'closed_at', now(),
    'opening_balance', v_session.opening_balance,
    'closing_cash_counted', p_closing_cash_counted,
    'expected_cash', v_expected_cash,
    'cash_difference', v_difference,
    'total_sales', v_total_sales,
    'cash_sales', v_cash_sales,
    'card_sales', v_card_sales
  );
END;
$$;
