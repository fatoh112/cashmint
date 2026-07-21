-- This migration explicitly whitelists approved POS-facing store payload fields in get_pos_catalog(uuid).

CREATE OR REPLACE FUNCTION public.get_pos_catalog(device_uuid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  target_store uuid;
begin
  select store_id
  into target_store
  from public.pos_devices
  where id = device_uuid
    and status = 'active';

  if target_store is null then
    raise exception 'Invalid or revoked POS device';
  end if;

  return jsonb_build_object(
    'store', (
      select jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'business_type', s.business_type,
        'logo_url', s.logo_url,
        'theme_color', s.theme_color,
        'primary_color', s.primary_color,
        'bg_color', s.bg_color,
        'banner_url', s.banner_url,
        'theme_config', s.theme_config,
        'onboarding_status', s.onboarding_status,
        'onboarding_completed', s.onboarding_completed,
        'split_payment_enabled', s.split_payment_enabled
      )
      from public.stores s
      where s.id = target_store
    ),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.name)
      from public.categories c
      where c.store_id = target_store
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.name)
      from public.products p
      where p.store_id = target_store
    ), '[]'::jsonb),
    'modifiers', coalesce((
      select jsonb_agg(to_jsonb(m))
      from public.modifiers m
      join public.products p on p.id = m.product_id
      where p.store_id = target_store
    ), '[]'::jsonb),
    'bundle_components', coalesce((
      select jsonb_agg(to_jsonb(bc))
      from public.product_bundle_components bc
      where bc.store_id = target_store
    ), '[]'::jsonb)
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pos_catalog(uuid) TO anon, authenticated;
