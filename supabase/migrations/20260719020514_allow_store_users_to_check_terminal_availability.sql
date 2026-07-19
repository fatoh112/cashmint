-- The Backoffice has a store membership, while the Android bridge has either a
-- location membership or an active POS device. All three are authorized to
-- check reader availability for the same store.
create or replace function public.terminal_payment_availability(
  p_store_id uuid,
  p_pos_device_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.restaurant_locations;
  v_available boolean;
  v_active boolean;
begin
  select * into v_location
  from public.restaurant_locations
  where store_id = p_store_id;

  if not found or not (
    public.is_location_member(v_location.id)
    or exists (
      select 1
      from public.store_users su
      where su.store_id = p_store_id
        and su.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.pos_devices d
      where d.id = p_pos_device_id
        and d.store_id = p_store_id
        and d.status = 'active'
    )
  ) then
    raise exception 'Not allowed to inspect terminal availability';
  end if;

  select exists (
    select 1
    from public.terminal_devices d
    join public.restaurant_payment_configs c on c.id = d.payment_config_id
    where d.location_id = v_location.id
      and d.status = 'online'
      and d.reader_status = 'connected'
      and d.last_heartbeat_at > now() - interval '60 seconds'
      and c.provider_type = 'stripe_android_bridge'
      and c.is_enabled
  ) into v_available;

  select exists (
    select 1
    from public.payment_requests pr
    where pr.location_id = v_location.id
      and pr.status in ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      and pr.expires_at > now()
  ) into v_active;

  return jsonb_build_object(
    'available', v_available and not v_active,
    'reader_online', v_available,
    'active_payment', v_active
  );
end;
$$;

notify pgrst, 'reload schema';
