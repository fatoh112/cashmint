export const emptyProductForm = {
  name: '',
  category_id: '',
  price: '',
  accounting_group_id: '',
  is_available: true,
};

export function effectiveAccountingGroupId(form, _category, _fallbackGroupId = '') {
  return form.accounting_group_id || '';
}

export function canSubmitProductForm(form, isSaving = false) {
  return !isSaving
    && Boolean(form.name?.trim())
    && Boolean(form.category_id)
    && form.price !== ''
    && Number.isFinite(Number(form.price))
    && Number(form.price) >= 0
    && Boolean(form.accounting_group_id);
}

export function buildProductPayload(form, _category) {
  const groupId = form.accounting_group_id;
  if (!form.category_id) throw new Error('Product requires a valid category');
  if (!groupId) throw new Error('Product requires an accounting group');
  return {
    name: form.name.trim(),
    category_id: form.category_id,
    price: Number(form.price),
    accounting_group_id: groupId,
    accounting_group_is_override: false,
    vat_rate: null,
  };
}
