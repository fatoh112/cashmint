import { describe, expect, it } from 'vitest';
import { accountingTotalsReconcile, calculateOrderAccounting, resolveProductVat } from './taxCalculator';

const line = (price, vatRate, quantity = 1, extras = {}) => ({
  product: { id: extras.id || crypto.randomUUID(), name: extras.name || 'Item', price, vat_rate: vatRate, category_name: 'Food' },
  quantity,
  selectedModifiers: extras.modifiers || [],
});

describe('calculateOrderAccounting', () => {
  it('calculates a zero-VAT item', () => {
    const result = calculateOrderAccounting([line(10, 0)]);
    expect(result.totals).toMatchObject({ net: 10, vat: 0, gross: 10, discount: 0 });
  });

  it('calculates a single VAT rate from VAT-inclusive price', () => {
    const result = calculateOrderAccounting([line(11.2, 12)]);
    expect(result.totals).toMatchObject({ net: 10, vat: 1.2, gross: 11.2 });
  });

  it('handles multiple VAT rates without averaging tax', () => {
    const result = calculateOrderAccounting([line(11.2, 12), line(21, 5)]);
    expect(result.lines.map((item) => item.vatAmount)).toEqual([1.2, 1]);
    expect(result.totals).toMatchObject({ net: 30, vat: 2.2, gross: 32.2 });
  });

  it('allocates a fixed order discount proportionally and exactly', () => {
    const result = calculateOrderAccounting([line(10, 0), line(20, 0)], 3);
    expect(result.lines.map((item) => item.discountAmount)).toEqual([1, 2]);
    expect(result.totals).toMatchObject({ gross: 27, discount: 3 });
  });

  it('caps a fixed discount at the order gross total', () => {
    const result = calculateOrderAccounting([line(4, 0)], 9);
    expect(result.totals).toMatchObject({ gross: 0, discount: 4 });
  });

  it('keeps quantity in the calculation', () => {
    const result = calculateOrderAccounting([line(5.6, 12, 3)]);
    expect(result.totals).toMatchObject({ net: 15, vat: 1.8, gross: 16.8 });
  });

  it('includes modifier prices in the VAT-inclusive unit price', () => {
    const result = calculateOrderAccounting([line(10, 0, 1, { modifiers: [{ price_adjustment: 2.5 }] })]);
    expect(result.lines[0].unitPriceInclVat).toBe(12.5);
    expect(result.totals.gross).toBe(12.5);
  });

  it('allocates sub-cent precision without losing the total discount', () => {
    const result = calculateOrderAccounting([line(0.01, 0), line(0.01, 0), line(0.01, 0)], 0.02);
    expect(result.totals).toMatchObject({ gross: 0.01, discount: 0.02 });
  });

  it('returns reconciled totals for a mixed order with discount', () => {
    const result = calculateOrderAccounting([line(11.2, 12), line(21, 5), line(8, 0)], 2.75);
    expect(accountingTotalsReconcile(result.totals)).toBe(true);
  });

  it('does not create negative values from malformed prices', () => {
    const result = calculateOrderAccounting([line(-5, 12), line('not-a-number', 12)]);
    expect(result.totals).toMatchObject({ net: 0, vat: 0, gross: 0 });
  });
});

const group = (dineIn, takeaway, extras = {}) => ({
  id: extras.id || crypto.randomUUID(),
  tax_profiles: {
    dine_in_tax_rate: { rate: dineIn },
    takeaway_tax_rate: { rate: takeaway },
  },
});

describe('resolveProductVat', () => {
  it('uses product accounting group for dine-in', () => {
    expect(resolveProductVat({ name: 'Food', accounting_group_id: 'group', accounting_group: group(12, 6) }, 'dine_in')).toBe(12);
  });

  it('uses product accounting group for takeaway', () => {
    expect(resolveProductVat({ name: 'Food', accounting_group_id: 'group', accounting_group: group(12, 6) }, 'takeaway')).toBe(6);
  });

  it('uses manual product override before the regular product group', () => {
    expect(resolveProductVat({
      accounting_group_id: 'manual',
      accounting_group_override: group(21, 21),
      accounting_group: group(12, 6),
    }, 'takeaway')).toBe(21);
  });

  it('uses category default accounting group when the product has no group', () => {
    expect(resolveProductVat({
      category: { default_accounting_group: group(12, 6) },
    }, 'dine_in')).toBe(12);
  });

  it('uses legacy vat_rate only for products without an accounting group', () => {
    expect(resolveProductVat({ vat_rate: 9 }, 'takeaway')).toBe(9);
  });

  it('returns a clear validation error when no tax configuration exists', () => {
    expect(() => resolveProductVat({ name: 'Untaxed' }, 'takeaway')).toThrow('Missing VAT configuration for Untaxed');
  });

  it('rejects unsupported order types instead of reintroducing delivery', () => {
    expect(() => resolveProductVat({ vat_rate: 6 }, 'delivery')).toThrow('Unsupported order type');
  });
});
