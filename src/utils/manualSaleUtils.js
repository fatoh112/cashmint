export const MANUAL_SALE_LABEL = 'Manual Sale';
export const MANUAL_SALE_LABEL_AR = 'بيع يدوي';

export function parseManualSaleAmountToCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;

  const [wholePart, fractionPart = ''] = text.split('.');
  const cents = Number(wholePart) * 100 + Number((fractionPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}
export function formatManualSaleAmount(cents, currency = 'EUR') {
  if (!Number.isSafeInteger(cents) || cents <= 0) return '';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}
