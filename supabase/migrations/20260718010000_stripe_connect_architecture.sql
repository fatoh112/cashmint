-- Stripe Connect account links. Stripe credentials remain exclusively in Edge
-- Function secrets; this schema stores only the connected account identifier
-- and non-sensitive connection metadata.

CREATE TABLE IF NOT EXISTS public.stripe_connect_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A short-lived, single-use OAuth state token binds a Stripe callback to the
-- store administrator who started it. It is only accessed by service-role Edge
-- Functions and is never exposed through the Data API.
CREATE TABLE IF NOT EXISTS public.stripe_connect_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_connect_states_active
  ON public.stripe_connect_states(state, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.stripe_connect_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_connect_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Store admins read Stripe Connect status" ON public.stripe_connect_connections;
CREATE POLICY "Store admins read Stripe Connect status"
  ON public.stripe_connect_connections FOR SELECT TO authenticated
  USING (public.check_user_is_store_admin(store_id) OR public.is_superadmin());

-- There are deliberately no client write policies. All connection and OAuth
-- state writes run in the server-side Edge Functions with the service role.
REVOKE ALL ON TABLE public.stripe_connect_states FROM anon, authenticated;
GRANT SELECT ON TABLE public.stripe_connect_connections TO authenticated;
