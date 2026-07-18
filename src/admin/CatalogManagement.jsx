import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { 
  Plus, 
  Edit2, 
  Trash2, 
  FolderPlus, 
  ShoppingBag, 
  Sliders,
  Settings2
} from 'lucide-react';

export default function CatalogManagement({ store, showNotification, isArabic, onManageAccountingGroups }) {
  const [activeTab, setActiveTab] = useState('products'); // 'categories', 'products', 'modifiers'
  
  // Data States
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [accountingGroups, setAccountingGroups] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modal States
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryName, setCategoryName] = useState('');

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState({
    name: '',
    category_id: '',
    price: '',
    accounting_group_id: '',
    is_available: true
  });

  const [modifierModalOpen, setModifierModalOpen] = useState(false);
  const [editingModifier, setEditingModifier] = useState(null);
  const [modifierForm, setModifierForm] = useState({
    product_id: '',
    name: '',
    price_adjustment: '0.00'
  });

  const fetchCatalog = useCallback(async () => {
    if (!store) return;
    try {
      setLoading(true);
      
      // Fetch Categories
      const { data: cats, error: catsErr } = await supabase
        .from('categories')
        .select('*')
        .eq('store_id', store.id)
        .order('name');
      if (catsErr) throw catsErr;
 
      // Fetch Products
      const { data: prods, error: prodsErr } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', store.id)
        .order('name');
      if (prodsErr) throw prodsErr;
      const { data: groups, error: groupsErr } = await supabase.from('accounting_groups').select('id,name,is_default,tax_profiles(name)').eq('store_id', store.id).eq('is_active', true).order('name');
      if (groupsErr) throw groupsErr;
 
      // Fetch Modifiers (Since modifiers don't have store_id, filter to only those belonging to store's products)
      const { data: mods, error: modsErr } = await supabase
        .from('modifiers')
        .select('*');
      if (modsErr) throw modsErr;
 
      const prodIds = (prods || []).map(p => p.id);
      const filteredMods = (mods || []).filter(m => prodIds.includes(m.product_id));

      setCategories(cats || []);
      setProducts(prods || []);
      setAccountingGroups(groups || []);
      setModifiers(filteredMods);
    } catch (err) {
      console.error("Error fetching catalog:", err);
      showNotification(isArabic ? "خطأ في تحميل الكتالوج" : "Error loading catalog", "error");
    } finally {
      setLoading(false);
    }
  }, [store, isArabic, showNotification]);

  useEffect(() => {
    if (store) {
      fetchCatalog();
    }
  }, [store, fetchCatalog]);

  // --- Category CRUD ---
  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!categoryName) return;

    try {
      if (editingCategory) {
        // Update
        const { error } = await supabase
          .from('categories')
          .update({ name: categoryName })
          .eq('id', editingCategory.id);
        if (error) throw error;
        showNotification(isArabic ? "تم تحديث الفئة بنجاح" : "Category updated successfully");
      } else {
        // Create
        const { error } = await supabase
          .from('categories')
          .insert({ name: categoryName, store_id: store.id });
        if (error) throw error;
        showNotification(isArabic ? "تم إضافة الفئة بنجاح" : "Category added successfully");
      }
      setCategoryModalOpen(false);
      setCategoryName('');
      setEditingCategory(null);
      fetchCatalog();
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حفظ الفئة" : "Error saving category", "error");
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!confirm(isArabic ? "هل أنت متأكد من حذف هذه الفئة؟ سيتم حذف جميع المنتجات التابعة لها." : "Are you sure you want to delete this category? All its products will be deleted.")) return;
    try {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
      showNotification(isArabic ? "تم حذف الفئة بنجاح" : "Category deleted successfully");
      fetchCatalog();
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حذف الفئة" : "Error deleting category", "error");
    }
  };

  // --- Product CRUD ---
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!productForm.name || !productForm.category_id || !productForm.price || !productForm.accounting_group_id) return;

    try {
      const payload = {
        name: productForm.name,
        category_id: productForm.category_id,
        price: parseFloat(productForm.price),
        accounting_group_id: productForm.accounting_group_id
      };

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editingProduct.id);
        if (error) throw error;
        showNotification(isArabic ? "تم تحديث المنتج بنجاح" : "Product updated successfully");
      } else {
        const { error } = await supabase
          .from('products')
          .insert({ ...payload, store_id: store.id });
        if (error) throw error;
        showNotification(isArabic ? "تم إضافة المنتج بنجاح" : "Product added successfully");
      }
      setProductModalOpen(false);
      setEditingProduct(null);
      setProductForm({ name: '', category_id: '', price: '', accounting_group_id: accountingGroups.find(g => g.is_default)?.id || '', is_available: true });
      fetchCatalog();
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حفظ المنتج" : "Error saving product", "error");
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm(isArabic ? "هل أنت متأكد من حذف هذا المنتج؟" : "Are you sure you want to delete this product?")) return;
    try {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      showNotification(isArabic ? "تم حذف المنتج بنجاح" : "Product deleted successfully");
      fetchCatalog();
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حذف المنتج" : "Error deleting product", "error");
    }
  };



  // --- Modifier CRUD ---
  const handleSaveModifier = async (e) => {
    e.preventDefault();
    if (!modifierForm.name || !modifierForm.product_id || !modifierForm.price_adjustment) return;

    try {
      const payload = {
        name: modifierForm.name,
        product_id: modifierForm.product_id,
        price_adjustment: parseFloat(modifierForm.price_adjustment)
      };

      if (editingModifier) {
        const { error } = await supabase
          .from('modifiers')
          .update(payload)
          .eq('id', editingModifier.id);
        if (error) throw error;
        showNotification(isArabic ? "تم تحديث الإضافة بنجاح" : "Modifier updated successfully");
      } else {
        const { error } = await supabase
          .from('modifiers')
          .insert(payload);
        if (error) throw error;
        showNotification(isArabic ? "تم إضافة الإضافة بنجاح" : "Modifier added successfully");
      }
      setModifierModalOpen(false);
      setEditingModifier(null);
      setModifierForm({ product_id: '', name: '', price_adjustment: '0.00' });
      fetchCatalog();
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حفظ الإضافة" : "Error saving modifier", "error");
    }
  };

  const handleDeleteModifier = async (id) => {
    if (!confirm(isArabic ? "هل أنت متأكد من حذف هذه الإضافة؟" : "Are you sure you want to delete this modifier?")) return;
    try {
      const { error } = await supabase.from('modifiers').delete().eq('id', id);
      if (error) throw error;
      showNotification(isArabic ? "تم حذف الإضافة بنجاح" : "Modifier deleted successfully");
      fetchCatalog();
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حذف الإضافة" : "Error deleting modifier", "error");
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Module Title & Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800">
            {isArabic ? "إدارة الكتالوج والمنيو" : "Catalog & Menu Management"}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isArabic ? "إضافة وتعديل الفئات، المنتجات، والإضافات للمطعم" : "Add or edit categories, products, and add-ons for your store"}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all ${
              activeTab === 'products' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-850'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{isArabic ? "المنتجات" : "Products"}</span>
            </div>
          </button>
          
          <button
            onClick={() => setActiveTab('categories')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all ${
              activeTab === 'categories' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-850'
            }`}
          >
            <div className="flex items-center gap-2">
              <FolderPlus className="w-3.5 h-3.5" />
              <span>{isArabic ? "الفئات" : "Categories"}</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('modifiers')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all ${
              activeTab === 'modifiers' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-850'
            }`}
          >
            <div className="flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5" />
              <span>{isArabic ? "الإضافات" : "Modifiers"}</span>
            </div>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-400">{isArabic ? "جاري التحميل..." : "Loading catalog..."}</p>
        </div>
      ) : (
        <>
          {/* --- PRODUCTS TAB --- */}
          {activeTab === 'products' && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <span className="font-extrabold text-sm text-slate-700">
                  {isArabic ? `المنتجات المتوفرة (${products.length})` : `Products List (${products.length})`}
                </span>
                <button
                  onClick={() => {
                    setEditingProduct(null);
                    setProductForm({ name: '', category_id: categories[0]?.id || '', price: '', accounting_group_id: accountingGroups.find(g => g.is_default)?.id || '', is_available: true });
                    setProductModalOpen(true);
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 active:scale-95 transition-all shadow-sm shadow-amber-500/10"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isArabic ? "إضافة منتج جديد" : "Add Product"}</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-400 font-bold border-b border-slate-150 uppercase">
                    <tr>
                      <th className="p-4">{isArabic ? "اسم المنتج" : "Name"}</th>
                      <th className="p-4">{isArabic ? "الفئة" : "Category"}</th>
                      <th className="p-4">{isArabic ? "السعر" : "Price"}</th>
                      <th className="p-4">{isArabic ? "مجموعة المحاسبة" : "Accounting Group"}</th>
                      <th className="p-4 text-center">{isArabic ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {products.map(product => {
                      const categoryName = categories.find(c => c.id === product.category_id)?.name || '-';
                      return (
                        <tr key={product.id} className="hover:bg-slate-50/55 transition-all">
                          <td className="p-4 font-bold text-slate-800">{product.name}</td>
                          <td className="p-4 text-slate-500">{categoryName}</td>
                          <td className="p-4 font-black">{parseFloat(product.price).toFixed(2)} €</td>
                          <td className="p-4 text-slate-450">{accountingGroups.find(g => g.id === product.accounting_group_id)?.name || (isArabic ? 'غير معيّن / قديم' : 'Unassigned / Legacy')}</td>
                          <td className="p-4">
                            <div className="flex justify-center gap-2.5">
                              <button
                                onClick={() => {
                                  setEditingProduct(product);
                                  setProductForm({
                                    name: product.name,
                                    category_id: product.category_id || '',
                                    price: product.price,
                                    accounting_group_id: product.accounting_group_id || ''
                                  });
                                  setProductModalOpen(true);
                                }}
                                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition-all"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(product.id)}
                                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- CATEGORIES TAB --- */}
          {activeTab === 'categories' && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <span className="font-extrabold text-sm text-slate-700">
                  {isArabic ? `فئات المنيو (${categories.length})` : `Categories (${categories.length})`}
                </span>
                <button
                  onClick={() => {
                    setEditingCategory(null);
                    setCategoryName('');
                    setCategoryModalOpen(true);
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 active:scale-95 transition-all shadow-sm shadow-amber-500/10"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isArabic ? "إضافة فئة جديدة" : "Add Category"}</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-400 font-bold border-b border-slate-150 uppercase">
                    <tr>
                      <th className="p-4">{isArabic ? "اسم الفئة" : "Category Name"}</th>
                      <th className="p-4">{isArabic ? "تاريخ الإنشاء" : "Created At"}</th>
                      <th className="p-4 text-center">{isArabic ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {categories.map(category => (
                      <tr key={category.id} className="hover:bg-slate-50/55 transition-all">
                        <td className="p-4 font-bold text-slate-800">{category.name}</td>
                        <td className="p-4 text-slate-450">{new Date(category.created_at).toLocaleDateString()}</td>
                        <td className="p-4">
                          <div className="flex justify-center gap-2.5">
                            <button
                              onClick={() => {
                                setEditingCategory(category);
                                setCategoryName(category.name);
                                setCategoryModalOpen(true);
                              }}
                              className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition-all"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(category.id)}
                              className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- MODIFIERS TAB --- */}
          {activeTab === 'modifiers' && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <span className="font-extrabold text-sm text-slate-700">
                  {isArabic ? `خيارات الإضافات (${modifiers.length})` : `Modifiers List (${modifiers.length})`}
                </span>
                <button
                  onClick={() => {
                    setEditingModifier(null);
                    setModifierForm({ product_id: products[0]?.id || '', name: '', price_adjustment: '0.00' });
                    setModifierModalOpen(true);
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 active:scale-95 transition-all shadow-sm shadow-amber-500/10"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isArabic ? "إضافة خيار جديد" : "Add Modifier"}</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-400 font-bold border-b border-slate-150 uppercase">
                    <tr>
                      <th className="p-4">{isArabic ? "اسم الإضافة" : "Modifier Name"}</th>
                      <th className="p-4">{isArabic ? "تابع لمنتج" : "Belongs to Product"}</th>
                      <th className="p-4">{isArabic ? "فارق السعر" : "Price Adjustment"}</th>
                      <th className="p-4 text-center">{isArabic ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                    {modifiers.map(modifier => {
                      const prodName = products.find(p => p.id === modifier.product_id)?.name || '-';
                      return (
                        <tr key={modifier.id} className="hover:bg-slate-50/55 transition-all">
                          <td className="p-4 font-bold text-slate-800">{modifier.name}</td>
                          <td className="p-4 text-slate-550">{prodName}</td>
                          <td className="p-4 font-bold text-emerald-600">+{parseFloat(modifier.price_adjustment).toFixed(2)} €</td>
                          <td className="p-4">
                            <div className="flex justify-center gap-2.5">
                              <button
                                onClick={() => {
                                  setEditingModifier(modifier);
                                  setModifierForm({
                                    product_id: modifier.product_id || '',
                                    name: modifier.name,
                                    price_adjustment: modifier.price_adjustment
                                  });
                                  setModifierModalOpen(true);
                                }}
                                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600 flex items-center justify-center transition-all"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteModifier(modifier.id)}
                                className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* --- CATEGORY MODAL --- */}
      {categoryModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-100 overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-850">
                {isArabic 
                  ? (editingCategory ? "تعديل الفئة" : "إضافة فئة جديدة") 
                  : (editingCategory ? "Edit Category" : "Add New Category")}
              </h3>
              <button onClick={() => setCategoryModalOpen(false)} className="text-slate-450 hover:text-slate-850">✕</button>
            </div>
            <form onSubmit={handleSaveCategory}>
              <div className="p-5 space-y-4 text-right">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "اسم الفئة بالعربية / الإنجليزية" : "Category Name"}</label>
                  <input
                    type="text"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder="مثال: مشروبات، Burgers"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>
              <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2.5 rounded-xl transition-all"
                >
                  {isArabic ? "حفظ" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryModalOpen(false)}
                  className="px-4 border border-slate-200 bg-white text-slate-600 font-bold text-xs py-2.5 rounded-xl hover:bg-slate-50 transition-all"
                >
                  {isArabic ? "إلغاء" : "Cancel"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- PRODUCT MODAL --- */}
      {productModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-100 overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-850">
                {isArabic 
                  ? (editingProduct ? "تعديل المنتج" : "إضافة منتج جديد") 
                  : (editingProduct ? "Edit Product" : "Add New Product")}
              </h3>
              <button onClick={() => setProductModalOpen(false)} className="text-slate-450 hover:text-slate-850">✕</button>
            </div>
            <form onSubmit={handleSaveProduct}>
              <div className="p-5 space-y-4 text-right">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "اسم المنتج" : "Product Name"}</label>
                  <input
                    type="text"
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    placeholder="مثال: تشيز برجر دبل"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "السعر (EUR)" : "Price in EUR"}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={productForm.price}
                      onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                      placeholder="9.60"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "الفئة" : "Category"}</label>
                    <select
                      value={productForm.category_id}
                      onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                      required
                    >
                      <option value="">{isArabic ? "اختر فئة" : "Select Category"}</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <label className="text-xs font-black text-slate-800 block">{isArabic ? "مجموعة المحاسبة" : "Accounting Group"}</label>
                      <p className="text-[11px] leading-5 text-slate-500 mt-1">
                        {isArabic ? "تحدد هذه المجموعة ملف الضريبة المشترك للمنتج حسب محلي أو سفري أو توصيل." : "This group applies the shared tax profile for dine-in, takeaway, and delivery orders."}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-rose-500 whitespace-nowrap">{isArabic ? "مطلوب" : "Required"}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={productForm.accounting_group_id}
                      onChange={(e) => setProductForm({ ...productForm, accounting_group_id: e.target.value })}
                      className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                      required
                    >
                      <option value="">{isArabic ? '— اختر مجموعة محاسبية —' : '— Select an accounting group —'}</option>
                      {accountingGroups.map(group => <option key={group.id} value={group.id}>{group.name}{group.tax_profiles?.name ? ` — ${group.tax_profiles.name}` : isArabic ? ' — يحتاج إعداد ضريبة' : ' — Tax setup required'}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={onManageAccountingGroups}
                      className="inline-flex justify-center items-center gap-2 px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-700 hover:border-amber-400 hover:text-amber-700 text-xs font-bold transition-colors"
                    >
                      <Settings2 className="w-4 h-4" />
                      {isArabic ? 'إدارة المجموعات' : 'Manage accounting groups'}
                    </button>
                  </div>
                  {!accountingGroups.length && <p className="text-[11px] text-amber-700 font-semibold">{isArabic ? 'أنشئ مجموعة محاسبية أولاً ثم اخترها للمنتج.' : 'Create an accounting group first, then assign it to this product.'}</p>}
                </section>
              </div>
              <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2.5 rounded-xl transition-all"
                >
                  {isArabic ? "حفظ" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 border border-slate-200 bg-white text-slate-600 font-bold text-xs py-2.5 rounded-xl hover:bg-slate-50 transition-all"
                >
                  {isArabic ? "إلغاء" : "Cancel"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODIFIER MODAL --- */}
      {modifierModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-850">
                {isArabic 
                  ? (editingModifier ? "تعديل الإضافة" : "إضافة خيار جديد") 
                  : (editingModifier ? "Edit Modifier" : "Add New Modifier")}
              </h3>
              <button onClick={() => setModifierModalOpen(false)} className="text-slate-450 hover:text-slate-850">✕</button>
            </div>
            <form onSubmit={handleSaveModifier}>
              <div className="p-5 space-y-4 text-right">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "اسم الإضافة" : "Modifier Name"}</label>
                  <input
                    type="text"
                    value={modifierForm.name}
                    onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })}
                    placeholder="مثال: جبن شيدر إضافي"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "فارق السعر (EUR)" : "Price Adjustment (EUR)"}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={modifierForm.price_adjustment}
                      onChange={(e) => setModifierForm({ ...modifierForm, price_adjustment: e.target.value })}
                      placeholder="1.50"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "المنتج التابع له" : "Link to Product"}</label>
                    <select
                      value={modifierForm.product_id}
                      onChange={(e) => setModifierForm({ ...modifierForm, product_id: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-amber-500"
                      required
                    >
                      <option value="">{isArabic ? "اختر منتج" : "Select Product"}</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2.5 rounded-xl transition-all"
                >
                  {isArabic ? "حفظ" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setModifierModalOpen(false)}
                  className="px-4 border border-slate-200 bg-white text-slate-600 font-bold text-xs py-2.5 rounded-xl hover:bg-slate-50 transition-all"
                >
                  {isArabic ? "إلغاء" : "Cancel"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
