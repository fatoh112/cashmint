import React, { useState, useEffect, useCallback } from 'react';
import { X, Folder, Package, Tag, Plus, Trash2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';

export default function CatalogManagerDrawer({ isOpen, onClose, storeId, storeName, isArabic }) {
  const [activeTab, setActiveTab] = useState('categories'); // 'categories' or 'products'

  // Data State
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [accountingGroups, setAccountingGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Category Form State
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  // Product Form State
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [newProductForm, setNewProductForm] = useState({
    name: '',
    price: '',
    category_id: '',
    accounting_group_id: '',
    is_available: true
  });
  const [savingProduct, setSavingProduct] = useState(false);

  // Fetch Data Function
  const fetchData = useCallback(async () => {
    if (!storeId) return;
    try {
      setLoading(true);
      setError(null);

      // Fetch categories for this store
      const { data: cats, error: catsErr } = await supabase
        .from('categories')
        .select('*')
        .eq('store_id', storeId)
        .order('name');
      if (catsErr) throw catsErr;

      // Fetch products for this store
      const { data: prods, error: prodsErr } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', storeId)
        .order('name');
      if (prodsErr) throw prodsErr;
      const { data: groups, error: groupsErr } = await supabase
        .from('accounting_groups')
        .select('id,name,is_default,tax_profiles(name,dine_in_tax_rate:tax_rates!tax_profiles_dine_in_tax_rate_id_fkey(rate),takeaway_tax_rate:tax_rates!tax_profiles_takeaway_tax_rate_id_fkey(rate))')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('name');
      if (groupsErr) throw groupsErr;

      setCategories(cats || []);
      setProducts(prods || []);
      setAccountingGroups(groups || []);
    } catch (err) {
      console.error('Error fetching catalog data:', err);
      const dbErrorMessage = err.message || err.details || '';
      setError(
        isArabic 
          ? `حدث خطأ أثناء تحميل البيانات: ${dbErrorMessage}` 
          : `Failed to fetch catalog data: ${dbErrorMessage}`
      );
    } finally {
      setLoading(false);
    }
  }, [storeId, isArabic]);

  // Fetch when drawer opens or storeId changes
  useEffect(() => {
    if (isOpen && storeId) {
      fetchData();
      setError(null);
      setSuccess(null);
      setIsAddingCategory(false);
      setNewCategoryName('');
      setIsAddingProduct(false);
      setNewProductForm({
        name: '',
        price: '',
        category_id: '',
        accounting_group_id: '',
        is_available: true
      });
    }
  }, [isOpen, storeId, fetchData]);

  // Auto-dismiss success notification
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // --- Category Handlers ---
  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      setSavingCategory(true);
      setError(null);
      setSuccess(null);

      const { error: err } = await supabase
        .from('categories')
        .insert({
          name: newCategoryName.trim(),
          store_id: storeId
        });

      if (err) throw err;

      setSuccess(isArabic ? 'تم إضافة القسم بنجاح' : 'Category added successfully');
      setNewCategoryName('');
      setIsAddingCategory(false);
      fetchData();
    } catch (err) {
      console.error('Error adding category:', err);
      setError(isArabic ? 'فشل إضافة القسم' : 'Failed to add category');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (id) => {
    const confirmMessage = isArabic 
      ? 'هل أنت متأكد من حذف هذا القسم؟ سيتم حذف جميع منتجاته أيضاً.' 
      : 'Are you sure you want to delete this category? All its products will also be deleted.';
    
    if (!window.confirm(confirmMessage)) return;

    try {
      setError(null);
      setSuccess(null);

      const { error: err } = await supabase
        .from('categories')
        .delete()
        .eq('id', id);

      if (err) throw err;

      setSuccess(isArabic ? 'تم حذف القسم بنجاح' : 'Category deleted successfully');
      fetchData();
    } catch (err) {
      console.error('Error deleting category:', err);
      setError(isArabic ? 'فشل حذف القسم. قد يكون مرتبطاً بطلبات سابقة.' : 'Failed to delete category. It might be referenced in orders.');
    }
  };

  // --- Product Handlers ---
  const handleAddProduct = async (e) => {
    e.preventDefault();
    const { name, price, category_id, accounting_group_id, is_available } = newProductForm;
    if (!name.trim() || !price || !category_id || !accounting_group_id) {
      setError(isArabic ? 'الرجاء ملء جميع الحقول المطلوبة' : 'Please fill all required fields');
      return;
    }

    try {
      setSavingProduct(true);
      setError(null);
      setSuccess(null);

      const { error: err } = await supabase
        .from('products')
        .insert({
          name: name.trim(),
          price: parseFloat(price),
          category_id,
          accounting_group_id,
          vat_rate: null,
          is_available,
          store_id: storeId
        });

      if (err) throw err;

      setSuccess(isArabic ? 'تم إضافة المنتج بنجاح' : 'Product added successfully');
      setNewProductForm({
        name: '',
        price: '',
        category_id: '',
        accounting_group_id: '',
        is_available: true
      });
      setIsAddingProduct(false);
      fetchData();
    } catch (err) {
      console.error('Error adding product:', err);
      setError(isArabic ? 'فشل إضافة المنتج' : 'Failed to add product');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (id) => {
    const confirmMessage = isArabic 
      ? 'هل أنت متأكد من حذف هذا المنتج؟' 
      : 'Are you sure you want to delete this product?';

    if (!window.confirm(confirmMessage)) return;

    try {
      setError(null);
      setSuccess(null);

      const { error: err } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (err) throw err;

      setSuccess(isArabic ? 'تم حذف المنتج بنجاح' : 'Product deleted successfully');
      fetchData();
    } catch (err) {
      console.error('Error deleting product:', err);
      setError(isArabic ? 'فشل حذف المنتج' : 'Failed to delete product');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
      <div className="absolute inset-0 overflow-hidden">
        {/* Backdrop overlay */}
        <div 
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300 ease-out cursor-pointer" 
          onClick={onClose}
        />

        <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
          {/* Slide-over panel */}
          <div 
            className="pointer-events-auto w-screen max-w-2xl bg-slate-900 border-l border-slate-800 text-slate-100 flex flex-col h-full shadow-2xl transform transition-transform duration-300 ease-out animate-slide-in-right"
            dir={isArabic ? "rtl" : "ltr"}
          >
            
            {/* Header */}
            <div className="px-6 py-5 bg-slate-850 border-b border-slate-800 flex justify-between items-center shrink-0">
              <div className="space-y-1 text-right">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-sm font-black text-white tracking-wide">
                    {isArabic ? "مدير كتالوج المتجر" : "Store Catalog Manager"}
                  </h2>
                </div>
                <p className="text-xs font-bold text-slate-400 flex items-center gap-2">
                  <span>{storeName}</span>
                  <span className="font-mono text-[9px] text-slate-600 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    ID: {storeId || 'N/A'}
                  </span>
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="px-6 bg-slate-850/50 border-b border-slate-800/80 shrink-0">
              <div className="flex gap-6">
                <button
                  onClick={() => setActiveTab('categories')}
                  className={`py-3.5 text-xs font-extrabold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === 'categories'
                      ? 'border-cyan-500 text-cyan-400 font-black'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <Folder className="w-4 h-4" />
                  <span>{isArabic ? "الأقسام (Categories)" : "Categories"}</span>
                </button>
                <button
                  onClick={() => setActiveTab('products')}
                  className={`py-3.5 text-xs font-extrabold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === 'products'
                      ? 'border-cyan-500 text-cyan-400 font-black'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <Package className="w-4 h-4" />
                  <span>{isArabic ? "المنتجات (Products)" : "Products"}</span>
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Messages Banners */}
              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-450 text-xs font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-450" />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3 text-emerald-400 text-xs font-bold animate-pulse">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-450" />
                  <span>{success}</span>
                </div>
              )}

              {loading ? (
                <div className="h-full flex flex-col justify-center items-center py-16">
                  <Loader2 className="w-8 h-8 text-cyan-450 animate-spin" />
                  <span className="text-xs text-slate-400 mt-3 font-semibold">
                    {isArabic ? 'جاري تحميل البيانات...' : 'Loading catalog details...'}
                  </span>
                </div>
              ) : activeTab === 'categories' ? (
                /* --- Categories Tab Content --- */
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                      {isArabic ? 'قائمة الأقسام' : 'Categories List'}
                    </h3>
                    {!isAddingCategory && (
                      <button
                        onClick={() => setIsAddingCategory(true)}
                        className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded-lg text-[10px] font-black flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{isArabic ? 'إضافة قسم جديد' : 'Add New Category'}</span>
                      </button>
                    )}
                  </div>

                  {isAddingCategory && (
                    <form onSubmit={handleAddCategory} className="bg-slate-850 p-4 rounded-xl border border-slate-800 space-y-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 mb-1.5">
                          {isArabic ? 'اسم القسم' : 'Category Name'}
                        </label>
                        <input
                          type="text"
                          required
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder={isArabic ? 'مثال: المشروبات' : 'e.g. Beverages'}
                          className="w-full bg-slate-900 border border-slate-750 focus:border-cyan-500/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-hidden"
                          dir={isArabic ? 'rtl' : 'ltr'}
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingCategory(false);
                            setNewCategoryName('');
                          }}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white rounded-lg text-[10px] font-bold border border-slate-700/60 transition-all cursor-pointer"
                        >
                          {isArabic ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button
                          type="submit"
                          disabled={savingCategory}
                          className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-lg text-[10px] transition-all cursor-pointer flex items-center gap-1"
                        >
                          {savingCategory ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Plus className="w-3 h-3" />
                          )}
                          <span>{isArabic ? 'إضافة' : 'Add'}</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {categories.length === 0 ? (
                    <div className="flex flex-col justify-center items-center text-center space-y-4 py-12 bg-slate-850/30 rounded-2xl border border-dashed border-slate-800">
                      <div className="p-3 bg-slate-800/80 text-slate-500 rounded-xl">
                        <Folder className="w-6 h-6" />
                      </div>
                      <div className="space-y-1 max-w-sm px-4">
                        <h4 className="text-xs font-bold text-slate-300">
                          {isArabic ? 'لا توجد أقسام بعد' : 'No Categories Yet'}
                        </h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          {isArabic 
                            ? 'لم يتم تحديد أي أقسام أو فئات لهذا المتجر بعد. ابدأ بإضافة قسم جديد أعلاه.'
                            : 'No category folders registered for this store. Add one using the button above to get started.'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {categories.map((cat) => (
                        <div 
                          key={cat.id} 
                          className="bg-slate-850 border border-slate-800 hover:border-slate-750 p-3 rounded-xl flex items-center justify-between transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-cyan-500/5 text-cyan-400 flex items-center justify-center border border-cyan-500/10">
                              <Folder className="w-4 h-4" />
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-extrabold text-white">{cat.name}</p>
                              <p className="text-[9px] font-mono text-slate-500">ID: {cat.id}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteCategory(cat.id)}
                            className="w-7 h-7 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer active:scale-95"
                            title={isArabic ? 'حذف القسم' : 'Delete Category'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* --- Products Tab Content --- */
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                      {isArabic ? 'قائمة المنتجات' : 'Products List'}
                    </h3>
                    {!isAddingProduct && (
                      <button
                        onClick={() => setIsAddingProduct(true)}
                        className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded-lg text-[10px] font-black flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{isArabic ? 'إضافة منتج جديد' : 'Add New Product'}</span>
                      </button>
                    )}
                  </div>

                  {isAddingProduct && (
                    <form onSubmit={handleAddProduct} className="bg-slate-850 p-4 rounded-xl border border-slate-800 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-[10px] font-black text-slate-400 mb-1.5">
                            {isArabic ? 'اسم المنتج' : 'Product Name'}
                          </label>
                          <input
                            type="text"
                            required
                            value={newProductForm.name}
                            onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })}
                            placeholder={isArabic ? 'مثال: بيتزا مارغريتا' : 'e.g. Margherita Pizza'}
                            className="w-full bg-slate-900 border border-slate-750 focus:border-cyan-500/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-hidden"
                            dir={isArabic ? 'rtl' : 'ltr'}
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1.5">
                            {isArabic ? 'السعر' : 'Price'}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={newProductForm.price}
                            onChange={(e) => setNewProductForm({ ...newProductForm, price: e.target.value })}
                            placeholder="0.00"
                            className="w-full bg-slate-900 border border-slate-750 focus:border-cyan-500/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-hidden"
                            dir="ltr"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-slate-400 mb-1.5">
                            {isArabic ? 'القسم' : 'Category'}
                          </label>
                          <select
                            required
                            value={newProductForm.category_id}
                            onChange={(e) => setNewProductForm({ ...newProductForm, category_id: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-750 focus:border-cyan-500/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-hidden cursor-pointer"
                          >
                            <option value="">{isArabic ? 'اختر القسم' : 'Select Category'}</option>
                            {categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[10px] font-black text-slate-400 mb-1.5">
                            {isArabic ? 'مجموعة المحاسبة' : 'Accounting Group'}
                          </label>
                          <select
                            required
                            value={newProductForm.accounting_group_id}
                            onChange={(e) => setNewProductForm({ ...newProductForm, accounting_group_id: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-750 focus:border-cyan-500/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-hidden cursor-pointer"
                          >
                            <option value="">{isArabic ? 'اختر مجموعة محاسبية' : 'Select accounting group'}</option>
                            {accountingGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name} - Dine-in {group.tax_profiles?.dine_in_tax_rate?.rate ?? '-'}% / Takeaway {group.tax_profiles?.takeaway_tax_rate?.rate ?? '-'}%
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingProduct(false);
                            setNewProductForm({
                              name: '',
                              price: '',
                              category_id: '',
                              accounting_group_id: '',
                              is_available: true
                            });
                          }}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white rounded-lg text-[10px] font-bold border border-slate-700/60 transition-all cursor-pointer"
                        >
                          {isArabic ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button
                          type="submit"
                          disabled={savingProduct}
                          className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-lg text-[10px] transition-all cursor-pointer flex items-center gap-1"
                        >
                          {savingProduct ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Plus className="w-3 h-3" />
                          )}
                          <span>{isArabic ? 'إضافة' : 'Add'}</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {products.length === 0 ? (
                    <div className="flex flex-col justify-center items-center text-center space-y-4 py-12 bg-slate-850/30 rounded-2xl border border-dashed border-slate-800">
                      <div className="p-3 bg-slate-800/80 text-slate-500 rounded-xl">
                        <Package className="w-6 h-6" />
                      </div>
                      <div className="space-y-1 max-w-sm px-4">
                        <h4 className="text-xs font-bold text-slate-300">
                          {isArabic ? 'لا توجد منتجات بعد' : 'No Products Yet'}
                        </h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          {isArabic 
                            ? 'لم يتم إضافة أي منتجات لهذا المتجر بعد. ابدأ بإضافة منتج جديد أعلاه.'
                            : 'No products registered for this store menu. Add one using the button above to get started.'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {products.map((prod) => {
                        const cat = categories.find((c) => c.id === prod.category_id);
                        return (
                          <div 
                            key={prod.id} 
                            className="bg-slate-850 border border-slate-800 hover:border-slate-750 p-3 rounded-xl flex items-center justify-between transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-cyan-500/5 text-cyan-400 flex items-center justify-center border border-cyan-500/10">
                                <Package className="w-4 h-4" />
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-extrabold text-white">{prod.name}</p>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                  <span className="font-mono text-cyan-400 font-bold">{parseFloat(prod.price).toFixed(2)} USD</span>
                                  <span className="text-slate-700">•</span>
                                  <span className="bg-slate-900 px-2 py-0.5 rounded text-[9px] text-slate-400 font-medium">
                                    {cat ? cat.name : (isArabic ? 'قسم غير معروف' : 'Unknown Category')}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteProduct(prod.id)}
                              className="w-7 h-7 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer active:scale-95"
                              title={isArabic ? 'حذف المنتج' : 'Delete Product'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-850 border-t border-slate-800 flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-xl text-xs font-bold border border-slate-700/80 transition-all cursor-pointer active:scale-98"
              >
                {isArabic ? "إغلاق" : "Close"}
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
