REVOKE ALL ON public.stripe_terminal_readers FROM anon, public;
GRANT SELECT ON public.stripe_terminal_readers TO authenticated;
