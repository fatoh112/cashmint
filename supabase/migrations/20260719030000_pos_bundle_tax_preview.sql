CREATE OR REPLACE FUNCTION public.get_pos_catalog(device_uuid UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target_store UUID;
BEGIN
  SELECT store_id INTO target_store FROM public.pos_devices WHERE id=device_uuid AND status='active';
  IF target_store IS NULL THEN RAISE EXCEPTION 'Invalid or revoked POS device'; END IF;
  RETURN jsonb_build_object(
    'store',(SELECT to_jsonb(s) FROM public.stores s WHERE s.id=target_store),
    'categories',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM public.categories c WHERE c.store_id=target_store),'[]'::jsonb),
    'products',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM public.products p WHERE p.store_id=target_store),'[]'::jsonb),
    'modifiers',COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM public.modifiers m JOIN public.products p ON p.id=m.product_id WHERE p.store_id=target_store),'[]'::jsonb),
    'bundle_components',COALESCE((SELECT jsonb_agg(to_jsonb(bc)) FROM public.product_bundle_components bc WHERE bc.store_id=target_store),'[]'::jsonb)
  );
END $$;
NOTIFY pgrst, 'reload schema';
