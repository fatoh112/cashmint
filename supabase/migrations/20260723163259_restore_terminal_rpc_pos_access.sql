-- POS cashier sessions use the anon role and are authorized inside these SECURITY DEFINER RPCs
-- by their active POS device. Keep the existing authenticated access too.
GRANT EXECUTE ON FUNCTION public.request_terminal_card_payment(UUID,UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminal_payment_availability(UUID,UUID) TO anon, authenticated;
