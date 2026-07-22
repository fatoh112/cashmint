CREATE TABLE IF NOT EXISTS public.stripe_terminal_webhook_events(
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.stripe_terminal_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_terminal_webhook_events FROM PUBLIC, anon, authenticated;
