-- Additive system health checker RPC
CREATE OR REPLACE FUNCTION public.superadmin_get_system_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_order TIMESTAMPTZ;
  v_latest_payment TIMESTAMPTZ;
  v_total_terminals INT;
  v_offline_terminals INT;
  v_stale_heartbeats INT;
  v_stuck_payments INT;
  v_stuck_pending INT;
  v_stuck_split INT;
  v_incidents JSONB;
  v_terminals JSONB;
BEGIN
  -- Check superadmin authorization
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required';
  END IF;

  -- 1. Fetch latest times
  SELECT completed_at INTO v_latest_order FROM public.orders WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1;
  SELECT paid_at INTO v_latest_payment FROM public.payments WHERE method = 'card' AND status = 'paid' ORDER BY paid_at DESC LIMIT 1;

  -- 2. Terminal stats
  SELECT count(*) INTO v_total_terminals FROM public.terminal_devices;
  SELECT count(*) INTO v_offline_terminals FROM public.terminal_devices WHERE status <> 'online' OR last_heartbeat_at < now() - INTERVAL '60 seconds';
  SELECT count(*) INTO v_stale_heartbeats FROM public.terminal_devices WHERE last_heartbeat_at < now() - INTERVAL '5 minutes';

  -- 3. Stuck requests
  SELECT count(*) INTO v_stuck_payments FROM public.payment_requests WHERE status IN ('pending', 'claimed', 'waiting_for_card', 'processing') AND updated_at < now() - INTERVAL '5 minutes';
  SELECT count(*) INTO v_stuck_pending FROM public.orders WHERE status = 'pending' AND created_at < now() - INTERVAL '30 minutes';
  SELECT count(*) INTO v_stuck_split FROM public.orders WHERE status = 'partially_paid' AND created_at < now() - INTERVAL '30 minutes';

  -- 4. Gather incidents
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_incidents
  FROM (
    -- Stuck payment requests
    SELECT 
      pr.created_at AS incident_time,
      s.name AS store_name,
      'Stuck Payment Request' AS incident_type,
      pr.id::text AS entity_id,
      pr.status AS status,
      'Payment request stuck in non-final status for ' || ROUND(EXTRACT(epoch FROM (now() - pr.updated_at))/60) || ' minutes' AS message,
      EXTRACT(epoch FROM (now() - pr.created_at)) AS age_seconds
    FROM public.payment_requests pr
    JOIN public.restaurant_locations rl ON pr.location_id = rl.id
    JOIN public.stores s ON rl.store_id = s.id
    WHERE pr.status IN ('pending', 'claimed', 'waiting_for_card', 'processing') AND pr.updated_at < now() - INTERVAL '5 minutes'
    
    UNION ALL
    
    -- Stuck pending orders
    SELECT 
      o.created_at AS incident_time,
      s.name AS store_name,
      'Stuck Pending Order' AS incident_type,
      o.id::text AS entity_id,
      o.status AS status,
      'Order pending for ' || ROUND(EXTRACT(epoch FROM (now() - o.created_at))/60) || ' minutes' AS message,
      EXTRACT(epoch FROM (now() - o.created_at)) AS age_seconds
    FROM public.orders o
    JOIN public.stores s ON o.store_id = s.id
    WHERE o.status = 'pending' AND o.created_at < now() - INTERVAL '30 minutes'

    UNION ALL

    -- Stuck split orders
    SELECT 
      o.created_at AS incident_time,
      s.name AS store_name,
      'Stuck Split Order' AS incident_type,
      o.id::text AS entity_id,
      o.status AS status,
      'Split payment order partially_paid for ' || ROUND(EXTRACT(epoch FROM (now() - o.created_at))/60) || ' minutes' AS message,
      EXTRACT(epoch FROM (now() - o.created_at)) AS age_seconds
    FROM public.orders o
    JOIN public.stores s ON o.store_id = s.id
    WHERE o.status = 'partially_paid' AND o.created_at < now() - INTERVAL '30 minutes'
    
    ORDER BY incident_time DESC
    LIMIT 20
  ) t;

  -- 5. Gather terminal device health status
  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_terminals
  FROM (
    SELECT 
      s.name AS store_name,
      td.display_name AS device_name,
      td.stripe_reader_serial,
      td.status AS bridge_status,
      td.reader_status,
      td.last_heartbeat_at,
      td.current_payment_request_id,
      CASE WHEN td.status = 'online' AND td.last_heartbeat_at >= now() - INTERVAL '60 seconds' THEN 'online' ELSE 'offline' END AS online_badge
    FROM public.terminal_devices td
    JOIN public.restaurant_locations rl ON td.location_id = rl.id
    JOIN public.stores s ON rl.store_id = s.id
    ORDER BY s.name, td.display_name
  ) t;

  RETURN jsonb_build_object(
    'db_reachable', true,
    'latest_order_time', v_latest_order,
    'latest_card_payment_time', v_latest_payment,
    'stripe_webhook_event', 'Not available / Not configured',
    'failed_edge_events', 'Not available / Not configured',
    'total_terminals', v_total_terminals,
    'offline_terminals', v_offline_terminals,
    'stale_heartbeats', v_stale_heartbeats,
    'stuck_payments', v_stuck_payments,
    'stuck_pending', v_stuck_pending,
    'stuck_split', v_stuck_split,
    'incidents', v_incidents,
    'terminals', v_terminals
  );
END;
$$;
