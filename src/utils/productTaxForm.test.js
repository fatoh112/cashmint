import { describe, expect, it } from 'vitest';
import { buildProductPayload, canSubmitProductForm, effectiveAccountingGroupId } from './productTaxForm';

const baseForm = {
  name: 'Fries',
  price: '4.50',
  category_id: 'cat-food',
  accounting_group_id: 'food',
};

describe('productTaxForm', () => {
  it('creates product payload with accounting group and null legacy VAT', () => {
    expect(buildProductPayload(baseForm, { default_accounting_group_id: 'food' })).toMatchObject({
      name: 'Fries',
      price: 4.5,
      accounting_group_id: 'food',
      accounting_group_is_override: false,
      vat_rate: null,
    });
  });

  it('updates product accounting group as a manual override', () => {
    expect(buildProductPayload({ ...baseForm, accounting_group_id: 'drinks' }, { default_accounting_group_id: 'food' })).toMatchObject({
      accounting_group_id: 'drinks',
      accounting_group_is_override: true,
      vat_rate: null,
    });
  });

  it('inherits category default accounting group', () => {
    expect(effectiveAccountingGroupId({ ...baseForm, accounting_group_id: '' }, { default_accounting_group_id: 'food' })).toBe('food');
  });

  it('prevents duplicate submissions while a save is running', () => {
    expect(canSubmitProductForm(baseForm, true)).toBe(false);
  });

  it('keeps failed saves as one blocked submission until saving is cleared', () => {
    expect(canSubmitProductForm(baseForm, true)).toBe(false);
    expect(canSubmitProductForm(baseForm, false)).toBe(true);
  });
});
