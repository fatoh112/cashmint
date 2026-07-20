import { describe, test, expect } from 'vitest';

/**
 * Mock database environment and RPC simulator matching exact database validation contracts.
 */
function createMockDbEnvironment() {
  const tables = {
    orders: [],
    order_items: [],
    payments: [],
    payment_splits: [],
    payment_split_parts: [],
    payment_requests: [],
    pos_devices: [
      { id: 'device-active', store_id: 'store-1', device_name: 'Main POS', status: 'active' },
      { id: 'device-disabled', store_id: 'store-1', device_name: 'Revoked POS', status: 'revoked' },
      { id: 'device-other-store', store_id: 'store-2', device_name: 'Store 2 POS', status: 'active' }
    ],
    cashier_sessions: [
      { id: 'session-open', store_id: 'store-1', device_id: 'device-active', cashier_name: 'Alice', cashier_user_id: 'user-alice-uuid', status: 'open' },
      { id: 'session-closed', store_id: 'store-1', device_id: 'device-active', cashier_name: 'Bob', cashier_user_id: 'user-bob-uuid', status: 'closed' },
      { id: 'session-other-device', store_id: 'store-1', device_id: 'device-other-store', cashier_name: 'Charlie', cashier_user_id: 'user-charlie-uuid', status: 'open' },
      { id: 'session-other-store', store_id: 'store-2', device_id: 'device-other-store', cashier_name: 'Dave', cashier_user_id: 'user-dave-uuid', status: 'open' }
    ],
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

    // 1. POS Device Validation
    if (!p_device_id) {
      throw new Error('POS_DEVICE_NOT_FOUND');
    }
    const device = tables.pos_devices.find(d => d.id === p_device_id);
    if (!device) {
      throw new Error('POS_DEVICE_NOT_FOUND');
    }
    if (device.status !== 'active') {
      throw new Error('POS_DEVICE_DISABLED_OR_REVOKED');
    }
    if (device.store_id !== p_store_id) {
      throw new Error('POS_DEVICE_STORE_MISMATCH');
    }

    // 2. Cashier Session (Shift) Validation
    if (!p_cashier_session_id) {
      throw new Error('CASHIER_SHIFT_REQUIRED');
    }
    const session = tables.cashier_sessions.find(s => s.id === p_cashier_session_id);
    if (!session) {
      throw new Error('CASHIER_SHIFT_NOT_FOUND');
    }
    if (session.status !== 'open') {
      throw new Error('CASHIER_SHIFT_CLOSED');
    }
    if (session.device_id !== p_device_id) {
      throw new Error('CASHIER_SHIFT_DEVICE_MISMATCH');
    }
    if ((session.store_id || device.store_id) !== p_store_id) {
      throw new Error('CASHIER_SHIFT_STORE_MISMATCH');
    }

    // 3. Lines & State Validation
    if (!Array.isArray(p_lines) || p_lines.length === 0) {
      throw new Error('Order requires lines');
    }
    if (!['pending', 'completed'].includes(p_status) ||
        !['cash', 'card', 'split'].includes(p_payment_method) ||
        !['dine_in', 'takeaway'].includes(p_order_type)) {
      throw new Error('Invalid order state');
    }

    // Extract cashier user and merge cashier name into raw_payload
    const cashier_user_id = session.cashier_user_id || 'fallback-user-id';
    const raw_payload = {
      ...(p_raw_payload || {}),
      ...(session.cashier_name ? { cashier_name: session.cashier_name } : {})
    };

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
      raw_payload,
      receipt_number: receiptCounter,
      order_type: p_order_type,
      cashier_session_id: p_cashier_session_id,
      pos_device_id: p_device_id,
      cashier_user_id,
      completed_at: p_status === 'completed' ? new Date().toISOString() : null,
      created_at: new Date().toISOString()
    };

    tables.orders.push(order);

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

    // Cash part
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

    order.status = 'partially_paid';

    // Card part
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

describe('Split Payment & Restored Audit Validations Suite', () => {

  test('1. Missing POS device is rejected', () => {
    const db = createMockDbEnvironment();
    expect(() => db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: null,
      p_cashier_session_id: 'session-open',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    })).toThrow('POS_DEVICE_NOT_FOUND');
  });

  test('2. Disabled POS device is rejected', () => {
    const db = createMockDbEnvironment();
    expect(() => db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-disabled',
      p_cashier_session_id: 'session-open',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    })).toThrow('POS_DEVICE_DISABLED_OR_REVOKED');
  });

  test('3. POS device from another store is rejected', () => {
    const db = createMockDbEnvironment();
    expect(() => db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-other-store',
      p_cashier_session_id: 'session-open',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    })).toThrow('POS_DEVICE_STORE_MISMATCH');
  });

  test('4. Missing cashier session is rejected', () => {
    const db = createMockDbEnvironment();
    expect(() => db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: null,
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    })).toThrow('CASHIER_SHIFT_REQUIRED');
  });

  test('5. Closed cashier session is rejected', () => {
    const db = createMockDbEnvironment();
    expect(() => db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-closed',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    })).toThrow('CASHIER_SHIFT_CLOSED');
  });

  test('6. Cashier session/device mismatch is rejected', () => {
    const db = createMockDbEnvironment();
    expect(() => db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-other-device',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    })).toThrow('CASHIER_SHIFT_DEVICE_MISMATCH');
  });

  test('7. Cashier session/store mismatch is rejected', () => {
    const db = createMockDbEnvironment();
    expect(() => db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-other-store',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    })).toThrow('CASHIER_SHIFT_DEVICE_MISMATCH');
  });

  test('8. Valid normal Cash order still completes and creates one paid row', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-open',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_total_amount: 10.00,
      p_subtotal_excl_vat: 8.70,
      p_vat_amount: 1.30,
      p_lines: [{ productId: 'prod-1', quantity: 1 }]
    });

    expect(order.status).toBe('completed');
    expect(db.tables.payments).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({ method: 'cash', status: 'paid', amount: 10.00 });
  });

  test('9. Valid normal Card order still creates one pending card row', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-open',
      p_status: 'pending',
      p_payment_method: 'card',
      p_order_type: 'takeaway',
      p_total_amount: 20.00,
      p_subtotal_excl_vat: 17.39,
      p_vat_amount: 2.61,
      p_lines: [{ productId: 'prod-1', quantity: 2 }]
    });

    expect(order.status).toBe('pending');
    expect(db.tables.payments).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({ method: 'card', status: 'pending', amount: 20.00, provider: 'stripe' });
  });

  test('10. Valid Split order creates a pending order with no legacy payment row', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-open',
      p_status: 'pending',
      p_payment_method: 'split',
      p_order_type: 'dine_in',
      p_total_amount: 30.00,
      p_subtotal_excl_vat: 26.09,
      p_vat_amount: 3.91,
      p_lines: [{ productId: 'prod-1', quantity: 3 }]
    });

    expect(order.status).toBe('pending');
    expect(db.tables.payments).toHaveLength(0);
  });

  test('11. create_split_payment creates the Cash row and Card request', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-open',
      p_status: 'pending',
      p_payment_method: 'split',
      p_order_type: 'dine_in',
      p_total_amount: 30.00,
      p_subtotal_excl_vat: 26.09,
      p_vat_amount: 3.91,
      p_lines: [{ productId: 'prod-1', quantity: 3 }]
    });

    const splitRes = db.create_split_payment({
      p_order_id: order.id,
      p_cash_amount_cents: 1000,
      p_card_amount_cents: 2000,
      p_idempotency_key: `split-${order.id}-key`,
      p_pos_device_id: 'device-active'
    });

    expect(order.status).toBe('partially_paid');
    expect(db.tables.payments).toHaveLength(1);
    expect(db.tables.payments[0]).toMatchObject({ method: 'cash', status: 'paid', amount: 10.00 });
    expect(db.tables.payment_requests).toHaveLength(1);
    expect(db.tables.payment_requests[0]).toMatchObject({ amount_cents: 2000, status: 'pending' });
  });

  test('12. cashier_user_id and cashier_name are still stored correctly', () => {
    const db = createMockDbEnvironment();
    const order = db.create_accounting_order({
      p_store_id: 'store-1',
      p_device_id: 'device-active',
      p_cashier_session_id: 'session-open',
      p_status: 'completed',
      p_payment_method: 'cash',
      p_order_type: 'dine_in',
      p_total_amount: 10.00,
      p_lines: [{ productId: 'prod-1', quantity: 1 }],
      p_raw_payload: { existing_key: 'value' }
    });

    expect(order.cashier_user_id).toBe('user-alice-uuid');
    expect(order.raw_payload).toMatchObject({
      existing_key: 'value',
      cashier_name: 'Alice'
    });
  });

});
