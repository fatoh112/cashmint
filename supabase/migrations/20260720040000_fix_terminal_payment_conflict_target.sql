-- Migration: Fix ON CONFLICT target in request_terminal_card_payment from (order_id) to (idempotency_key)

CREATE OR REPLACE FUNCTION public.request_terminal_card_payment(
  p_order_id UUID,
  p_pos_device_id UUID DEFAULT NULL
) RETURNS public.payment_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders;
  v_location public.restaurant_locations;
  v_config public.restaurant_payment_configs;
  v_request public.payment_requests;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not available';
  END IF;

  SELECT * INTO v_location FROM public.restaurant_locations WHERE store_id = v_order.store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store has no restaurant payment location';
  END IF;

  IF NOT (
    public.is_location_member(v_location.id)
    OR EXISTS (SELECT 1 FROM public.pos_devices d WHERE d.id = p_pos_device_id AND d.store_id = v_order.store_id AND d.status = 'active')
  ) THEN
    RAISE EXCEPTION 'Order not available';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not awaiting card payment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_requests pr
    WHERE pr.location_id = v_location.id
      AND pr.order_id <> v_order.id
      AND pr.status IN ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      AND pr.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Another terminal payment is already active for this location';
  END IF;

  SELECT * INTO v_config
  FROM public.restaurant_payment_configs
  WHERE location_id = v_location.id AND provider_type = 'stripe_android_bridge' AND is_enabled
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card terminal is not configured for this location';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.terminal_devices d
    WHERE d.location_id = v_location.id
      AND d.payment_config_id = v_config.id
      AND d.status = 'online'
      AND d.reader_status = 'connected'
      AND d.last_heartbeat_at > now() - INTERVAL '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Card payment bridge or reader is unavailable';
  END IF;

  INSERT INTO public.payment_requests (restaurant_id, location_id, order_id, payment_config_id, provider_type, idempotency_key)
  VALUES (v_location.restaurant_id, v_location.id, v_order.id, v_config.id, v_config.provider_type, 'terminal-payment:' || v_order.id::text)
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

NOTIFY pgrst, 'reload schema';
