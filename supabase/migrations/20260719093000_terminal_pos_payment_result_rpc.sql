create or replace function public.terminal_payment_result_for_pos(
  p_payment_request_id uuid,
  p_pos_device_id uuid default null
)
returns table(
  payment_request_id uuid,
  request_status text,
  failure_code text,
  failure_message text,
  order_id uuid,
  order_status text,
  order_completed_at timestamptz,
  total_amount numeric,
  currency text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payment_requests;
  v_order public.orders;
begin
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;

  if not found then
    raise exception 'Payment request not found';
  end if;

  select * into v_order
  from public.orders
  where id = v_request.order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  if not (
    ((select auth.role()) = 'service_role')
    or current_user in ('postgres', 'service_role', 'supabase_admin')
    or (select public.is_superadmin())
    or exists (
      select 1
      from public.store_users su
      where su.store_id = v_order.store_id
        and su.user_id = (select auth.uid())
    )
    or (
      p_pos_device_id is not null
      and (
        v_order.pos_device_id = p_pos_device_id
        or exists (
          select 1
          from public.pos_devices d
          where d.id = p_pos_device_id
            and d.store_id = v_order.store_id
            and d.status = 'active'
        )
      )
    )
  ) then
    raise exception 'Not allowed to inspect this terminal payment';
  end if;

  return query select
    v_request.id,
    v_request.status,
    v_request.failure_code,
    v_request.failure_message,
    v_order.id,
    v_order.status,
    v_order.completed_at,
    v_order.total_amount,
    v_order.currency;
end;
$$;

revoke all on function public.terminal_payment_result_for_pos(uuid, uuid) from public;
grant execute on function public.terminal_payment_result_for_pos(uuid, uuid) to anon, authenticated, service_role;
