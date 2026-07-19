export const emptyProductForm = {
  name: '',
  category_id: '',
  price: '',
  accounting_group_id: '',
  is_available: true,
};

export function effectiveAccountingGroupId(form, category, fallbackGroupId = '') {
  return form.accounting_group_id || category?.default_accounting_group_id || fallbackGroupId || '';
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

export function buildProductPayload(form, category) {
  const groupId = effectiveAccountingGroupId(form, category);
  if (!groupId) throw new Error('Product requires an accounting group');
  return {
    name: form.name.trim(),
    category_id: form.category_id,
    price: Number(form.price),
    accounting_group_id: groupId,
    accounting_group_is_override: Boolean(category?.default_accounting_group_id && category.default_accounting_group_id !== groupId),
    vat_rate: null,
  };
}
