-- Additive compatibility/security fixes for POS catalog access.
-- No existing rows are changed or deleted.

CREATE OR REPLACE FUNCTION public.touch_pos_device(device_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pos_devices
  SET last_active_at = now()
  WHERE id = device_uuid AND status = 'active';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pos_catalog(device_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_store UUID;
BEGIN
  SELECT store_id INTO target_store
  FROM public.pos_devices
  WHERE id = device_uuid AND status = 'active';
  IF target_store IS NULL THEN
    RAISE EXCEPTION 'Invalid or revoked POS device';
  END IF;

  RETURN jsonb_build_object(
    'store', (SELECT to_jsonb(s) FROM public.stores s WHERE s.id = target_store),
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM public.categories c WHERE c.store_id = target_store), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM public.products p WHERE p.store_id = target_store), '[]'::jsonb),
    'modifiers', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM public.modifiers m JOIN public.products p ON p.id = m.product_id WHERE p.store_id = target_store), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_pos_device_activation(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_pos_device(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_catalog(UUID) TO anon, authenticated;

-- Tenant policies for authenticated admin/backoffice users.
CREATE POLICY "Store members can read categories" ON public.categories FOR SELECT TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()) OR is_superadmin());
CREATE POLICY "Store admins can manage categories" ON public.categories FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin())
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin());

CREATE POLICY "Store members can read products" ON public.products FOR SELECT TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()) OR is_superadmin());
CREATE POLICY "Store admins can manage products" ON public.products FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin())
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin());

CREATE POLICY "Store members can read modifiers" ON public.modifiers FOR SELECT TO authenticated
USING (product_id IN (SELECT id FROM public.products WHERE store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid())) OR is_superadmin());
CREATE POLICY "Store admins can manage modifiers" ON public.modifiers FOR ALL TO authenticated
USING (product_id IN (SELECT id FROM public.products WHERE store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin')) OR is_superadmin())
WITH CHECK (product_id IN (SELECT id FROM public.products WHERE store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin')) OR is_superadmin());

CREATE POLICY "Store members can read item groups" ON public.item_groups FOR SELECT TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()) OR is_superadmin());
CREATE POLICY "Store admins can manage item groups" ON public.item_groups FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin())
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin());

CREATE POLICY "Store members can read group mappings" ON public.group_item_mapping FOR SELECT TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid()) OR is_superadmin());
CREATE POLICY "Store admins can manage group mappings" ON public.group_item_mapping FOR ALL TO authenticated
USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin())
WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = auth.uid() AND role = 'admin') OR is_superadmin());
