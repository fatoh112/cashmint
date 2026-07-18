CREATE TABLE IF NOT EXISTS public.terminal_enrollment_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  payment_config_id UUID NOT NULL REFERENCES public.restaurant_payment_configs(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_by_device_id UUID REFERENCES public.terminal_devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (expires_at > created_at)
);
ALTER TABLE public.terminal_enrollment_codes ENABLE ROW LEVEL SECURITY;
-- Codes are never readable through the Data API, including by restaurant staff.
REVOKE ALL ON public.terminal_enrollment_codes FROM anon, authenticated;

ALTER TABLE public.terminal_devices ADD COLUMN IF NOT EXISTS current_payment_request_id UUID REFERENCES public.payment_requests(id) ON DELETE SET NULL;
ALTER TABLE public.terminal_devices ADD COLUMN IF NOT EXISTS app_version TEXT;

CREATE OR REPLACE FUNCTION public.bridge_heartbeat(p_reader_status TEXT, p_last_error TEXT DEFAULT NULL, p_current_payment_request_id UUID DEFAULT NULL, p_app_version TEXT DEFAULT NULL)
RETURNS public.terminal_devices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_device public.terminal_devices;
BEGIN
  UPDATE terminal_devices SET status='online', reader_status=p_reader_status, last_error=p_last_error,
    current_payment_request_id=p_current_payment_request_id, app_version=p_app_version,
    last_heartbeat_at=now(), updated_at=now()
  WHERE bridge_user_id=(SELECT auth.uid()) AND status <> 'disabled' RETURNING * INTO v_device;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered bridge required'; END IF;
  RETURN v_device;
END; $$;
REVOKE ALL ON FUNCTION public.bridge_heartbeat(TEXT,TEXT,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bridge_heartbeat(TEXT,TEXT,UUID,TEXT) TO authenticated;
