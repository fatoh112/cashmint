import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Edit2, Eye, Plus, Settings2, Trash2, X } from 'lucide-react';

const ALLOWED_VAT_RATES = [21, 12, 6, 0];

const blankGroup = {
  name: '',
  accounting_code: '',
  dine_in_rate: '12',
  takeaway_rate: '6',
  is_active: true
};

const blankProfile = {
  name: '',
  dine_in_tax_rate_id: '',
  takeaway_tax_rate_id: '',
  delivery_tax_rate_id: '',
  default_tax_rate_id: '',
  is_active: true
};

export default function TaxManagement({ store, showNotification, isArabic }) {
  const [groups, setGroups] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [rates, setRates] = useState([]);
  const [products, setProducts] = useState([]);

  const [groupEditor, setGroupEditor] = useState(null);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [profileEditor, setProfileEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reviewGroup, setReviewGroup] = useState(null);

  const t = (ar, en) => isArabic ? ar : en;

  const load = useCallback(async () => {
    if (!store?.id) return;
    try {
      const [g, p, r, productsResult] = await Promise.all([
        supabase.from('accounting_groups').select('*').eq('store_id', store.id).order('name'),
        supabase.from('tax_profiles').select('*').eq('store_id', store.id).order('name'),
        supabase.from('tax_rates').select('*').eq('store_id', store.id).order('rate'),
        supabase.from('products').select('id,name,accounting_group_id').eq('store_id', store.id).order('name')
      ]);
      if (g.error || p.error || r.error || productsResult.error) {
        throw g.error || p.error || r.error || productsResult.error;
      }
      setGroups((g.data || []).filter(group => !group.is_internal && !group.name?.startsWith('__direct_vat_')));
      setProfiles(p.data || []);
      setRates(r.data || []);
      setProducts(productsResult.data || []);
    } catch (e) {
      console.error(e);
      showNotification(t('تعذر تحميل المجموعات المحاسبية', 'Unable to load accounting groups'), 'error');
    }
  }, [store?.id, isArabic, showNotification]);

  useEffect(() => { load(); }, [load]);

  const profileById = useMemo(() => Object.fromEntries(profiles.map(p => [p.id, p])), [profiles]);
  const rateById = useMemo(() => Object.fromEntries(rates.map(r => [r.id, r])), [rates]);

  const countProducts = (id) => products.filter(p => p.accounting_group_id === id).length;

  const groupConfigured = (group) => {
    const profile = profileById[group.tax_profile_id];
    return Boolean(profile?.is_active && profile.dine_in_tax_rate_id && profile.takeaway_tax_rate_id);
  };

  const rateLabel = (id) => id ? `${rateById[id]?.name || '—'} (${Number(rateById[id]?.rate || 0)}%)` : t('غير محدد', 'Not set');

  const profileSummary = (profile) => profile ? `${profile.name} — ${t('صالة','Dine-in')} ${Number(rateById[profile.dine_in_tax_rate_id]?.rate ?? 0)}% · ${t('سفري','Takeaway')} ${Number(rateById[profile.takeaway_tax_rate_id]?.rate ?? 0)}%` : t('يحتاج إعداد الضريبة', 'Needs tax configuration');

  const save = async (fn, success) => {
    try {
      setSaving(true);
      const { error } = await fn();
      if (error) throw error;
      showNotification(success, 'success');
      await load();
    } catch (e) {
      showNotification(e.message || t('فشل الحفظ', 'Save failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Ensure tax rate row exists in database for rate percentage (21, 12, 6, 0)
  const ensureTaxRate = async (rateVal) => {
    const num = Number(rateVal);
    const existing = rates.find(r => Number(r.rate) === num);
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('tax_rates')
      .insert({ store_id: store.id, name: `${num}%`, rate: num, is_active: true })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  };

  // Ensure tax profile row exists for given dine-in and takeaway rate IDs
  const ensureTaxProfile = async (dineInRateId, takeawayRateId) => {
    const dineRate = rateById[dineInRateId]?.rate ?? 0;
    const takeawayRate = rateById[takeawayRateId]?.rate ?? 0;
    const profileName = `Tax Profile (${dineRate}% / ${takeawayRate}%)`;

    const existing = profiles.find(p => p.dine_in_tax_rate_id === dineInRateId && p.takeaway_tax_rate_id === takeawayRateId);
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('tax_profiles')
      .insert({
        store_id: store.id,
        name: profileName,
        dine_in_tax_rate_id: dineInRateId,
        takeaway_tax_rate_id: takeawayRateId,
        is_active: true
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  };

  const saveGroup = async (e) => {
    e.preventDefault();
    const value = groupEditor;
    if (!value.name?.trim()) return;

    try {
      setSaving(true);
      const dineInRateId = await ensureTaxRate(value.dine_in_rate);
      const takeawayRateId = await ensureTaxRate(value.takeaway_rate);
      const taxProfileId = await ensureTaxProfile(dineInRateId, takeawayRateId);

      const payload = {
        name: value.name.trim(),
        accounting_code: value.accounting_code?.trim() || null,
        tax_profile_id: taxProfileId,
        is_active: value.is_active ?? true
      };

      if (value.id) {
        const { error } = await supabase.from('accounting_groups').update(payload).eq('id', value.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('accounting_groups').insert({ ...payload, store_id: store.id, is_default: false });
        if (error) throw error;
      }

      showNotification(t('تم حفظ المجموعة المحاسبية', 'Accounting group saved'), 'success');
      setGroupEditor(null);
      await load();
    } catch (err) {
      console.error(err);
      showNotification(err.message || t('فشل حفظ المجموعة المحاسبية', 'Failed to save accounting group'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    const value = profileEditor;
    if (!value.name?.trim()) return;
    save(() => value.id ? supabase.from('tax_profiles').update({ ...value, id: undefined, store_id: undefined }).eq('id', value.id) : supabase.from('tax_profiles').insert({ ...value, store_id: store.id }), t('تم حفظ ملف الضريبة', 'Tax profile saved'));
    setProfileEditor(null);
  };

  const toggleGroup = (group) => save(() => supabase.from('accounting_groups').update({ is_active: !group.is_active }).eq('id', group.id), t('تم تحديث الحالة', 'Status updated'));

  const deleteGroup = (group) => {
    const assignedCount = countProducts(group.id);
    if (assignedCount > 0) {
      return showNotification(
        t(`لا يمكن حذف مجموعة مرتبطة بـ ${assignedCount} منتج. يرجى إعادة تعيين المنتجات أولاً.`, `Cannot delete group assigned to ${assignedCount} products. Reassign products first.`),
        'error'
      );
    }
    if (confirm(t(`حذف مجموعة ${group.name}؟`, `Delete ${group.name}?`))) {
      save(() => supabase.from('accounting_groups').delete().eq('id', group.id), t('تم حذف المجموعة', 'Group deleted'));
    }
  };

  const selectClass = 'w-full mt-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white px-3 py-2.5 text-xs font-semibold focus:outline-none focus:border-amber-500';
  const Modal = ({ children, close }) => (
    <div className="fixed inset-0 z-[70] bg-slate-950/45 flex items-center justify-center p-4 backdrop-blur-sm">
      <div dir={isArabic ? 'rtl' : 'ltr'} className="max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center text-slate-800 dark:text-white">
          <b>{t('المجموعات المحاسبية', 'Accounting Groups')}</b>
          <button onClick={close} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );

  return (
    <div dir={isArabic ? 'rtl' : 'ltr'} className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row justify-between gap-3 sm:items-center">
        <div>
          <h2 className="text-xl font-black text-slate-800 dark:text-white">{t('المجموعات المحاسبية', 'Accounting Groups')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('اختر اسم المجموعة، ونسب ضريبة الصالة والسفري (21%، 12%، 6%، 0%).', 'Specify group name, and fixed Dine-in / Takeaway VAT rates (21%, 12%, 6%, 0%).')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setProfilesOpen(true)} className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-2 transition-all">
            <Settings2 className="w-4 h-4" />{t('إدارة ملفات الضريبة', 'Manage Tax Profiles')}
          </button>
          <button onClick={() => setGroupEditor(blankGroup)} className="px-4 py-2.5 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-2">
            <Plus className="w-4 h-4" />{t('إنشاء مجموعة جديدة', 'Create Accounting Group')}
          </button>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-2xl px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
        {t('المجموعات المخصصة تظهر فوراً في قوالب المنتجات. يمنع حذف أي مجموعة مرتبطة بمنتجات قبل إعادة تعيينها.', 'Custom accounting groups appear immediately in product templates. Groups with assigned products cannot be deleted until reassigned.')}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="p-4 text-start">{t('اسم المجموعة', 'Accounting Group')}</th>
              <th className="p-4 text-start">{t('المعرّف المحاسبي', 'Accounting ID')}</th>
              <th className="p-4 text-start">{t('ملف الضريبة', 'Tax Profile')}</th>
              <th className="p-4 text-center">{t('المنتجات', 'Products')}</th>
              <th className="p-4 text-center">{t('الحالة', 'Status')}</th>
              <th className="p-4 text-end">{t('إجراءات', 'Actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-slate-700 dark:text-slate-200">
            {groups.map(group => {
              const configured = groupConfigured(group);
              const assignedProdCount = countProducts(group.id);
              const isFixedGroup = ['Food', 'Alcohol', 'Non-Alcoholic Drinks', 'Tax Exempt'].includes(group.name);

              return (
                <tr key={group.id}>
                  <td className="p-4 font-bold text-slate-800 dark:text-white">
                    {group.name === 'Soft Drinks' ? t('المشروبات غير الكحولية', 'Non-Alcoholic Drinks') : group.name}
                  </td>
                  <td className="p-4 text-slate-500 dark:text-slate-400">{group.accounting_code || '—'}</td>
                  <td className="p-4">
                    <span className={configured ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'}>
                      {configured ? profileSummary(profileById[group.tax_profile_id]) : t('يحتاج إعداد الضريبة', 'Needs tax configuration')}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <span className={`px-2 py-1 rounded-md font-bold ${assignedProdCount > 0 ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300' : 'bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                      {assignedProdCount}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${group.is_active ? 'bg-emerald-100 dark:bg-emerald-955/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                      {group.is_active ? t('نشطة', 'Active') : t('موقفة', 'Inactive')}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <button title={t('مراجعة المنتجات', 'Review products')} onClick={() => setReviewGroup(group)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button title={t('تعديل', 'Edit')} onClick={() => {
                        const profile = profileById[group.tax_profile_id];
                        const dineInRate = profile ? Number(rateById[profile.dine_in_tax_rate_id]?.rate ?? 12) : 12;
                        const takeawayRate = profile ? Number(rateById[profile.takeaway_tax_rate_id]?.rate ?? 6) : 6;
                        setGroupEditor({
                          ...group,
                          dine_in_rate: String(dineInRate),
                          takeaway_rate: String(takeawayRate)
                        });
                      }} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleGroup(group)} className="text-[10px] font-bold text-amber-600">
                        {group.is_active ? t('إيقاف', 'Deactivate') : t('تفعيل', 'Activate')}
                      </button>
                      <button
                        title={assignedProdCount > 0 ? t(`مرتبطة بـ ${assignedProdCount} منتج - يرجى إعادة التعيين أولاً`, `Assigned to ${assignedProdCount} products - reassign first`) : t('حذف', 'Delete')}
                        onClick={() => deleteGroup(group)}
                        disabled={assignedProdCount > 0 || isFixedGroup}
                        className="p-2 text-rose-500 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {groups.length === 0 && (
              <tr>
                <td colSpan="6" className="p-10 text-center text-slate-500">{t('لا توجد مجموعات محاسبية.', 'No accounting groups yet.')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- CREATE / EDIT ACCOUNTING GROUP MODAL --- */}
      {groupEditor && (
        <Modal close={() => setGroupEditor(null)}>
          <form onSubmit={saveGroup} className="p-5 space-y-4">
            <h3 className="font-black">
              {groupEditor.id ? t('تعديل المجموعة المحاسبية', 'Edit Accounting Group') : t('إنشاء مجموعة محاسبية مخصصة', 'Create Custom Accounting Group')}
            </h3>

            <label className="text-xs font-bold block">
              {t('اسم المجموعة المحاسبية', 'Accounting Group Name')}
              <input
                type="text"
                required
                value={groupEditor.name}
                onChange={e => setGroupEditor({ ...groupEditor, name: e.target.value })}
                placeholder="مثال: Beverages, Bakery, Tax Free"
                className={selectClass}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold block">
                {t('ضريبة الصالة (Dine-in VAT)', 'Dine-in VAT Rate')}
                <select
                  value={groupEditor.dine_in_rate}
                  onChange={e => setGroupEditor({ ...groupEditor, dine_in_rate: e.target.value })}
                  className={selectClass}
                  required
                >
                  {ALLOWED_VAT_RATES.map(rate => (
                    <option key={`dine-${rate}`} value={rate}>{rate}%</option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-bold block">
                {t('ضريبة السفري (Takeaway VAT)', 'Takeaway VAT Rate')}
                <select
                  value={groupEditor.takeaway_rate}
                  onChange={e => setGroupEditor({ ...groupEditor, takeaway_rate: e.target.value })}
                  className={selectClass}
                  required
                >
                  {ALLOWED_VAT_RATES.map(rate => (
                    <option key={`take-${rate}`} value={rate}>{rate}%</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="text-xs font-bold block">
              {t('المعرّف المحاسبي (اختياري)', 'Accounting Code / ID (Optional)')}
              <input
                type="text"
                value={groupEditor.accounting_code || ''}
                onChange={e => setGroupEditor({ ...groupEditor, accounting_code: e.target.value })}
                placeholder="ACC-101"
                className={selectClass}
              />
            </label>

            <label className="flex items-center gap-2 text-xs font-bold pt-1">
              <input
                type="checkbox"
                checked={groupEditor.is_active ?? true}
                onChange={e => setGroupEditor({ ...groupEditor, is_active: e.target.checked })}
              />
              {t('مجموعة نشطة', 'Active Group')}
            </label>

            <button disabled={saving} className="w-full rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-3 transition-colors">
              {saving ? t('جاري الحفظ...', 'Saving...') : t('حفظ المجموعة المحاسبية', 'Save Accounting Group')}
            </button>
          </form>
        </Modal>
      )}

      {/* --- REVIEW GROUP PRODUCTS MODAL --- */}
      {reviewGroup && (
        <Modal close={() => setReviewGroup(null)}>
          <div className="p-5">
            <h3 className="font-black mb-3">{reviewGroup.name}</h3>
            {products.filter(p => p.accounting_group_id === reviewGroup.id).length > 0 ? (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {products.filter(p => p.accounting_group_id === reviewGroup.id).map(p => (
                  <p className="py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-700 text-xs font-bold" key={p.id}>{p.name}</p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-4">{t('لا توجد منتجات مرتبطة بهذة المجموعة.', 'No products assigned to this group.')}</p>
            )}
          </div>
        </Modal>
      )}

      {/* --- ADVANCED TAX PROFILES MODAL --- */}
      {profilesOpen && (
        <Modal close={() => setProfilesOpen(false)}>
          <div className="p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-black">{t('ملفات الضريبة المتقدمة', 'Advanced Tax Profiles')}</h3>
              <button onClick={() => setProfileEditor(blankProfile)} className="text-xs bg-amber-500 text-white rounded-xl px-3 py-2 font-bold">
                {t('إضافة ملف', 'Add Profile')}
              </button>
            </div>
            {profiles.map(p => (
              <div className="border rounded-xl p-3 text-xs" key={p.id}>
                <div className="flex justify-between font-bold">
                  <span>{p.name}</span>
                  <button onClick={() => setProfileEditor(p)} className="text-amber-600">{t('تعديل', 'Edit')}</button>
                </div>
                <p className="text-slate-500 mt-1">
                  {t('محلي', 'Dine-in')}: {rateLabel(p.dine_in_tax_rate_id)} · {t('سفري', 'Takeaway')}: {rateLabel(p.takeaway_tax_rate_id)}
                </p>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {profileEditor && (
        <Modal close={() => setProfileEditor(null)}>
          <form onSubmit={saveProfile} className="p-5 space-y-3">
            <h3 className="font-black">{t('ملف ضريبة', 'Tax Profile')}</h3>
            <input required value={profileEditor.name} onChange={e => setProfileEditor({ ...profileEditor, name: e.target.value })} placeholder={t('اسم الملف', 'Profile name')} className={selectClass} />
            {[['dine_in_tax_rate_id', t('محلي (Dine in)', 'Dine in')], ['takeaway_tax_rate_id', t('سفري (Takeaway)', 'Takeaway')]].map(([key, label]) => (
              <label className="block text-xs font-bold" key={key}>
                {label}
                <select value={profileEditor[key] || ''} onChange={e => setProfileEditor({ ...profileEditor, [key]: e.target.value })} className={selectClass}>
                  <option value="">{t('غير محدد', 'Not set')}</option>
                  {rates.filter(r => r.is_active).map(r => (
                    <option value={r.id} key={r.id}>{r.name} ({Number(r.rate)}%)</option>
                  ))}
                </select>
              </label>
            ))}
            <button disabled={saving} className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold text-xs">{t('حفظ', 'Save')}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
