import { describe, expect, test } from 'vitest';
import { formatManualSaleAmount, MANUAL_SALE_LABEL_AR, parseManualSaleAmountToCents } from './manualSaleUtils';

describe('manual sale amount validation', () => {
  test.each([
    ['1', 100],
    ['12.5', 1250],
    ['12.50', 1250],
    ['000.01', 1],
  ])('converts %s to integer cents', (input, expected) => {
    expect(parseManualSaleAmountToCents(input)).toBe(expected);
  });

  test.each(['', '0', '0.00', '-1', '1.', '1.234', '1,25', 'abc', 'NaN', 'Infinity'])('rejects malformed amount %s', (input) => {
    expect(parseManualSaleAmountToCents(input)).toBeNull();
  });

  test('formats a positive amount for the configured currency', () => {
    expect(formatManualSaleAmount(1250, 'EUR')).toMatch(/12[,.]50/);
  });

  test('uses the exact Arabic Manual Sale label', () => {
    expect(MANUAL_SALE_LABEL_AR).toBe('بيع يدوي');
  });
});
