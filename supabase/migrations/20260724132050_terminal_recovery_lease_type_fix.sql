CREATE OR REPLACE FUNCTION public.claim_terminal_payment_recovery(
  p_payment_request_id UUID,
  p_claim_token TEXT,
  p_min_interval_seconds INTEGER DEFAULT 60,
  p_lease_seconds INTEGER DEFAULT 45
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed_count INTEGER := 0;
BEGIN
  IF p_payment_request_id IS NULL OR NULLIF(trim(p_claim_token), '') IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.payment_requests
  SET recovery_claimed_at = now(), recovery_claim_token = p_claim_token, last_reconciled_at = now(), updated_at = now()
  WHERE id = p_payment_request_id
    AND status IN ('pending','waiting_for_card','processing','in_progress','claimed','creating_payment_intent','cancel_requested','unknown')
    AND (recovery_claimed_at IS NULL OR recovery_claimed_at < now() - make_interval(secs => GREATEST(1, p_lease_seconds)))
    AND (last_reconciled_at IS NULL OR last_reconciled_at < now() - make_interval(secs => GREATEST(0, p_min_interval_seconds)));
  GET DIAGNOSTICS v_changed_count = ROW_COUNT;
  RETURN v_changed_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_terminal_payment_recovery(
  p_payment_request_id UUID,
  p_claim_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed_count INTEGER := 0;
BEGIN
  UPDATE public.payment_requests
  SET recovery_claimed_at = NULL, recovery_claim_token = NULL, updated_at = now()
  WHERE id = p_payment_request_id AND recovery_claim_token = p_claim_token;
  GET DIAGNOSTICS v_changed_count = ROW_COUNT;
  RETURN v_changed_count > 0;
END;
$$;
