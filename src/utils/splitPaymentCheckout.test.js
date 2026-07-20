import { describe, test, expect, vi } from 'vitest';

/**
 * Mock database environment and RPC simulator to verify exact checkout contract behaviors.
 */
function createMockDbEnvironment() {
  const tables = {
    orders: [],
    order_items: [],
    payments: [],
    payment_splits: [],
    payment_split_parts: [],
    payment_requests: [],
    pos_devices: [{ id: 'device-1', store_id: 'store-1', status: 'active' }],
    stores: [{ id: 'store-1', split_payment_enabled: true }],
    restaurant_payment_configs: [
      { id: 'cfg-1', location_id: 'store-1', provider_type: 'stripe_android_bridge', is_enabled: true }
    ],
    products: [
      { id: 'prod-1', store_id: 'store-1', name: 'Burger', price: 10.00 }
    ]
  };

  let receiptCounter = 1000;

  function create_accounting_order(params) {
    const {
      p_store_id,
      p_device_id,
      p_cashier_session_id,
      p_status,
      p_payment_method,
      p_order_type,
      p_currency,
      p_discount_amount,
      p_subtotal_excl_vat,
      p_vat_amount,
      p_total_amount,
      p_raw_payload,
      p_lines
    } = params;

    // Validate inputs per RPC contract
    if (!['pending', 'completed'].includes(p_status) ||
        !['cash', 'card', 'split'].includes(p_payment_method) ||
        !['dine_in', 'takeaway'].includes(p_order_type)) {
      throw new Error('P0001: Invalid order state');
    }

    if (!Array.isArray(p_lines) || p_lines.length === 0) {
      throw new Error('Order requires lines');
    }

    receiptCounter += 1;
    const orderId = `order-${tables.orders.length + 1}`;
    const order = {
      id: orderId,
      store_id: p_store_id,
      status: p_status,
      total_amount: p_total_amount,
      subtotal_excl_vat: p_subtotal_excl_vat,
      vat_amount: p_vat_amount,
      discount_amount: p_discount_amount || 0,
      currency: p_currency || 'EUR',
      raw_payload: p_raw_payload,
      receipt_number: receiptCounter,
      order_type: p_order_type,
      cashier_session_id: p_cashier_session_id,
      pos_device_id: p_device_id,
      completed_at: p_status === 'completed' ? new Date().toISOString() : null,
      created_at: new Date().toISOString()
    };

    tables.orders.push(order);

    // Create order items
    p_lines.forEach(line => {
      tables.order_items.push({
        id: `item-${tables.order_items.length + 1}`,
        order_id: orderId,
        product_id: line.productId,
        store_id: p_store_id,
        quantity: line.quantity || 1,
        gross_amount: p_total_amount,
        vat_amount: p_vat_amount,
        net_amount: p_subtotal_excl_vat
      });
    });

    // DO NOT insert into payments table if method is 'split'
    if (p_payment_method !== 'split') {
      tables.payments.push({
        id: `pay-${tables.payments.length + 1}`,
        store_id: p_store_id,
        order_id: orderId,
        method: p_payment_method,
        status: p_status === 'completed' ? 'paid' : 'pending',
        amount: p_total_amount,
        provider: p_payment_method === 'card' ? 'stripe' : null,
        paid_at: p_status === 'completed' ? new Date().toISOString() : null
      });
    }

    return order;
  }

  function create_split_payment(params) {
    const {
      p_order_id,
      p_cash_amount_cents,
      p_card_amount_cents,
      p_idempotency_key,
      p_pos_device_id
    } = params;

    const order = tables.orders.find(o => o.id === p_order_id);
    if (!order) throw new Error('Order not found');
    if (!['new', 'pending', 'partially_paid'].includes(order.status)) {
      throw new Error('Order is not in an unpaid state');
    }

    const totalCents = Math.round(order.total_amount * 100);
    if (p_cash_amount_cents + p_card_amount_cents !== totalCents) {
      throw new Error('Cash and card amounts do not equal order total exactly');
    }

    const splitId = `split-${tables.payment_splits.length + 1}`;
    const split = {
      id: splitId,
      order_id: p_order_id,
      total_amount_cents: totalCents,
      status: 'awaiting_card',
      idempotency_key: p_idempotency_key
    };
    tables.payment_splits.push(split);

    // Cash part - Succeeded
    const cashPartId = `part-${tables.payment_split_parts.length + 1}`;
    const cashPart = {
      id: cashPartId,
      split_id: splitId,
      order_id: p_order_id,
      method: 'cash',
      amount_cents: p_cash_amount_cents,
      status: 'succeeded'
    };
    tables.payment_split_parts.push(cashPart);

    // Record cash payment row in payments
    const cashPayId = `pay-${tables.payments.length + 1}`;
    tables.payments.push({
      id: cashPayId,
      store_id: order.store_id,
      order_id: p_order_id,
      method: 'cash',
      status: 'paid',
      amount: p_cash_amount_cents / 100.0,
      paid_at: new Date().toISOString()
    });
    cashPart.payment_id = cashPayId;

    // Transition order status to partially_paid
    order.status = 'partially_paid';

    // Card part - Pending
    const cardPartId = `part-${tables.payment_split_parts.length + 1}`;
    const cardPart = {
      id: cardPartId,
      split_id: splitId,
      order_id: p_order_id,
      method: 'card',
      amount_cents: p_card_amount_cents,
      status: 'pending'
    };
    tables.payment_split_parts.push(cardPart);

    // Card payment request created ONLY for card_amount_cents
    const reqId = `req-${tables.payment_requests.length + 1}`;
    const req = {
      id: reqId,
      order_id: p_order_id,
      amount_cents: p_card_amount_cents,
      status: 'pending',
      split_part_id: cardPartId
    };
    tables.payment_requests.push(req);
    cardPart.payment_request_id = reqId;

    return {
      split_id: splitId,
      card_payment_request_id: reqId,
      cash_part_id: cashPartId,
      card_part_id: cardPartId,
      status: 'awaiting_card',
      cash_amount_cents: p_cash_amount_cents,
      card_amount_cents: p_card_amount_cents
    };
  }

  return {
    tables,
    create_accounting_order,
    create_split_payment
  };
}

describe('Split Payment & Checkout RPC Logic', () => {

  test('normal Cash order works: status completed, creates cash paid payment row', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-1',
      p_cashier_session_id: 'sess-1',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_currency: 'EUR',
      p_discount_amount: 0,
      p_subtotal_excl_vat: 8.70,
      p_vat_amount: 1.30,
      p_total_amount: 10.00,
      p_raw_payload: {},
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    });

    expect(order.status).toBe('completed');
    expect(db.tables.orders).toHaveLength(1);
    expect(db.tables.payments).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({
      order_id: order.id,
      method: 'cash',
      status: 'paid',
      amount: 10.00
    });
  });

  test('normal Card order works: status pending, creates card pending payment row', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-1',
      p_cashier_session_id: 'sess-1',
      p_status: 'pending',
      p_payment_method: 'card',
      p_order_type: 'takeaway',
      p_currency: 'EUR',
      p_discount_amount: 0,
      p_subtotal_excl_vat: 17.39,
      p_vat_amount: 2.61,
      p_total_amount: 20.00,
      p_raw_payload: {},
      p_lines: [{ productId: 'prod-1', quantity: 2 }]
    });

    expect(order.status).toBe('pending');
    expect(db.tables.orders).toHaveLength(1);
    expect(db.tables.payments).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({
      order_id: order.id,
      method: 'card',
      status: 'pending',
      amount: 20.00,
      provider: 'stripe'
    });
  });

  test('Split order creation does NOT insert a fake split payment row', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-1',
      p_cashier_session_id: 'sess-1',
      p_status: 'pending',
      p_payment_method: 'split',
      p_order_type: 'dine_in',
      p_currency: 'EUR',
      p_discount_amount: 0,
      p_subtotal_excl_vat: 26.09,
      p_vat_amount: 3.91,
      p_total_amount: 30.00,
      p_raw_payload: {},
      p_lines: [{ productId: 'prod-1', quantity: 3 }]
    });

    expect(order.status).toBe('pending');
    expect(db.tables.orders).toHaveLength(1);
    // Crucial check: create_accounting_order with method='split' must NOT insert into payments
    expect(db.tables.payments).toHaveLength(0);
  });

  test('create_split_payment inserts only Cash row initially, order becomes partially_paid, and card request is card amount only', () => {
    const db = createMockDbEnvironment();
    // Step 1: Base order creation with method = 'split', status = 'pending'
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-1',
      p_cashier_session_id: 'sess-1',
      p_status: 'pending',
      p_payment_method: 'split',
      p_order_type: 'dine_in',
      p_currency: 'EUR',
      p_discount_amount: 0,
      p_subtotal_excl_vat: 26.09,
      p_vat_amount: 3.91,
      p_total_amount: 30.00,
      p_raw_payload: {},
      p_lines: [{ productId: 'prod-1', quantity: 3 }]
    });

    expect(order.status).toBe('pending');
    expect(db.tables.payments).toHaveLength(0);

    // Step 2: Immediate create_split_payment (€10 cash, €20 card)
    const splitRes = db.create_split_payment({
      p_order_id: order.id,
      p_cash_amount_cents: 1000,
      p_card_amount_cents: 2000,
      p_idempotency_key: `split-${order.id}-1`,
      p_pos_device_id: 'device-1'
    });

    // Verify order transitions to partially_paid ONLY after create_split_payment
    expect(order.status).toBe('partially_paid');

    // Verify payment rows: contains ONLY cash row (€10) so far, no fake split row
    expect(db.tables.payments).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({
      order_id: order.id,
      method: 'cash',
      status: 'paid',
      amount: 10.00
    });

    // Verify split parts: 1 cash succeeded, 1 card pending
    expect(db.tables.payment_split_parts).toHaveLength(2);
    expect(db.tables.payment_split_parts[0]).toMatchObject({ method: 'cash', amount_cents: 1000, status: 'succeeded' });
    expect(db.tables.payment_split_parts[1]).toMatchObject({ method: 'card', amount_cents: 2000, status: 'pending' });

    // Verify card request amount: ONLY card portion (2000 cents = €20), not total (€30)
    expect(db.tables.payment_requests).toHaveLength(1);
    expect(db.tables.payment_requests[0]).toMatchObject({
      order_id: order.id,
      amount_cents: 2000,
      status: 'pending'
    });
  });

});
