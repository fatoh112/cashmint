-- Terminal reader recovery states.
-- Additive/idempotent: no tables or rows are dropped.

alter table public.terminal_devices
  drop constraint if exists terminal_devices_reader_action_status_check;

alter table public.terminal_devices
  add constraint terminal_devices_reader_action_status_check
  check (reader_action_status in ('idle','discovering','collecting','processing','cancelling','recovering','rebooting','error'));

create or replace function public.bridge_update_terminal_payment(
  p_payment_request_id uuid,
  p_status text,
  p_failure_code text default null,
  p_failure_message text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payment_requests;
  v_device_id uuid;
  v_final_statuses constant text[] := array['succeeded','failed','cancelled','expired'];
begin
  if p_status not in ('creating_payment_intent','waiting_for_card','processing','failed','cancelled','unknown','expired') then
    raise exception 'Invalid payment request status';
  end if;

  select id into v_device_id
  from public.terminal_devices
  where bridge_user_id = (select auth.uid())
    and status <> 'disabled';

  if v_device_id is null then
    raise exception 'Registered bridge required';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
    and claimed_by_device_id = v_device_id
  for update;

  if not found then
    raise exception 'Payment request is not owned by this bridge';
  end if;

  if v_request.status = any(v_final_statuses) then
    if p_status = v_request.status then
      return v_request;
    end if;
    raise exception 'Final payment request cannot transition';
  end if;

  update public.payment_requests
  set status = p_status,
      failure_code = p_failure_code,
      failure_message = p_failure_message,
      last_state_reason = p_failure_message,
      last_reconciled_at = now(),
      collect_attempt_count = collect_attempt_count + case when p_status = 'waiting_for_card' then 1 else 0 end,
      process_attempt_count = process_attempt_count + case when p_status = 'processing' then 1 else 0 end,
      finalized_at = case when p_status in ('failed','cancelled','expired') then now() else finalized_at end,
      updated_at = now()
  where id = p_payment_request_id
  returning * into v_request;

  if p_status in ('failed','cancelled','expired') then
    update public.terminal_devices
    set current_payment_request_id = null,
        reader_action_status = case
          when reader_action_status in ('collecting','processing','cancelling','recovering','rebooting') then reader_action_status
          else 'idle'
        end,
        cleanup_completed_at = case
          when reader_action_status = 'idle' then now()
          else cleanup_completed_at
        end,
        updated_at = now()
    where id = v_device_id;
  end if;

  return v_request;
end;
$$;

create or replace function public.bridge_heartbeat(
  p_reader_status text,
  p_last_error text default null,
  p_current_payment_request_id uuid default null,
  p_app_version text default null,
  p_reader_action_status text default null
)
returns public.terminal_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.terminal_devices;
  v_action text := coalesce(p_reader_action_status, 'idle');
begin
  if p_reader_status not in ('disconnected','discovering','connected','error') then
    raise exception 'Invalid reader status';
  end if;

  if v_action not in ('idle','discovering','collecting','processing','cancelling','recovering','rebooting','error') then
    raise exception 'Invalid reader action status';
  end if;

  update public.terminal_devices
  set status = 'online',
      reader_status = p_reader_status,
      reader_action_status = v_action,
      last_error = p_last_error,
      current_payment_request_id = p_current_payment_request_id,
      app_version = p_app_version,
      last_heartbeat_at = now(),
      updated_at = now()
  where bridge_user_id = (select auth.uid())
    and status <> 'disabled'
  returning * into v_device;

  if not found then
    raise exception 'Registered bridge required';
  end if;

  return v_device;
end;
$$;

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
      and d.reader_action_status = 'idle'
      and d.current_payment_request_id is null
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
