-- Additive WisePOS E reader registry. Android bridge records remain untouched.
CREATE TABLE IF NOT EXISTS public.stripe_terminal_readers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  payment_config_id UUID NOT NULL REFERENCES public.restaurant_payment_configs(id) ON DELETE RESTRICT,
  stripe_account_id TEXT,
  stripe_location_id TEXT NOT NULL,
  stripe_reader_id TEXT NOT NULL,
  serial_number TEXT,
  label TEXT,
  device_type TEXT,
  status TEXT,
  action_status TEXT,
  action_type TEXT,
  livemode BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stripe_terminal_readers_location_config_fk FOREIGN KEY (location_id) REFERENCES public.restaurant_locations(id),
  CONSTRAINT stripe_terminal_readers_provider_check CHECK (stripe_reader_id <> '' AND stripe_location_id <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS stripe_terminal_readers_account_reader_key
  ON public.stripe_terminal_readers (COALESCE(stripe_account_id, ''), stripe_reader_id);
CREATE INDEX IF NOT EXISTS idx_stripe_terminal_readers_location ON public.stripe_terminal_readers(location_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_stripe_terminal_readers_config ON public.stripe_terminal_readers(payment_config_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_stripe_terminal_readers_reader ON public.stripe_terminal_readers(stripe_reader_id);

ALTER TABLE public.stripe_terminal_readers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Store members read server driven readers" ON public.stripe_terminal_readers;
CREATE POLICY "Store members read server driven readers"
  ON public.stripe_terminal_readers FOR SELECT TO authenticated
  USING (public.is_location_member(location_id) OR public.is_superadmin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.stripe_terminal_readers FROM anon, authenticated, public;
GRANT SELECT ON public.stripe_terminal_readers TO authenticated;

ALTER TABLE public.restaurant_payment_configs
  DROP CONSTRAINT IF EXISTS restaurant_payment_configs_provider_type_check;
ALTER TABLE public.restaurant_payment_configs
  ADD CONSTRAINT restaurant_payment_configs_provider_type_check
  CHECK (provider_type IN ('stripe_android_bridge', 'stripe_server_driven', 'stripe_smart_reader', 'adyen', 'mollie', 'worldline'));

ALTER TABLE public.restaurant_payment_configs
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_payment_configs_one_primary_per_location
  ON public.restaurant_payment_configs(location_id) WHERE is_primary = true;

-- Preserve the currently active Android provider as the primary provider.
UPDATE public.restaurant_payment_configs c
SET is_primary = true
WHERE c.provider_type = 'stripe_android_bridge' AND c.is_enabled
  AND NOT EXISTS (SELECT 1 FROM public.restaurant_payment_configs x WHERE x.location_id=c.location_id AND x.is_primary);

CREATE OR REPLACE FUNCTION public.touch_stripe_terminal_reader_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS stripe_terminal_readers_updated_at ON public.stripe_terminal_readers;
CREATE TRIGGER stripe_terminal_readers_updated_at BEFORE UPDATE ON public.stripe_terminal_readers
FOR EACH ROW EXECUTE FUNCTION public.touch_stripe_terminal_reader_updated_at();

REVOKE EXECUTE ON FUNCTION public.touch_stripe_terminal_reader_updated_at() FROM PUBLIC, anon, authenticated;
