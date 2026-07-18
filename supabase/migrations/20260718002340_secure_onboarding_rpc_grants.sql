REVOKE EXECUTE ON FUNCTION public.save_store_onboarding(TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_store_onboarding(TEXT, TEXT, JSONB, BOOLEAN) TO authenticated;
