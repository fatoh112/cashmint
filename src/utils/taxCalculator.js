const SCALE = 10000;
const SUPPORTED_ORDER_TYPES = new Set(['dine_in', 'takeaway']);

const round4 = (value) => Math.round((Number(value) + Number.EPSILON) * SCALE) / SCALE;
const safeNumber = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
const hasNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const rateFromGroup = (group, orderType) => {
  if (!group) return null;
  const profile = group.tax_profiles || group.tax_profile || group.profile || group;
  const rateObject = orderType === 'dine_in'
    ? profile.dine_in_tax_rate || profile.dine_in_rate
    : profile.takeaway_tax_rate || profile.takeaway_rate;
  const directRate = orderType === 'dine_in'
    ? profile.dine_in_vat_rate ?? profile.dine_in_rate_value
    : profile.takeaway_vat_rate ?? profile.takeaway_rate_value;

  if (hasNumber(rateObject?.rate)) return Number(rateObject.rate);
  if (hasNumber(directRate)) return Number(directRate);
  return null;
};

export function resolveProductVat(product = {}, orderType = 'takeaway') {
  if (!SUPPORTED_ORDER_TYPES.has(orderType)) {
    throw new Error(`Unsupported order type for VAT resolution: ${orderType}`);
  }

  const manualGroup = product.manual_accounting_group || product.accounting_group_override || product.accountingGroupOverride;
  const productGroup = product.accounting_group || product.accountingGroup;
  const categoryGroup = product.category?.default_accounting_group || product.category?.defaultAccountingGroup || product.default_accounting_group;

  const resolvedRate = [
    rateFromGroup(manualGroup, orderType),
    rateFromGroup(productGroup, orderType),
    rateFromGroup(categoryGroup, orderType),
  ].find((rate) => hasNumber(rate));

  if (hasNumber(resolvedRate)) return resolvedRate;
  if (!product.accounting_group_id && hasNumber(product.vat_rate)) return Number(product.vat_rate);

  throw new Error(`Missing VAT configuration for ${product.name || product.id || 'product'}`);
}

export function calculateOrderAccounting(cart = [], orderDiscount = 0, orderType = 'takeaway') {
  const sourceLines = cart.map((item) => {
    const modifiers = Array.isArray(item.selectedModifiers) ? item.selectedModifiers : [];
    const unitPriceInclVat = safeNumber(item.product?.price) + modifiers.reduce((sum, modifier) => sum + safeNumber(modifier.price_adjustment), 0);
    const quantity = Math.max(0, Math.trunc(safeNumber(item.quantity)));
    const vatRate = hasNumber(item.product?.resolved_vat_rate)
      ? Number(item.product.resolved_vat_rate)
      : resolveProductVat(item.product, item.orderType || orderType);
    return {
      productId: item.product?.id || null,
      productName: item.product?.name || 'Unknown product',
      categoryName: item.product?.category_name || item.product?.category?.name || '',
      modifierIds: modifiers.map((modifier) => modifier.id).filter(Boolean),
      quantity,
      unitPriceInclVat: round4(unitPriceInclVat),
      vatRate,
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
