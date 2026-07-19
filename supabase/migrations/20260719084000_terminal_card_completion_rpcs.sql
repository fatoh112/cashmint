-- Ensure Stripe Terminal webhooks can complete or cancel accounting card orders.
-- This is idempotent and does not drop tables or data.

create or replace function public.complete_accounting_card_payment(
  p_order_id uuid,
  p_provider_reference text,
  p_processor_fee numeric default 0
) returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_store_id uuid;
begin
  if nullif(trim(p_provider_reference), '') is null or coalesce(p_processor_fee, 0) < 0 then
    raise exception 'A provider reference and non-negative fee are required';
  end if;

  select store_id into v_store_id
  from public.orders
  where id = p_order_id;

  if v_store_id is null then
    raise exception 'Order not found';
  end if;

  if not (
    exists (
      select 1
      from public.store_users su
      where su.store_id = v_store_id
        and su.user_id = (select auth.uid())
    )
    or (select public.is_superadmin())
    or (select auth.role()) = 'service_role'
    or current_user in ('postgres', 'service_role', 'supabase_admin')
  ) then
    raise exception 'Not allowed to complete this payment';
  end if;

  select * into v_payment
  from public.payments
  where provider = 'stripe'
    and provider_reference = p_provider_reference;

  if found then
    if v_payment.order_id <> p_order_id then
      raise exception 'Provider reference is already assigned to another order';
    end if;

    update public.orders
    set status = 'completed',
        completed_at = coalesce(completed_at, now())
    where id = p_order_id
      and status = 'pending';

    return v_payment;
  end if;

  update public.payments
  set status = 'paid',
      provider = 'stripe',
      provider_reference = p_provider_reference,
      processor_fee = coalesce(p_processor_fee, 0),
      net_settlement = amount - coalesce(p_processor_fee, 0),
      paid_at = coalesce(paid_at, now())
  where order_id = p_order_id
    and method = 'card'
    and status = 'pending'
  returning * into v_payment;

  if not found then
    raise exception 'No pending card payment exists for this order';
  end if;

  update public.orders
  set status = 'completed',
      completed_at = coalesce(completed_at, now())
  where id = p_order_id
    and status = 'pending';

  return v_payment;
end;
$$;

create or replace function public.cancel_accounting_card_payment(
  p_order_id uuid,
  p_device_id uuid
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if not exists (
    select 1
    from public.pos_devices d
    where d.id = p_device_id
      and d.store_id = v_order.store_id
      and d.status::text = 'active'
  )
    and not exists (
      select 1
      from public.store_users su
      where su.store_id = v_order.store_id
        and su.user_id = (select auth.uid())
    )
    and not (select public.is_superadmin())
    and not ((select auth.role()) = 'service_role')
    and current_user not in ('postgres', 'service_role', 'supabase_admin')
  then
    raise exception 'Not allowed to cancel this payment';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'Only pending orders can be cancelled';
  end if;

  update public.payments
  set status = 'cancelled'
  where order_id = p_order_id
    and method = 'card'
    and status = 'pending';

  update public.orders
  set status = 'cancelled'
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.complete_accounting_card_payment(uuid, text, numeric) from public;
revoke all on function public.cancel_accounting_card_payment(uuid, uuid) from public;

grant execute on function public.complete_accounting_card_payment(uuid, text, numeric) to authenticated, service_role;
grant execute on function public.cancel_accounting_card_payment(uuid, uuid) to anon, authenticated, service_role;
