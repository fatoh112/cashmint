-- Secure the Manual Card Sale RPC with POS device-token possession.
-- The old overload remains service_role-only for compatibility; POS clients use the secure overload.

create or replace function public.create_manual_card_sale(
  p_amount_cents bigint,
  p_description text,
  p_accounting_group_id uuid,
  p_pos_device_id uuid,
  p_pos_device_token uuid,
  p_idempotency_key text,
  p_order_type text default 'takeaway'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.pos_devices;
  v_session public.cashier_sessions;
  v_location public.restaurant_locations;
  v_config public.restaurant_payment_configs;
  v_group public.accounting_groups;
  v_profile public.tax_profiles;
  v_rate public.tax_rates;
  v_order public.orders;
  v_item public.order_items;
  v_request public.payment_requests;
  v_system_product_id uuid;
  v_currency text;
  v_description text := nullif(left(trim(coalesce(p_description, '')), 160), '');
  v_gross numeric;
  v_net numeric;
  v_vat numeric;
  v_receipt bigint;
  v_raw_payload jsonb;
  v_is_service_role boolean;
  v_is_superadmin boolean;
  v_is_store_member boolean;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'MANUAL_SALE_AMOUNT_INVALID';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'MANUAL_SALE_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if p_order_type not in ('dine_in', 'takeaway') then
    raise exception 'TAX_ORDER_TYPE_UNSUPPORTED';
  end if;

  select * into v_device
  from public.pos_devices d
  where d.id = p_pos_device_id and d.status::text = 'active';
  if not found then
    raise exception 'POS_DEVICE_DISABLED_OR_REVOKED';
  end if;

  select * into v_session
  from public.cashier_sessions s
  where s.device_id = v_device.id
    and s.store_id = v_device.store_id
    and s.status::text = 'open'
  order by coalesce(s.opened_at, s.created_at) desc
  limit 1
  for update;
  if not found then
    raise exception 'CASHIER_SHIFT_REQUIRED';
  end if;

  v_is_service_role := auth.role() = 'service_role';
  v_is_superadmin := coalesce(public.is_superadmin(), false);
  v_is_store_member := exists (
    select 1 from public.store_users su
    where su.store_id = v_device.store_id
      and su.user_id = auth.uid()
  );

  if not (
    v_is_service_role
    or v_is_superadmin
    or v_is_store_member
    or (
      p_pos_device_token is not null
      and v_device.device_token is not null
      and v_device.device_token = p_pos_device_token
      and v_session.device_id = v_device.id
      and v_session.store_id = v_device.store_id
    )
  ) then
    raise exception 'MANUAL_SALE_DEVICE_AUTHORIZATION_REQUIRED';
  end if;

  -- A retry of the same client operation returns the original aggregate.
  select * into v_order
  from public.orders
  where manual_sale_idempotency_key = trim(p_idempotency_key)
    and store_id = v_device.store_id
  for update;
  if found then
    select * into v_item from public.order_items where order_id = v_order.id order by id limit 1;
    select * into v_request from public.payment_requests where order_id = v_order.id order by created_at limit 1;
    return jsonb_build_object(
      'is_duplicate', true,
      'status', v_order.status,
      'amount_cents', coalesce(v_request.amount_cents, round(v_order.total_amount * 100)::bigint),
      'currency', v_order.currency,
      'order', to_jsonb(v_order),
      'order_item', to_jsonb(v_item),
      'payment_request', to_jsonb(v_request)
    );
  end if;

  select * into v_group
  from public.accounting_groups g
  where g.id = p_accounting_group_id
    and g.store_id = v_device.store_id
    and g.is_active
  for update;
  if not found then
    raise exception 'TAX_CONFIGURATION_MISSING';
  end if;

  select * into v_profile
  from public.tax_profiles tp
  where tp.id = v_group.tax_profile_id
    and tp.store_id = v_device.store_id
    and tp.is_active
  for share;
  if not found then
    raise exception 'TAX_CONFIGURATION_MISSING';
  end if;

  select * into v_rate
  from public.tax_rates tr
  where tr.id = case p_order_type
    when 'dine_in' then v_profile.dine_in_tax_rate_id
    else v_profile.takeaway_tax_rate_id
  end
    and tr.store_id = v_device.store_id
    and tr.is_active;
  if not found then
    raise exception 'TAX_CONFIGURATION_MISSING';
  end if;

  select rl.* into v_location
  from public.restaurant_locations rl
  where rl.store_id = v_device.store_id
  order by rl.created_at
  limit 1;
  if not found then
    raise exception 'WISEPOS_E_NOT_CONFIGURED';
  end if;

  select rpc.* into v_config
  from public.restaurant_payment_configs rpc
  where rpc.location_id = v_location.id
    and rpc.provider_type = 'stripe_server_driven'
    and rpc.is_enabled
    and rpc.is_primary
  order by rpc.updated_at desc
  limit 1;
  if not found then
    raise exception 'WISEPOS_E_NOT_CONFIGURED';
  end if;

  if exists (
    select 1 from public.payment_requests pr
    where pr.location_id = v_location.id
      and pr.status in ('pending','claimed','creating_payment_intent','waiting_for_card','processing','cancel_requested','unknown')
      and pr.expires_at > now()
  ) then
    raise exception 'Another terminal payment is already active for this location';
  end if;

  v_currency := lower(coalesce(v_config.currency, v_location.currency, 'eur'));
  v_gross := round(p_amount_cents::numeric / 100, 2);
  v_net := round(v_gross / (1 + v_rate.rate / 100), 4);
  v_vat := round(v_gross - v_net, 4);
  v_receipt := public.next_store_receipt_number(v_device.store_id);

  insert into public.products (
    store_id, category_id, name, name_ar, price, vat_rate,
    accounting_group_id, is_system, system_key
  ) values (
    v_device.store_id, null, 'Manual Sale', 'بيع يدوي', 0, v_rate.rate,
    v_group.id, true, 'manual_sale'
  )
  on conflict (store_id, system_key) where system_key is not null
  do update set accounting_group_id = excluded.accounting_group_id,
                vat_rate = excluded.vat_rate
  returning id into v_system_product_id;

  v_raw_payload := jsonb_build_object(
    'manual_sale', true,
    'payment_method', 'card',
    'payment_label', 'Manual Card Sale',
    'order_type', p_order_type,
    'manual_sale_description', v_description,
    'accounting_group_id', v_group.id,
    'accounting_group_name', v_group.name,
    'accounting_code', v_group.accounting_code,
    'tax_profile_name', v_profile.name,
    'vat_rate', v_rate.rate,
    'timestamp', now(),
    'cashier_name', v_session.cashier_name,
    'cart_items', jsonb_build_array(jsonb_build_object(
      'name', 'Manual Sale',
      'name_ar', 'بيع يدوي',
      'description', v_description,
      'price', v_gross,
      'quantity', 1,
      'vat_rate', v_rate.rate,
      'vatRate', v_rate.rate,
      'net_amount', v_net,
      'vat_amount', v_vat,
      'gross_amount', v_gross
    ))
  );

  insert into public.orders (
    store_id, status, total_amount, raw_payload, receipt_number, order_type,
    cashier_session_id, pos_device_id, subtotal_excl_vat, vat_amount,
    discount_amount, currency, cashier_user_id, manual_sale_idempotency_key
  ) values (
    v_device.store_id, 'pending', v_gross, v_raw_payload, v_receipt, p_order_type,
    v_session.id, v_device.id, v_net, v_vat, 0, upper(v_currency),
    v_session.cashier_user_id, trim(p_idempotency_key)
  ) returning * into v_order;

  insert into public.order_items (
    order_id, product_id, store_id, quantity, subtotal, price,
    product_name_snapshot, vat_rate, vat_rate_snapshot, unit_price_incl_vat,
    discount_amount, net_amount, vat_amount, gross_amount,
    accounting_group_id_snapshot, accounting_group_name_snapshot,
    accounting_code_snapshot, tax_profile_name_snapshot, order_type_snapshot
  ) values (
    v_order.id, v_system_product_id, v_device.store_id, 1, v_gross, v_gross,
    'Manual Sale', v_rate.rate, v_rate.rate, v_gross,
    0, v_net, v_vat, v_gross, v_group.id, v_group.name,
    v_group.accounting_code, v_profile.name, p_order_type
  ) returning * into v_item;

  insert into public.payments (
    store_id, order_id, method, status, amount, provider
  ) values (
    v_device.store_id, v_order.id, 'card', 'pending', v_gross, 'stripe'
  );

  insert into public.payment_requests (
    restaurant_id, location_id, order_id, payment_config_id, provider_type,
    idempotency_key, amount_cents, process_attempt_count
  ) values (
    v_location.restaurant_id, v_location.id, v_order.id, v_config.id,
    'stripe_server_driven', 'manual-card:' || trim(p_idempotency_key), p_amount_cents, 0
  ) returning * into v_request;

  return jsonb_build_object(
    'is_duplicate', false,
    'status', v_order.status,
    'amount_cents', p_amount_cents,
    'currency', v_order.currency,
    'order', to_jsonb(v_order),
    'order_item', to_jsonb(v_item),
    'payment_request', to_jsonb(v_request)
  );
end;
$$;

revoke all on function public.create_manual_card_sale(bigint, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_manual_card_sale(bigint, text, uuid, uuid, text, text) to service_role;

revoke all on function public.create_manual_card_sale(bigint, text, uuid, uuid, uuid, text, text) from public;
grant execute on function public.create_manual_card_sale(bigint, text, uuid, uuid, uuid, text, text) to anon, authenticated, service_role;
