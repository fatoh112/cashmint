const SCALE = 10000;

const round4 = (value) => Math.round((Number(value) + Number.EPSILON) * SCALE) / SCALE;
const safeNumber = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export function calculateOrderAccounting(cart = [], orderDiscount = 0) {
  const sourceLines = cart.map((item) => {
    const modifiers = Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [];
    const unitPriceInclVat = safeNumber(item.product?.price) + modifiers.reduce((sum, modifier) => sum + safeNumber(modifier.price_adjustment), 0);
    const quantity = Math.max(0, Math.trunc(safeNumber(item.quantity)));
    return {
      productId: item.product?.id || null,
      productName: item.product?.name || 'Unknown product',
      categoryName: item.product?.category_name || item.product?.category?.name || '',
      modifierIds: modifiers.map((modifier) => modifier.id).filter(Boolean),
      quantity,
      unitPriceInclVat: round4(unitPriceInclVat),
      vatRate: safeNumber(item.product?.resolved_vat_rate ?? item.product?.vat_rate),
      grossBeforeDiscount: round4(unitPriceInclVat * quantity),
    };
  });

  const grossUnits = sourceLines.map((line) => Math.round(line.grossBeforeDiscount * SCALE));
  const originalGrossUnits = grossUnits.reduce((sum, value) => sum + value, 0);
  const discountUnits = Math.min(Math.round(safeNumber(orderDiscount) * SCALE), originalGrossUnits);
  let allocatedUnits = 0;

  const lines = sourceLines.map((line, index) => {
    const isFinalLine = index === sourceLines.length - 1;
    const lineDiscountUnits = isFinalLine
      ? Math.min(grossUnits[index], Math.max(0, discountUnits - allocatedUnits))
      : Math.min(grossUnits[index], originalGrossUnits > 0 ? Math.floor((discountUnits * grossUnits[index]) / originalGrossUnits) : 0);
    const discountAmount = lineDiscountUnits / SCALE;
    allocatedUnits += lineDiscountUnits;
    const grossAmount = round4(Math.max(0, line.grossBeforeDiscount - discountAmount));
    const divisor = 1 + (line.vatRate / 100);
    const netAmount = round4(divisor > 0 ? grossAmount / divisor : grossAmount);
    const vatAmount = round4(Math.max(0, grossAmount - netAmount));
    return { ...line, discountAmount, netAmount, vatAmount, grossAmount };
  });

  const totals = lines.reduce((sum, line) => ({
    net: round4(sum.net + line.netAmount),
    vat: round4(sum.vat + line.vatAmount),
    gross: round4(sum.gross + line.grossAmount),
    discount: round4(sum.discount + line.discountAmount),
  }), { net: 0, vat: 0, gross: 0, discount: 0 });

  return { lines, totals: { ...totals, discount: discountUnits / SCALE } };
}

export const ACCOUNTING_TOLERANCE = 0.0001;
export const accountingTotalsReconcile = ({ net, vat, gross }) => Math.abs(round4(net + vat) - round4(gross)) <= ACCOUNTING_TOLERANCE;
