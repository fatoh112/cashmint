-- Restaurant terminal payment state hardening.
-- Additive and idempotent: no tables or rows are dropped.

alter table public.payment_requests
  add column if not exists collect_attempt_count integer not null default 0,
  add column if not exists process_attempt_count integer not null default 0,
  add column if not exists last_state_reason text,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists finalized_at timestamptz;

alter table public.terminal_devices
  add column if not exists reader_action_status text not null default 'idle',
  add column if not exists cleanup_completed_at timestamptz;

create index if not exists idx_payment_requests_claimed_active
  on public.payment_requests(claimed_by_device_id, status, updated_at)
  where status in ('claimed','creating_payment_intent','waiting_for_card','processing','unknown','cancel_requested');

create index if not exists idx_terminal_devices_reader_action_status
  on public.terminal_devices(location_id, reader_status, reader_action_status, last_heartbeat_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'terminal_devices_reader_action_status_check'
      and conrelid = 'public.terminal_devices'::regclass
  ) then
    alter table public.terminal_devices
      add constraint terminal_devices_reader_action_status_check
      check (reader_action_status in ('idle','discovering','collecting','processing','cancelling','error'));
  end if;
end $$;

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
        reader_action_status = 'idle',
        cleanup_completed_at = now(),
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

  if v_action not in ('idle','discovering','collecting','processing','cancelling','error') then
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

do $$
begin
  if to_regprocedure('public.bridge_update_terminal_payment(uuid,text,text,text)') is not null then
    revoke all on function public.bridge_update_terminal_payment(uuid, text, text, text) from public;
  end if;
  if to_regprocedure('public.bridge_heartbeat(text,text,uuid,text)') is not null then
    revoke all on function public.bridge_heartbeat(text, text, uuid, text) from public;
  end if;
  if to_regprocedure('public.bridge_heartbeat(text,text,uuid,text,text)') is not null then
    revoke all on function public.bridge_heartbeat(text, text, uuid, text, text) from public;
  end if;
end $$;

grant execute on function public.bridge_update_terminal_payment(uuid, text, text, text) to authenticated;
grant execute on function public.bridge_heartbeat(text, text, uuid, text, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.payment_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.terminal_devices;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
