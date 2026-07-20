import { describe, test, expect } from 'vitest';
import {
  toCents,
  fromCents,
  validateSplitAmounts,
  calculateFiftyFiftySplit
} from './splitPaymentUtils';

describe('splitPaymentUtils', () => {
  test('converts amounts to integer cents accurately', () => {
    expect(toCents(30.00)).toBe(3000);
    expect(toCents('10.00')).toBe(1000);
    expect(toCents(20.00)).toBe(2000);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30); // avoids floating point 0.30000000000000004 bug
  });

  test('converts cents to 2-decimal display string', () => {
    expect(fromCents(3000)).toBe('30.00');
    expect(fromCents(1000)).toBe('10.00');
    expect(fromCents(2000)).toBe('20.00');
    expect(fromCents(5)).toBe('0.05');
  });

  test('validates €30 split into €10 cash and €20 card', () => {
    const res = validateSplitAmounts(30.00, 10.00, 20.00);
    expect(res.valid).toBe(true);
    expect(res.totalCents).toBe(3000);
    expect(res.cashCents).toBe(1000);
    expect(res.cardCents).toBe(2000);
    expect(res.remainingCents).toBe(0);
    expect(res.error).toBeNull();
  });

  test('validates 50/50 split calculation', () => {
    const splitEven = calculateFiftyFiftySplit(30.00);
    expect(splitEven.cashCents).toBe(1500);
    expect(splitEven.cardCents).toBe(1500);
    expect(splitEven.cashAmount).toBe('15.00');
    expect(splitEven.cardAmount).toBe('15.00');

    const splitOdd = calculateFiftyFiftySplit(30.01);
    expect(splitOdd.cashCents + splitOdd.cardCents).toBe(3001);
  });

  test('rejects zero cash amount', () => {
    const res = validateSplitAmounts(30.00, 0, 30.00);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Cash amount must be greater than zero');
  });

  test('rejects zero card amount', () => {
    const res = validateSplitAmounts(30.00, 30.00, 0);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Card amount must be greater than zero');
  });

  test('rejects negative cash or card amount', () => {
    const res = validateSplitAmounts(30.00, -5.00, 35.00);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Cash amount must be greater than zero');
  });

  test('rejects overpayment', () => {
    const res = validateSplitAmounts(30.00, 20.00, 20.00);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Exceeds order total');
  });

  test('rejects underpayment', () => {
    const res = validateSplitAmounts(30.00, 10.00, 15.00);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Remaining amount');
  });
});
