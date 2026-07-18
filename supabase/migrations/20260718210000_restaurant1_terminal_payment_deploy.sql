-- Consolidated, idempotent terminal payment deployment for the current
-- Restaurant 1 database shape. This migration intentionally does not alter
-- orders, products, users, tenants, printer, or POS-device tables.

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  store_id uuid unique references public.stores(id) on delete set null,
  name text not null,
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table if not exists public.restaurant_payment_configs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  provider_type text not null check (provider_type in ('stripe_android_bridge','stripe_smart_reader','adyen','mollie','worldline')),
  is_enabled boolean not null default false,
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  provider_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, provider_type)
);

create table if not exists public.terminal_devices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  payment_config_id uuid not null references public.restaurant_payment_configs(id) on delete restrict,
  bridge_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  hardware_type text not null default 'bbpos_wisepad_3',
  stripe_reader_serial text,
  status text not null default 'offline' check (status in ('offline','online','disabled')),
  reader_status text not null default 'disconnected' check (reader_status in ('disconnected','discovering','connected','error')),
  current_payment_request_id uuid,
  app_version text,
  last_heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, display_name)
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  location_id uuid not null references public.restaurant_locations(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  payment_config_id uuid not null references public.restaurant_payment_configs(id) on delete restrict,
  provider_type text not null,
  status text not null default 'pending' check (status in ('pending','claimed','creating_payment_intent','waiting_for_card','processing','succeeded','failed','cancel_requested','cancelled','expired','unknown')),
  claimed_by_device_id uuid references public.terminal_devices(id) on delete set null,
  claimed_at timestamptz,
  stripe_payment_intent_id text unique,
  stripe_payment_intent_client_secret text,
  idempotency_key text not null unique,
  failure_code text,
  failure_message text,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.terminal_devices
  add column if not exists current_payment_request_id uuid references public.payment_requests(id) on delete set null;
alter table public.terminal_devices add column if not exists app_version text;

insert into public.restaurants (id, name)
select s.id, s.name
from public.stores s
where not exists (select 1 from public.restaurants r where r.id = s.id);

insert into public.restaurant_locations (id, restaurant_id, store_id, name, currency)
select s.id, s.id, s.id, s.name, 'eur'
from public.stores s
where not exists (select 1 from public.restaurant_locations l where l.store_id = s.id);

create index if not exists idx_restaurant_locations_store_id on public.restaurant_locations(store_id);
create index if not exists idx_payment_configs_location_provider on public.restaurant_payment_configs(location_id, provider_type);
create index if not exists idx_terminal_devices_location_status on public.terminal_devices(location_id, status, reader_status);
create index if not exists idx_terminal_devices_bridge_user on public.terminal_devices(bridge_user_id);
create index if not exists idx_payment_requests_dispatch on public.payment_requests(location_id, status, created_at);
create index if not exists idx_payment_requests_order_id on public.payment_requests(order_id);
create index if not exists idx_payment_requests_claimed_device on public.payment_requests(claimed_by_device_id);

create table if not exists public.terminal_enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  location_id uuid not null references public.restaurant_locations(id) on delete cascade,
  payment_config_id uuid not null references public.restaurant_payment_configs(id) on delete restrict,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_device_id uuid references public.terminal_devices(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (expires_at > created_at)
);

do $$ begin
  alter table public.terminal_devices
    add constraint terminal_devices_current_payment_request_id_fkey
    foreign key (current_payment_request_id) references public.payment_requests(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_terminal_enrollment_code_hash on public.terminal_enrollment_codes(code_hash);

alter table public.restaurants enable row level security;
alter table public.restaurant_locations enable row level security;
alter table public.restaurant_payment_configs enable row level security;
alter table public.terminal_devices enable row level security;
alter table public.payment_requests enable row level security;
alter table public.terminal_enrollment_codes enable row level security;

create or replace function public.is_location_member(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_locations l
    join public.store_users su on su.store_id = l.store_id
    where l.id = p_location_id and su.user_id = (select auth.uid())
  ) or coalesce((select public.is_superadmin()), false);
$$;

create or replace function public.request_terminal_card_payment(p_order_id uuid, p_pos_device_id uuid default null)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_location public.restaurant_locations;
  v_config public.restaurant_payment_configs;
  v_request public.payment_requests;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not available';
  end if;

  select * into v_location from public.restaurant_locations where store_id = v_order.store_id;
  if not found then
    raise exception 'Store has no restaurant payment location';
  end if;

  if not (
    public.is_location_member(v_location.id)
    or exists (select 1 from public.pos_devices d where d.id = p_pos_device_id and d.store_id = v_order.store_id and d.status = 'active')
  ) then
    raise exception 'Order not available';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'Order is not awaiting card payment';
  end if;

  if exists (
    select 1 from public.payment_requests pr
    where pr.location_id = v_location.id
      and pr.order_id <> v_order.id
      and pr.status in ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      and pr.expires_at > now()
  ) then
    raise exception 'Another terminal payment is already active for this location';
  end if;

  select * into v_config
  from public.restaurant_payment_configs
  where location_id = v_location.id and provider_type = 'stripe_android_bridge' and is_enabled
  limit 1;
  if not found then
    raise exception 'Card terminal is not configured for this location';
  end if;

  if not exists (
    select 1
    from public.terminal_devices d
    where d.location_id = v_location.id
      and d.payment_config_id = v_config.id
      and d.status = 'online'
      and d.reader_status = 'connected'
      and d.last_heartbeat_at > now() - interval '60 seconds'
  ) then
    raise exception 'Card payment bridge or reader is unavailable';
  end if;

  insert into public.payment_requests(restaurant_id, location_id, order_id, payment_config_id, provider_type, idempotency_key)
  values (v_location.restaurant_id, v_location.id, v_order.id, v_config.id, v_config.provider_type, 'terminal-payment:' || v_order.id::text)
  on conflict (order_id) do update set updated_at = now()
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.terminal_payment_availability(p_store_id uuid, p_pos_device_id uuid default null)
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
  select * into v_location from public.restaurant_locations where store_id = p_store_id;
  if not found or not (
    public.is_location_member(v_location.id)
    or exists (select 1 from public.pos_devices d where d.id = p_pos_device_id and d.store_id = p_store_id and d.status = 'active')
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

  return jsonb_build_object('available', v_available and not v_active, 'reader_online', v_available, 'active_payment', v_active);
end;
$$;

create or replace function public.claim_terminal_payment_request(p_payment_request_id uuid)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.terminal_devices;
  v_request public.payment_requests;
begin
  select * into v_device
  from public.terminal_devices
  where bridge_user_id = (select auth.uid())
    and status = 'online'
    and reader_status = 'connected'
    and last_heartbeat_at > now() - interval '60 seconds'
  for update;

  if not found then
    raise exception 'Registered online reader bridge required';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_device.id::text));

  update public.payment_requests
  set status = 'claimed',
      claimed_by_device_id = v_device.id,
      claimed_at = now(),
      updated_at = now()
  where id = p_payment_request_id
    and location_id = v_device.location_id
    and status = 'pending'
    and expires_at > now()
  returning * into v_request;

  if not found then
    raise exception 'Payment request is no longer claimable';
  end if;

  return v_request;
end;
$$;

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
begin
  select id into v_device_id from public.terminal_devices where bridge_user_id = (select auth.uid());

  update public.payment_requests
  set status = p_status,
      failure_code = p_failure_code,
      failure_message = p_failure_message,
      updated_at = now()
  where id = p_payment_request_id
    and claimed_by_device_id = v_device_id
    and status <> 'succeeded'
    and p_status in ('creating_payment_intent','waiting_for_card','processing','failed','cancelled','unknown')
  returning * into v_request;

  if not found then
    raise exception 'Payment request is not owned by this bridge';
  end if;

  return v_request;
end;
$$;

create or replace function public.bridge_heartbeat(
  p_reader_status text,
  p_last_error text default null,
  p_current_payment_request_id uuid default null,
  p_app_version text default null
)
returns public.terminal_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.terminal_devices;
begin
  if p_reader_status not in ('disconnected','discovering','connected','error') then
    raise exception 'Invalid reader status';
  end if;

  update public.terminal_devices
  set status = 'online',
      reader_status = p_reader_status,
      last_error = p_last_error,
      current_payment_request_id = p_current_payment_request_id,
      app_version = p_app_version,
      last_heartbeat_at = now(),
      updated_at = now()
  where bridge_user_id = (select auth.uid()) and status <> 'disabled'
  returning * into v_device;

  if not found then
    raise exception 'Registered bridge required';
  end if;

  return v_device;
end;
$$;

create or replace function public.bridge_mark_terminal_cancel_requested(p_payment_request_id uuid)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payment_requests;
  v_device_id uuid;
begin
  select id into v_device_id from public.terminal_devices where bridge_user_id = (select auth.uid());

  update public.payment_requests
  set status = 'cancel_requested', updated_at = now()
  where id = p_payment_request_id
    and claimed_by_device_id = v_device_id
    and status in ('claimed','creating_payment_intent','waiting_for_card','processing','unknown')
  returning * into v_request;

  if not found then
    raise exception 'Payment request is not cancellable by this bridge';
  end if;

  return v_request;
end;
$$;

revoke all on function public.is_location_member(uuid) from public;
revoke all on function public.request_terminal_card_payment(uuid, uuid) from public;
revoke all on function public.terminal_payment_availability(uuid, uuid) from public;
revoke all on function public.claim_terminal_payment_request(uuid) from public;
revoke all on function public.bridge_update_terminal_payment(uuid, text, text, text) from public;
revoke all on function public.bridge_heartbeat(text, text, uuid, text) from public;
revoke all on function public.bridge_mark_terminal_cancel_requested(uuid) from public;

grant execute on function public.is_location_member(uuid) to authenticated;
grant execute on function public.request_terminal_card_payment(uuid, uuid) to anon, authenticated;
grant execute on function public.terminal_payment_availability(uuid, uuid) to anon, authenticated;
grant execute on function public.claim_terminal_payment_request(uuid) to authenticated;
grant execute on function public.bridge_update_terminal_payment(uuid, text, text, text) to authenticated;
grant execute on function public.bridge_heartbeat(text, text, uuid, text) to authenticated;
grant execute on function public.bridge_mark_terminal_cancel_requested(uuid) to authenticated;

revoke all on public.terminal_enrollment_codes from anon, authenticated;

drop policy if exists "Restaurant members can read restaurants" on public.restaurants;
create policy "Restaurant members can read restaurants"
on public.restaurants for select to authenticated
using (exists (select 1 from public.restaurant_locations l where l.restaurant_id = restaurants.id and public.is_location_member(l.id)));

drop policy if exists "Restaurant members can read locations" on public.restaurant_locations;
create policy "Restaurant members can read locations"
on public.restaurant_locations for select to authenticated
using (public.is_location_member(id));

drop policy if exists "Restaurant members can read payment configs" on public.restaurant_payment_configs;
create policy "Restaurant members can read payment configs"
on public.restaurant_payment_configs for select to authenticated
using (public.is_location_member(location_id));

drop policy if exists "Restaurant members and bridge can read terminals" on public.terminal_devices;
create policy "Restaurant members and bridge can read terminals"
on public.terminal_devices for select to authenticated
using (public.is_location_member(location_id) or bridge_user_id = (select auth.uid()));

drop policy if exists "Restaurant members and owning bridge can read payment requests" on public.payment_requests;
create policy "Restaurant members and owning bridge can read payment requests"
on public.payment_requests for select to authenticated
using (
  public.is_location_member(location_id)
  or claimed_by_device_id in (select id from public.terminal_devices where bridge_user_id = (select auth.uid()))
);

drop policy if exists "Bridge can read pending work for its location" on public.payment_requests;
create policy "Bridge can read pending work for its location"
on public.payment_requests for select to authenticated
using (
  status in ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
  and exists (
    select 1 from public.terminal_devices d
    where d.location_id = payment_requests.location_id
      and d.bridge_user_id = (select auth.uid())
      and d.status = 'online'
  )
);

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
