import { describe, expect, it } from 'vitest';
import { buildProductPayload, canSubmitProductForm, effectiveAccountingGroupId } from './productTaxForm';

const baseForm = {
  name: 'Fries',
  price: '4.50',
  category_id: 'cat-food',
  accounting_group_id: 'food',
};

describe('productTaxForm', () => {
  it('creates product payload with explicit accounting group and null legacy VAT', () => {
    expect(buildProductPayload(baseForm, { default_accounting_group_id: 'drinks' })).toMatchObject({
      name: 'Fries',
      price: 4.5,
      category_id: 'cat-food',
      accounting_group_id: 'food',
      accounting_group_is_override: false,
      vat_rate: null,
    });
  });

  it('does not inherit category default accounting group', () => {
    expect(effectiveAccountingGroupId({ ...baseForm, accounting_group_id: 'food' }, { default_accounting_group_id: 'drinks' })).toBe('food');
    expect(effectiveAccountingGroupId({ ...baseForm, accounting_group_id: '' }, { default_accounting_group_id: 'drinks' })).toBe('');
  });

  it('blocks submission when category_id or accounting_group_id is missing', () => {
    expect(canSubmitProductForm({ ...baseForm, category_id: '' }, false)).toBe(false);
    expect(canSubmitProductForm({ ...baseForm, accounting_group_id: '' }, false)).toBe(false);
    expect(canSubmitProductForm(baseForm, false)).toBe(true);
  });

  it('prevents duplicate submissions while a save is running', () => {
    expect(canSubmitProductForm(baseForm, true)).toBe(false);
  });
});
