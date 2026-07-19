import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';

export default function ComboBuilderForm({ store, onClose, showNotification, isArabic }) {
  const [products, setProducts] = useState([]);
  const [bundleId, setBundleId] = useState('');
  const [components, setComponents] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!store?.id) return;
    supabase.from('products').select('id,name,price').eq('store_id', store.id).order('name')
      .then(({ data, error }) => { if (error) console.error(error); else setProducts(data || []); });
  }, [store?.id]);

  useEffect(() => {
    if (!bundleId) { setComponents([]); return; }
    supabase.from('product_bundle_components').select('component_product_id,quantity,allocation_weight')
      .eq('bundle_product_id', bundleId)
      .then(({ data, error }) => { if (error) console.error(error); else setComponents(data || []); });
  }, [bundleId]);

  const toggle = (productId) => setComponents(current => current.some(c => c.component_product_id === productId)
    ? current.filter(c => c.component_product_id !== productId)
    : [...current, { component_product_id: productId, quantity: 1, allocation_weight: 1 }]);

  const update = (productId, field, value) => setComponents(current => current.map(component => component.component_product_id === productId
    ? { ...component, [field]: Math.max(0.001, Number(value) || 0.001) } : component));

  const save = async (event) => {
    event.preventDefault();
    if (!bundleId || !components.length) return;
    try {
      setSaving(true);
      const { error: deleteError } = await supabase.from('product_bundle_components').delete().eq('bundle_product_id', bundleId);
      if (deleteError) throw deleteError;
      const { error } = await supabase.from('product_bundle_components').insert(components.map(component => ({ ...component, store_id: store.id, bundle_product_id: bundleId })));
      if (error) throw error;
      showNotification(isArabic ? 'تم حفظ مكونات العرض. سيُوزع السعر والضريبة على كل مكوّن عند الدفع.' : 'Bundle components saved. Price and VAT will be allocated per component at checkout.');
      onClose();
    } catch (error) {
      console.error(error);
      showNotification(isArabic ? 'تعذر حفظ العرض.' : 'Unable to save bundle.', 'error');
    } finally { setSaving(false); }
  };

  const bundleProducts = products.filter(product => product.id !== bundleId);
  return <div className="space-y-5 text-right" dir={isArabic ? 'rtl' : 'ltr'}>
    <div className="flex justify-between items-start gap-4"><div><h2 className="text-xl font-black">{isArabic ? 'منشئ العروض / Combo Builder' : 'Combo Builder'}</h2><p className="text-xs text-slate-500 mt-1">{isArabic ? 'العرض منتج قابل للبيع؛ مكوّناته تحفظ كسطور مستقلة لضريبة وتقارير صحيحة.' : 'A combo is sellable, while its components are retained as separate tax and reporting lines.'}</p></div><button onClick={onClose} className="text-slate-500">×</button></div>
    <form onSubmit={save} className="space-y-4">
      <label className="block text-xs font-bold">{isArabic ? 'منتج العرض وسعره النهائي' : 'Sellable combo product and final price'}<select required value={bundleId} onChange={event => setBundleId(event.target.value)} className="mt-2 w-full rounded-xl border p-3 text-sm"><option value="">{isArabic ? 'اختر منتج عرض من الكتالوج' : 'Select a combo product from the catalog'}</option>{products.map(product => <option value={product.id} key={product.id}>{product.name} — {Number(product.price).toFixed(2)} €</option>)}</select></label>
      {bundleId && <div className="rounded-2xl border p-4 space-y-2"><p className="text-xs font-black">{isArabic ? 'مكوّنات العرض' : 'Bundle components'}</p>{bundleProducts.map(product => { const component=components.find(item => item.component_product_id===product.id); return <div key={product.id} className="flex items-center gap-3 py-2 border-b last:border-0"><input type="checkbox" checked={Boolean(component)} onChange={() => toggle(product.id)} /><span className="flex-1 text-xs font-bold">{product.name}</span>{component && <><input aria-label="quantity" type="number" min="0.001" step="0.001" value={component.quantity} onChange={event => update(product.id,'quantity',event.target.value)} className="w-20 border rounded p-1 text-xs" /><input aria-label="allocation weight" type="number" min="0.001" step="0.001" value={component.allocation_weight} onChange={event => update(product.id,'allocation_weight',event.target.value)} className="w-20 border rounded p-1 text-xs" /></>}</div>})}</div>}
      <p className="text-[11px] text-slate-500">{isArabic ? 'يُستخدم الوزن مع سعر كل مكوّن لتوزيع سعر العرض. لا يُرسل العميل أي سعر أو ضريبة إلى السيرفر.' : 'Weight and component reference price allocate the combo price. The client never supplies the final price or tax.'}</p>
      <button disabled={saving || !bundleId || !components.length} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-40">{saving ? '…' : (isArabic ? 'حفظ العرض' : 'Save combo')}</button>
    </form>
  </div>;
}
