-- The insecure six-parameter overload has no local callers or database dependents.
-- Remove it so only the token-protected Manual Sale RPC remains exposed.
drop function if exists public.create_manual_card_sale(bigint, text, uuid, uuid, text, text);
