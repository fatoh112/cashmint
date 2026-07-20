/**
 * Split Payment Utilities
 * All financial equality and split validations use integer minor units (cents).
 */

/**
 * Safely converts a monetary value (e.g., 30.00, "30.00", 30) to integer cents.
 */
export function toCents(amount) {
  if (amount === null || amount === undefined || amount === '') return 0;
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(',', '.'));
  if (isNaN(num) || !isFinite(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Converts integer cents to a fixed 2-decimal display string (e.g., 3000 -> "30.00").
 */
export function fromCents(cents) {
  const safeCents = Number.isSafeInteger(cents) ? cents : Math.round(Number(cents) || 0);
  return (safeCents / 100).toFixed(2);
}

/**
 * Validates split amounts using integer minor units.
 */
export function validateSplitAmounts(totalAmount, cashAmount, cardAmount, isArabic = false) {
  const totalCents = toCents(totalAmount);
  const cashCents = toCents(cashAmount);
  const cardCents = toCents(cardAmount);

  if (totalCents <= 0) {
    return {
      valid: false,
      totalCents, cashCents, cardCents, remainingCents: totalCents,
      error: isArabic ? 'إجمالي الطلب يجب أن يكون أكبر من صفر' : 'Total order amount must be greater than zero'
    };
  }

  if (cashCents <= 0) {
    return {
      valid: false,
      totalCents, cashCents, cardCents, remainingCents: totalCents - (cashCents + cardCents),
      error: isArabic ? 'المبلغ النقدي يجب أن يكون أكبر من صفر' : 'Cash amount must be greater than zero'
    };
  }

  if (cardCents <= 0) {
    return {
      valid: false,
      totalCents, cashCents, cardCents, remainingCents: totalCents - (cashCents + cardCents),
      error: isArabic ? 'مبلغ البطاقة يجب أن يكون أكبر من صفر' : 'Card amount must be greater than zero'
    };
  }

  const sumCents = cashCents + cardCents;
  const remainingCents = totalCents - sumCents;

  if (sumCents !== totalCents) {
    return {
      valid: false,
      totalCents, cashCents, cardCents, remainingCents,
      error: remainingCents > 0
        ? (isArabic ? `المبلغ المتبقي: ${fromCents(remainingCents)} €` : `Remaining amount: €${fromCents(remainingCents)}`)
        : (isArabic ? `المجموع يتجاوز إجمالي الطلب بـ ${fromCents(-remainingCents)} €` : `Exceeds order total by €${fromCents(-remainingCents)}`)
    };
  }

  return {
    valid: true,
    totalCents, cashCents, cardCents, remainingCents: 0,
    error: null
  };
}

/**
 * Calculates quick 50 / 50 split in integer cents.
 * Handles odd cents safely (cash takes floor or ceiling, total is exact).
 */
export function calculateFiftyFiftySplit(totalAmount) {
  const totalCents = toCents(totalAmount);
  const cashCents = Math.floor(totalCents / 2);
  const cardCents = totalCents - cashCents;
  return {
    cashCents,
    cardCents,
    cashAmount: fromCents(cashCents),
    cardAmount: fromCents(cardCents)
  };
}
