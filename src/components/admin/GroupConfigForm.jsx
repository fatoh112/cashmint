import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { 
  ArrowLeft, 
  Save, 
  Check,} from 'lucide-react';

export default function GroupConfigForm({ store, group, onClose, showNotification, isArabic }) {
  
  // Form State
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [minItems, setMinItems] = useState('1');
  const [maxItems, setMaxItems] = useState('');
  const [noMaximum, setNoMaximum] = useState(true);
  const [priceStrategy, setPriceStrategy] = useState('keep_initial'); // 'keep_initial' or 'set_price'
  const [groupPrice, setGroupPrice] = useState('0.00');

  // Multi-select Products State
  const [allProducts, setAllProducts] = useState([]);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    if (!store) return;
    try {
      const { data } = await supabase
        .from('products')
        .select('id, name, price')
        .eq('store_id', store.id)
        .order('name');
      setAllProducts(data || []);
    } catch (err) {
      console.error(err);
    }
  }, [store]);

  const loadMappedProducts = useCallback(async () => {
    if (!group) return;
    try {
      const { data } = await supabase
        .from('group_item_mapping')
        .select('product_id')
        .eq('group_id', group.id);
      
      if (data) {
        setSelectedProductIds(data.map(m => m.product_id));
      }
    } catch (err) {
      console.error(err);
    }
  }, [group]);

  useEffect(() => {
    loadProducts();
    if (group) {
      // Load group data
      setName(group.name || '');
      setSku(group.sku || '');
      setIsRequired(group.is_required || false);
      setMinItems(String(group.min_items || 1));
      if (group.max_items === null) {
        setNoMaximum(true);
        setMaxItems('');
      } else {
        setNoMaximum(false);
        setMaxItems(String(group.max_items));
      }
      setPriceStrategy(group.price_strategy || 'keep_initial');
      setGroupPrice(String(group.group_price || '0.00'));

      loadMappedProducts();
    }
  }, [group, loadProducts, loadMappedProducts]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name) return;

    try {
      setLoading(true);

      const payload = {
        name,
        sku: sku || null,
        is_required: isRequired,
        min_items: isRequired ? parseInt(minItems) || 1 : 0,
        max_items: noMaximum ? null : parseInt(maxItems) || null,
        price_strategy: priceStrategy,
        group_price: priceStrategy === 'set_price' ? parseFloat(groupPrice) || 0 : 0
      };

      let groupId = group?.id;

      if (group) {
        // Update
        const { error } = await supabase
          .from('item_groups')
          .update(payload)
          .eq('id', group.id);
        if (error) throw error;
      } else {
        // Insert
        const { data, error } = await supabase
          .from('item_groups')
          .insert({ ...payload, store_id: store.id })
          .select()
          .single();
        if (error) throw error;
        groupId = data.id;
      }

      // Sync mapped products
      // First delete existing mappings
      const { error: delErr } = await supabase
        .from('group_item_mapping')
        .delete()
        .eq('group_id', groupId);
      if (delErr) throw delErr;

      // Then insert new ones
      if (selectedProductIds.length > 0) {
        const mappings = selectedProductIds.map(prodId => ({
          group_id: groupId,
          product_id: prodId,
          store_id: store.id
        }));

        const { error: insErr } = await supabase
          .from('group_item_mapping')
          .insert(mappings);
        if (insErr) throw insErr;
      }

      showNotification(isArabic ? "تم حفظ مجموعة الخيارات والمربوطات بنجاح" : "Item group configurations saved successfully");
      onClose();

    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حفظ مجموعة الخيارات" : "Error saving group config", "error");
    } finally {
      setLoading(false);
    }
  };

  const toggleProductSelect = (id) => {
    if (selectedProductIds.includes(id)) {
      setSelectedProductIds(selectedProductIds.filter(pId => pId !== id));
    } else {
      setSelectedProductIds([...selectedProductIds, id]);
    }
  };

  return (
    <div className="space-y-6 text-right font-sans" dir={isArabic ? 'rtl' : 'ltr'}>
      
      {/* Top Header Navigation */}
      <div className="border-b border-slate-150 pb-4 flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded-xl transition-all"
          >
            <ArrowLeft className={`w-5 h-5 ${isArabic ? '' : 'rotate-180'}`} />
          </button>
          <div>
            <h2 className="text-lg font-black text-slate-800">
              {group ? (isArabic ? `تعديل مجموعة: ${group.name}` : `Edit Group: ${group.name}`) : (isArabic ? "إنشاء مجموعة خيارات جديدة" : "Create New Item Group")}
            </h2>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
              {isArabic ? "تكوين القواعد، التسعير، والعناصر المتاحة داخل المجموعة" : "Configure selection rules, strategies, and mapped products"}
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-bold text-xs px-6 py-2.5 rounded-xl transition-all flex items-center gap-2"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>{isArabic ? "حفظ المجموعة" : "Save Group"}</span>
            </>
          )}
        </button>
      </div>

      {/* TWO COLUMN FORM LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Section headers and descriptions */}
        <div className="lg:col-span-1 space-y-6">
          <div className="space-y-1">
            <h4 className="font-extrabold text-sm text-slate-800 uppercase">{isArabic ? "البيانات الأساسية" : "Basics"}</h4>
            <p className="text-[10px] text-slate-400 font-bold leading-relaxed">
              {isArabic 
                ? "قم بتحديد الاسم الفريد ورمز SKU التعريفي للمجموعة لعرضها في منيو الكاشير." 
                : "Specify a unique name and tracking SKU identifier for this choices group."}
            </p>
          </div>

          <div className="space-y-1 pt-4 border-t border-slate-100">
            <h4 className="font-extrabold text-sm text-slate-800 uppercase">{isArabic ? "إستراتيجية التسعير" : "Pricing Strategy"}</h4>
            <p className="text-[10px] text-slate-400 font-bold leading-relaxed">
              {isArabic 
                ? "تحديد ما إذا كانت المنتجات المختارة تحافظ على أسعارها الأصلية، أم تطبق سعراً موحداً يتم تحديده للمجموعة ككل." 
                : "Decide whether items maintain their base price, or apply a fixed group price override."}
            </p>
          </div>

          <div className="space-y-1 pt-4 border-t border-slate-100">
            <h4 className="font-extrabold text-sm text-slate-800 uppercase">{isArabic ? "قواعد الاختيار" : "Selection Rules"}</h4>
            <p className="text-[10px] text-slate-400 font-bold leading-relaxed">
              {isArabic 
                ? "تحديد ما إذا كان هذا الخيار إجبارياً على الكاشير، وتعيين الحد الأدنى والأقصى من السلع المسموح باختيارها." 
                : "Define selection logic, requiring choices at cashier check-out or making them optional."}
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive Input Cards */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Card 1: Basics */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-450 uppercase block mr-1">{isArabic ? "اسم مجموعة الخيارات" : "Group Name"}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: إضافات البرجر، اختيار الأطباق الجانبية"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-455 uppercase block mr-1">{isArabic ? "الرمز SKU للمجموعة" : "Group SKU"}</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU-GRP-BURGER"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Card 2: Pricing Strategy & Reactive Logic 1 */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <span className="font-extrabold text-xs text-slate-800 block">{isArabic ? "تسعير الخيارات (Choice Price)" : "Choice Price Logic"}</span>
            
            <div className="space-y-3 font-semibold text-xs text-slate-700">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="priceStrategy"
                  value="keep_initial"
                  checked={priceStrategy === 'keep_initial'}
                  onChange={() => setPriceStrategy('keep_initial')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <span>{isArabic ? "الخيارات تحتفظ بأسعارها الأصلية في المنيو" : "Choices keep their initial price"}</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="priceStrategy"
                  value="set_price"
                  checked={priceStrategy === 'set_price'}
                  onChange={() => setPriceStrategy('set_price')}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <span>{isArabic ? "الخيارات لها سعر موحد لهذه المجموعة" : "Choices have set price for the group"}</span>
              </label>
            </div>

            {/* Reactive Logic 1: Show Group Price if set_price is active */}
            {priceStrategy === 'set_price' && (
              <div className="space-y-1.5 pt-3 border-t border-slate-50 animate-fade-in">
                <label className="text-[10px] font-bold text-slate-455 uppercase block mr-1">
                  {isArabic ? "السعر الموحد للخيارات داخل المجموعة (EUR)" : "Fixed Group Price in EUR"}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={groupPrice}
                  onChange={(e) => setGroupPrice(e.target.value)}
                  className="w-32 px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-850 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>

          {/* Card 3: Selection Rules & Reactive Logic 2 */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <span className="font-extrabold text-xs text-slate-800 block">{isArabic ? "قواعد الاختيار (Selection Rules)" : "Selection Rules"}</span>

            <div className="space-y-3 font-semibold text-xs text-slate-700">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="isRequired"
                  checked={!isRequired}
                  onChange={() => setIsRequired(false)}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <span>{isArabic ? "اختياري (يمكن تخطي المجموعة دون اختيار)" : "Optional (Choices can be skipped)"}</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="isRequired"
                  checked={isRequired}
                  onChange={() => setIsRequired(true)}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <span>{isArabic ? "إلزامي (يجب على أمين الصندوق الاختيار)" : "Required (Cashier must pick choices)"}</span>
              </label>
            </div>

            {/* Reactive Logic 2: Show Min/Max limits if required */}
            {isRequired && (
              <div className="space-y-4 pt-3 border-t border-slate-50 animate-fade-in">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-455 uppercase block mr-1">{isArabic ? "الحد الأدنى للخيارات" : "Minimum Items"}</label>
                    <input
                      type="number"
                      min="1"
                      value={minItems}
                      onChange={(e) => setMinItems(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {!noMaximum && (
                    <div className="space-y-1.5 animate-fade-in">
                      <label className="text-[10px] font-bold text-slate-455 uppercase block mr-1">{isArabic ? "الحد الأقصى للخيارات" : "Maximum Items"}</label>
                      <input
                        type="number"
                        min="1"
                        value={maxItems}
                        onChange={(e) => setMaxItems(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer font-bold text-[10px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={noMaximum}
                    onChange={(e) => {
                      setNoMaximum(e.target.checked);
                      if (e.target.checked) setMaxItems('');
                    }}
                    className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>{isArabic ? "لا يوجد حد أقصى للخيارات" : "No maximum limit"}</span>
                </label>
              </div>
            )}
          </div>

          {/* Card 4: Link Products (Junction Mapping) */}
          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div>
              <span className="font-extrabold text-xs text-slate-800 block">{isArabic ? "العناصر المدرجة بالمجموعة" : "Mapped Products List"}</span>
              <span className="text-[9px] text-slate-450 font-bold mt-1 block">
                {isArabic ? "اختر المنتجات المتوفرة لتكون خيارات صالحة للاختيار داخل هذه المجموعة" : "Map products from catalog to be choices under this item group."}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1 border border-slate-100 rounded-xl bg-slate-50/55">
              {allProducts.map(prod => {
                const isSelected = selectedProductIds.includes(prod.id);
                return (
                  <div
                    key={prod.id}
                    onClick={() => toggleProductSelect(prod.id)}
                    className={`p-3 border rounded-xl cursor-pointer flex items-center justify-between transition-all ${
                      isSelected ? 'border-blue-500 bg-blue-50/20' : 'border-slate-200 bg-white hover:border-slate-350'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                      }`}>
                        {isSelected && <Check className="w-2.5 h-2.5" />}
                      </div>
                      <span className="font-bold text-xs text-slate-800">{prod.name}</span>
                    </div>
                    <span className="font-black text-slate-400 text-[10px]">{parseFloat(prod.price).toFixed(2)} €</span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
