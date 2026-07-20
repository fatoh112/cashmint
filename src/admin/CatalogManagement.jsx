import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { buildProductPayload, canSubmitProductForm, emptyProductForm } from '../utils/productTaxForm';
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
  const [itemSearch, setItemSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [bulkGroupId, setBulkGroupId] = useState('');
  const [bulkCategoryId, setBulkCategoryId] = useState('');

  // Modal States
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryNameAr, setCategoryNameAr] = useState('');

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [savingProduct, setSavingProduct] = useState(false);

  // Inline Custom Group State inside Product Modal
  const [showInlineCustomGroup, setShowInlineCustomGroup] = useState(false);
  const [customGroupForm, setCustomGroupForm] = useState({
    name: '',
    dine_in_rate: '12',
    takeaway_rate: '6'
  });
  const [savingCustomGroup, setSavingCustomGroup] = useState(false);

  const [modifierModalOpen, setModifierModalOpen] = useState(false);
  const [editingModifier, setEditingModifier] = useState(null);
  const [modifierForm, setModifierForm] = useState({
    product_id: '',
    name: '',
    price_adjustment: '0.00'
  });

  const fetchCatalog = useCallback(async (isSilent = false) => {
    if (!store?.id) return;
    try {
      if (!isSilent) {
        setLoading(prev => categories.length === 0 && products.length === 0 ? true : prev);
      }
      
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
      const { data: groups, error: groupsErr } = await supabase.from('accounting_groups').select('id,name,is_default,tax_profiles(name,dine_in_tax_rate:tax_rates!tax_profiles_dine_in_tax_rate_id_fkey(rate),takeaway_tax_rate:tax_rates!tax_profiles_takeaway_tax_rate_id_fkey(rate))').eq('store_id', store.id).eq('is_active', true).order('name');
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
  }, [store?.id, isArabic, showNotification]);

  const accountingGroupLabel = (group) => {
    if (!group) return isArabic ? 'يحتاج إعداد الضريبة' : 'Needs configuration';
    const profile = group.tax_profiles;
    const dineIn = profile?.dine_in_tax_rate?.rate;
    const takeaway = profile?.takeaway_tax_rate?.rate;

    if (group.is_internal || group.name?.startsWith('__direct_vat_')) {
      return `${isArabic ? 'ضريبة مباشرة للمنتج' : 'Direct Product VAT'} — ${isArabic ? 'صالة' : 'Dine-in'} ${dineIn ?? '—'}% · ${isArabic ? 'سفري' : 'Takeaway'} ${takeaway ?? '—'}%`;
    }

    let groupName = group.name;
    if (isArabic) {
      if (groupName === 'Food') groupName = 'طعام';
      else if (groupName === 'Alcohol') groupName = 'كحوليات';
      else if (groupName === 'Soft Drinks' || groupName === 'Non-Alcoholic Drinks') groupName = 'المشروبات غير الكحولية';
      else if (groupName === 'Tax Exempt') groupName = 'معفى من الضريبة';
    } else if (groupName === 'Soft Drinks') {
      groupName = 'Non-Alcoholic Drinks';
    }

    if (!profile) return `${groupName} — ${isArabic ? 'يحتاج إعداد ضريبة' : 'Tax setup required'}`;
    return `${groupName} — ${isArabic ? 'صالة' : 'Dine-in'} ${dineIn ?? '—'}% · ${isArabic ? 'سفري' : 'Takeaway'} ${takeaway ?? '—'}%`;
  };

  const selectableAccountingGroups = accountingGroups.filter(g => !g.is_internal && g.name !== 'Other' && g.name !== 'Unassigned / Legacy' && !g.name?.startsWith('__direct_vat_'));
  const selectedAccountingGroup = accountingGroups.find(group => group.id === productForm.accounting_group_id);
  const selectedAccountingProfile = selectedAccountingGroup?.tax_profiles;
  const defaultGroupId = selectableAccountingGroups.find(g => g.is_default)?.id || selectableAccountingGroups[0]?.id || '';

  useEffect(() => {
    if (store?.id) {
      fetchCatalog(false);
    }
  }, [store?.id]);

  // --- Category CRUD ---
  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!categoryName?.trim()) return;

    try {
      const payload = {
        name: categoryName.trim(),
        name_ar: categoryNameAr.trim() || null
      };

      if (editingCategory) {
        // Update
        const { error } = await supabase
          .from('categories')
          .update(payload)
          .eq('id', editingCategory.id);
        if (error) throw error;
        showNotification(isArabic ? "تم تحديث الفئة بنجاح" : "Category updated successfully");
      } else {
        // Create
        const { error } = await supabase
          .from('categories')
          .insert({ ...payload, store_id: store.id });
        if (error) throw error;
        showNotification(isArabic ? "تم إضافة الفئة بنجاح" : "Category added successfully");
      }
      setCategoryModalOpen(false);
      setCategoryName('');
      setCategoryNameAr('');
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

  // Direct Per-Product VAT State
  const [directVatForm, setDirectVatForm] = useState({
    dine_in_rate: '12',
    takeaway_rate: '6'
  });

  const resolveOrCreateInternalDirectVatGroup = async (dineInRate, takeawayRate) => {
    const dineInNum = Number(dineInRate);
    const takeawayNum = Number(takeawayRate);
    const internalName = `__direct_vat_${dineInNum}_${takeawayNum}`;

    let { data: existingGroup } = await supabase
      .from('accounting_groups')
      .select('id')
      .eq('store_id', store.id)
      .eq('name', internalName)
      .maybeSingle();

    if (existingGroup) {
      return existingGroup.id;
    }

    let { data: rDine } = await supabase.from('tax_rates').select('id').eq('store_id', store.id).eq('rate', dineInNum).maybeSingle();
    if (!rDine) {
      const { data: newRDine, error: rDineErr } = await supabase.from('tax_rates').insert({ store_id: store.id, name: `VAT ${dineInNum}%`, rate: dineInNum, is_active: true }).select('id').single();
      if (rDineErr) throw rDineErr;
      rDine = newRDine;
    }

    let { data: rTake } = await supabase.from('tax_rates').select('id').eq('store_id', store.id).eq('rate', takeawayNum).maybeSingle();
    if (!rTake) {
      const { data: newRTake, error: rTakeErr } = await supabase.from('tax_rates').insert({ store_id: store.id, name: `VAT ${takeawayNum}%`, rate: takeawayNum, is_active: true }).select('id').single();
      if (rTakeErr) throw rTakeErr;
      rTake = newRTake;
    }

    const profileName = `Direct VAT Profile (${dineInNum}% / ${takeawayNum}%)`;
    let { data: pExist } = await supabase.from('tax_profiles').select('id').eq('store_id', store.id).eq('dine_in_tax_rate_id', rDine.id).eq('takeaway_tax_rate_id', rTake.id).maybeSingle();
    if (!pExist) {
      const { data: newP, error: newPErr } = await supabase.from('tax_profiles').insert({ store_id: store.id, name: profileName, dine_in_tax_rate_id: rDine.id, takeaway_tax_rate_id: rTake.id, is_active: true }).select('id').single();
      if (newPErr) throw newPErr;
      pExist = newP;
    }

    const { data: newInternalGroup, error: groupErr } = await supabase.from('accounting_groups').insert({
      store_id: store.id,
      name: internalName,
      tax_profile_id: pExist.id,
      is_active: true,
      is_default: false,
      is_internal: true
    }).select('id').single();

    if (groupErr) throw groupErr;
    return newInternalGroup.id;
  };

  // --- Product CRUD ---
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (savingProduct) return;

    if (!productForm.category_id) {
      showNotification(isArabic ? 'يرجى اختيار فئة صالحة للمنتج' : 'Please select a valid category for the product', 'error');
      return;
    }

    let targetGroupId = productForm.accounting_group_id;
    if (targetGroupId === '__create_custom_group__') {
      showNotification(isArabic ? 'يرجى إكمال إنشاء المجموعة المخصصة أو اختيار مجموعة أخرى' : 'Please complete custom group creation or select another group', 'error');
      return;
    }

    if (!targetGroupId) {
      showNotification(isArabic ? 'يرجى اختيار مجموعة محاسبية صالحة أو تحديد الضريبة مباشرة للمنتج' : 'Please select a valid Accounting Group or set direct VAT for product', 'error');
      return;
    }

    try {
      setSavingProduct(true);
      if (targetGroupId === '__product_direct_vat__') {
        targetGroupId = await resolveOrCreateInternalDirectVatGroup(directVatForm.dine_in_rate, directVatForm.takeaway_rate);
      }

      const payload = {
        name: productForm.name.trim(),
        name_ar: productForm.name_ar?.trim() || null,
        category_id: productForm.category_id || null,
        price: parseFloat(productForm.price),
        accounting_group_id: targetGroupId
      };

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editingProduct.id)
          .eq('store_id', store.id);
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
      setProductForm({ ...emptyProductForm, category_id: '', accounting_group_id: defaultGroupId || '' });
      await fetchCatalog(true);
    } catch (err) {
      console.error("Supabase error saving product:", err);
      const errMsg = err?.message || err?.details || err?.hint || (isArabic ? "خطأ أثناء حفظ المنتج" : "Error saving product");
      showNotification(errMsg, "error");
    } finally {
      setSavingProduct(false);
    }
  };

  const handleCreateInlineCustomGroup = async (e) => {
    e.preventDefault();
    const name = customGroupForm.name?.trim();
    if (!name) {
      showNotification(isArabic ? 'يرجى إدخال اسم المجموعة المخصصة.' : 'Please enter a custom group name.', 'error');
      return;
    }

    const lowerName = name.toLowerCase();
    if (lowerName === 'other' || lowerName === 'unassigned' || lowerName === 'unassigned / legacy') {
      showNotification(isArabic ? 'هذا الاسم محجوز، يرجى اختيار اسم آخر.' : 'This name is reserved, please choose another name.', 'error');
      return;
    }

    const duplicate = accountingGroups.some(g => g.name.trim().toLowerCase() === lowerName);
    if (duplicate) {
      showNotification(isArabic ? 'توجد مجموعة بهذا الاسم بالفعل.' : 'An accounting group with this name already exists.', 'error');
      return;
    }

    try {
      setSavingCustomGroup(true);
      const dineInNum = Number(customGroupForm.dine_in_rate);
      const takeawayNum = Number(customGroupForm.takeaway_rate);

      // 1. Ensure tax rate rows exist
      let { data: rDine } = await supabase.from('tax_rates').select('id').eq('store_id', store.id).eq('rate', dineInNum).maybeSingle();
      if (!rDine) {
        const { data: newRDine, error: rDineErr } = await supabase.from('tax_rates').insert({ store_id: store.id, name: `VAT ${dineInNum}%`, rate: dineInNum, is_active: true }).select('id').single();
        if (rDineErr) throw rDineErr;
        rDine = newRDine;
      }

      let { data: rTake } = await supabase.from('tax_rates').select('id').eq('store_id', store.id).eq('rate', takeawayNum).maybeSingle();
      if (!rTake) {
        const { data: newRTake, error: rTakeErr } = await supabase.from('tax_rates').insert({ store_id: store.id, name: `VAT ${takeawayNum}%`, rate: takeawayNum, is_active: true }).select('id').single();
        if (rTakeErr) throw rTakeErr;
        rTake = newRTake;
      }

      // 2. Ensure tax profile row exists
      const profileName = `Tax Profile (${dineInNum}% / ${takeawayNum}%)`;
      let { data: pExist } = await supabase.from('tax_profiles').select('id').eq('store_id', store.id).eq('dine_in_tax_rate_id', rDine.id).eq('takeaway_tax_rate_id', rTake.id).maybeSingle();
      if (!pExist) {
        const { data: newP, error: newPErr } = await supabase.from('tax_profiles').insert({ store_id: store.id, name: profileName, dine_in_tax_rate_id: rDine.id, takeaway_tax_rate_id: rTake.id, is_active: true }).select('id').single();
        if (newPErr) throw newPErr;
        pExist = newP;
      }

      // 3. Create accounting_groups row
      const { data: newGroup, error: groupErr } = await supabase.from('accounting_groups').insert({
        store_id: store.id,
        name: name,
        tax_profile_id: pExist.id,
        is_active: true,
        is_default: false
      }).select('id').single();

      if (groupErr) throw groupErr;

      // 4. Refresh catalog & assign to current product form
      await fetchCatalog();
      setProductForm(prev => ({ ...prev, accounting_group_id: newGroup.id }));
      setShowInlineCustomGroup(false);
      showNotification(isArabic ? 'تم إنشاء المجموعة المحاسبية وتعيينها للمنتج بنجاح' : 'Custom accounting group created and assigned to product', 'success');

    } catch (err) {
      console.error(err);
      showNotification(err.message || (isArabic ? 'خطأ أثناء إنشاء المجموعة المخصصة' : 'Error creating custom group'), 'error');
    } finally {
      setSavingCustomGroup(false);
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

  const visibleProducts = products.filter(product => {
    const query = itemSearch.trim().toLowerCase();
    return (!query || product.name.toLowerCase().includes(query))
      && (categoryFilter === 'all' || product.category_id === categoryFilter)
      && (groupFilter === 'all' || product.accounting_group_id === groupFilter);
  });
  const toggleProductSelection = (id) => setSelectedProductIds(current => current.includes(id) ? current.filter(selected => selected !== id) : [...current, id]);
  const toggleVisibleProducts = () => setSelectedProductIds(current => visibleProducts.every(product => current.includes(product.id)) ? current.filter(id => !visibleProducts.some(product => product.id === id)) : [...new Set([...current, ...visibleProducts.map(product => product.id)])]);
  const applyBulkActions = async () => {
    if (selectedProductIds.length === 0) return;
    if (!bulkCategoryId && !bulkGroupId) {
      showNotification(isArabic ? 'يرجى اختيار فئة أو مجموعة محاسبية لتطبيق التغيير.' : 'Please select a category or an accounting group to apply changes.', 'error');
      return;
    }

    const payload = {};
    if (bulkCategoryId) payload.category_id = bulkCategoryId;
    if (bulkGroupId) {
      payload.accounting_group_id = bulkGroupId;
      payload.accounting_group_is_override = true;
    }

    const catObj = categories.find(c => c.id === bulkCategoryId);
    const grpObj = selectableAccountingGroups.find(g => g.id === bulkGroupId);

    let confirmMsg = isArabic
      ? `هل أنت متأكد من تطبيق التحديثات على ${selectedProductIds.length} منتج؟`
      : `Are you sure you want to update ${selectedProductIds.length} products?`;

    if (bulkCategoryId && catObj) {
      confirmMsg += `\n- ${isArabic ? 'الفئة الجديدة' : 'New Category'}: ${catObj.name}`;
    }
    if (bulkGroupId && grpObj) {
      confirmMsg += `\n- ${isArabic ? 'المجموعة المحاسبية الجديدة' : 'New Accounting Group'}: ${accountingGroupLabel(grpObj)}`;
    }

    if (!confirm(confirmMsg)) return;

    try {
      setLoading(true);
      const { error } = await supabase
        .from('products')
        .update(payload)
        .in('id', selectedProductIds)
        .eq('store_id', store.id);

      if (error) throw error;

      showNotification(
        isArabic
          ? `تم تحديث ${selectedProductIds.length} منتج بنجاح`
          : `Successfully updated ${selectedProductIds.length} products`
      );
      setSelectedProductIds([]);
      setBulkCategoryId('');
      setBulkGroupId('');
      await fetchCatalog(true);
    } catch (err) {
      console.error(err);
      showNotification(err.message || (isArabic ? 'خطأ أثناء التحديث الجماعي' : 'Error performing bulk update'), 'error');
    } finally {
      setLoading(false);
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">
            {isArabic ? "إدارة الكتالوج والمنيو" : "Catalog & Menu Management"}
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">
            {isArabic ? "إضافة وتعديل الفئات، المنتجات، والإضافات للمطعم" : "Add or edit categories, products, and add-ons for your store"}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl shrink-0">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-lg font-bold text-xs transition-all ${
              activeTab === 'products' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-white'
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
              activeTab === 'categories' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-white'
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
              activeTab === 'modifiers' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-white'
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
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-400">{isArabic ? "جاري التحميل..." : "Loading catalog..."}</p>
        </div>
      ) : (
        <>
          {/* --- PRODUCTS TAB --- */}
          {activeTab === 'products' && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                <span className="font-extrabold text-sm text-slate-700 dark:text-slate-200">
                  {isArabic ? `المنتجات المتوفرة (${products.length})` : `Products List (${products.length})`}
                </span>
                <button
                  onClick={() => {
                    setEditingProduct(null);
                    setShowInlineCustomGroup(false);
                    setProductForm({ ...emptyProductForm, category_id: '', accounting_group_id: defaultGroupId || '' });
                    setProductModalOpen(true);
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 active:scale-95 transition-all shadow-sm shadow-amber-500/10"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isArabic ? "إضافة منتج جديد" : "Add Product"}</span>
                </button>
              </div>

              <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 space-y-3">
                <input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder={isArabic ? 'ابحث بالاسم أو SKU أو السعر...' : 'Search by name, SKU or price...'} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white px-4 py-3 text-xs font-semibold focus:outline-none focus:border-amber-500" />
                <div className="flex flex-wrap gap-2">
                  <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-3 py-2 text-xs font-bold"><option value="all">{isArabic ? 'كل الفئات' : 'All categories'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                  <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-3 py-2 text-xs font-bold"><option value="all">{isArabic ? 'كل المجموعات الحسابية' : 'All accounting groups'}</option>{selectableAccountingGroups.map(group => <option key={group.id} value={group.id}>{accountingGroupLabel(group)}</option>)}</select>
                  {selectedProductIds.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-2 shadow-sm">
                      <span className="px-2.5 py-1 text-xs font-black text-amber-900 dark:text-amber-300 bg-amber-200/60 dark:bg-amber-900/60 rounded-lg">
                        {selectedProductIds.length} {isArabic ? 'محدد' : 'selected'}
                      </span>
                      
                      <select
                        value={bulkCategoryId}
                        onChange={(e) => setBulkCategoryId(e.target.value)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                      >
                        <option value="">{isArabic ? '— تغيير الفئة —' : '— Change category —'}</option>
                        {categories.map(category => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>

                      <select
                        value={bulkGroupId}
                        onChange={(e) => setBulkGroupId(e.target.value)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                      >
                        <option value="">{isArabic ? '— تعيين مجموعة —' : '— Assign group —'}</option>
                        {selectableAccountingGroups.map(group => (
                          <option key={group.id} value={group.id}>{accountingGroupLabel(group)}</option>
                        ))}
                      </select>

                      <button
                        onClick={applyBulkActions}
                        disabled={!bulkCategoryId && !bulkGroupId}
                        className="rounded-lg bg-amber-500 hover:bg-amber-600 px-3.5 py-1.5 text-xs font-extrabold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        {isArabic ? 'تطبيق' : 'Apply'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-400 font-bold border-b border-slate-150 dark:border-slate-700 uppercase">
                    <tr>
                      <th className="p-4 w-10"><input type="checkbox" checked={visibleProducts.length > 0 && visibleProducts.every(product => selectedProductIds.includes(product.id))} onChange={toggleVisibleProducts} /></th>
                      <th className="p-4">{isArabic ? "اسم المنتج" : "Name"}</th>
                      <th className="p-4">{isArabic ? "الفئة" : "Category"}</th>
                      <th className="p-4">{isArabic ? "السعر" : "Price"}</th>
                      <th className="p-4">{isArabic ? "مجموعة المحاسبة" : "Accounting Group"}</th>
                      <th className="p-4 text-center">{isArabic ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-medium text-slate-700 dark:text-slate-200">
                    {visibleProducts.map(product => {
                      const categoryName = categories.find(c => c.id === product.category_id)?.name || '-';
                      const assignedGroup = accountingGroups.find(group => group.id === product.accounting_group_id);
                      const needsConfig = !assignedGroup || assignedGroup.name === 'Other' || assignedGroup.name === 'Unassigned / Legacy';

                      return (
                        <tr key={product.id} className="hover:bg-slate-50/55 dark:hover:bg-slate-750/50 transition-all">
                          <td className="p-4"><input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={() => toggleProductSelection(product.id)} /></td>
                          <td className="p-4">
                            <div className="font-bold text-slate-800 dark:text-white">{product.name}</div>
                            {product.name_ar && (
                              <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">{product.name_ar}</div>
                            )}
                          </td>
                          <td className="p-4 text-slate-500 dark:text-slate-400">{categoryName}</td>
                          <td className="p-4 font-black text-slate-800 dark:text-white">{parseFloat(product.price).toFixed(2)} €</td>
                          <td className="p-4">
                            {needsConfig ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                {isArabic ? 'يحتاج إعداد الضريبة' : 'Needs configuration'}
                              </span>
                            ) : (
                              <span className="text-slate-600 dark:text-slate-200 font-semibold">{accountingGroupLabel(assignedGroup)}</span>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex justify-center gap-2.5">
                              <button
                                onClick={() => {
                                  setEditingProduct(product);
                                  setShowInlineCustomGroup(false);
                                  const isInternalDirectVat = assignedGroup?.is_internal || assignedGroup?.name?.startsWith('__direct_vat_');

                                  if (isInternalDirectVat) {
                                    const profile = assignedGroup?.tax_profiles;
                                    const dineIn = profile?.dine_in_tax_rate?.rate ?? 12;
                                    const takeaway = profile?.takeaway_tax_rate?.rate ?? 6;

                                    setDirectVatForm({
                                      dine_in_rate: String(dineIn),
                                      takeaway_rate: String(takeaway)
                                    });
                                    setProductForm({
                                      name: product.name,
                                      name_ar: product.name_ar || '',
                                      category_id: product.category_id || '',
                                      price: product.price,
                                      accounting_group_id: '__product_direct_vat__',
                                      is_available: product.is_available ?? true
                                    });
                                  } else {
                                    setProductForm({
                                      name: product.name,
                                      name_ar: product.name_ar || '',
                                      category_id: product.category_id || '',
                                      price: product.price,
                                      accounting_group_id: needsConfig ? '' : (product.accounting_group_id || ''),
                                      is_available: product.is_available ?? true
                                    });
                                  }
                                  setProductModalOpen(true);
                                }}
                                className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-all"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(product.id)}
                                className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-all"
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
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                <span className="font-extrabold text-sm text-slate-700 dark:text-slate-200">
                  {isArabic ? `فئات المنيو (${categories.length})` : `Categories (${categories.length})`}
                </span>
                <button
                  onClick={() => {
                    setEditingCategory(null);
                    setCategoryName('');
                    setCategoryNameAr('');
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
                  <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-400 dark:text-slate-400 font-bold border-b border-slate-150 dark:border-slate-700 uppercase">
                    <tr>
                      <th className="p-4">{isArabic ? "اسم الفئة" : "Category Name"}</th>
                      <th className="p-4">{isArabic ? "تاريخ الإنشاء" : "Created At"}</th>
                      <th className="p-4 text-center">{isArabic ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-medium text-slate-700 dark:text-slate-200">
                    {categories.map(category => (
                      <tr key={category.id} className="hover:bg-slate-50/55 dark:hover:bg-slate-750/50 transition-all">
                        <td className="p-4">
                          <div className="font-bold text-slate-800 dark:text-white">{category.name}</div>
                          {category.name_ar && (
                            <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">{category.name_ar}</div>
                          )}
                        </td>
                        <td className="p-4 text-slate-450 dark:text-slate-400">{new Date(category.created_at).toLocaleDateString()}</td>
                        <td className="p-4">
                          <div className="flex justify-center gap-2.5">
                            <button
                              onClick={() => {
                                setEditingCategory(category);
                                setCategoryName(category.name);
                                setCategoryNameAr(category.name_ar || '');
                                setCategoryModalOpen(true);
                              }}
                              className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-all"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(category.id)}
                              className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-all"
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
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                <span className="font-extrabold text-sm text-slate-700 dark:text-slate-200">
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
                  <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-400 dark:text-slate-400 font-bold border-b border-slate-150 dark:border-slate-700 uppercase">
                    <tr>
                      <th className="p-4">{isArabic ? "اسم الإضافة" : "Modifier Name"}</th>
                      <th className="p-4">{isArabic ? "تابع لمنتج" : "Belongs to Product"}</th>
                      <th className="p-4">{isArabic ? "فارق السعر" : "Price Adjustment"}</th>
                      <th className="p-4 text-center">{isArabic ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-medium text-slate-700 dark:text-slate-200">
                    {modifiers.map(modifier => {
                      const prodName = products.find(p => p.id === modifier.product_id)?.name || '-';
                      return (
                        <tr key={modifier.id} className="hover:bg-slate-50/55 dark:hover:bg-slate-750/50 transition-all">
                          <td className="p-4 font-bold text-slate-800 dark:text-white">{modifier.name}</td>
                          <td className="p-4 text-slate-550 dark:text-slate-400">{prodName}</td>
                          <td className="p-4 font-bold text-emerald-600 dark:text-emerald-400">+{parseFloat(modifier.price_adjustment).toFixed(2)} €</td>
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
                                className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-all"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteModifier(modifier.id)}
                                className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-all"
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-sm w-full shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-850 dark:text-white">
                {isArabic 
                  ? (editingCategory ? "تعديل الفئة" : "إضافة فئة جديدة") 
                  : (editingCategory ? "Edit Category" : "Add New Category")}
              </h3>
              <button onClick={() => setCategoryModalOpen(false)} className="text-slate-450 hover:text-slate-850 dark:hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSaveCategory}>
              <div className="p-5 space-y-4 text-right">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "اسم الفئة الرئيسية (الإنجليزية / العامة)" : "Category Primary Name"}</label>
                  <input
                    type="text"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder="مثال: Beverages, Burgers"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "اسم الفئة بالعربية (اختياري)" : "Arabic Name (Optional)"}</label>
                  <input
                    type="text"
                    value={categoryNameAr}
                    onChange={(e) => setCategoryNameAr(e.target.value)}
                    placeholder="مثال: مشروبات، برجر"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div className="p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2.5 rounded-xl transition-all"
                >
                  {isArabic ? "حفظ" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryModalOpen(false)}
                  className="px-4 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-xl w-full shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-850 dark:text-white">
                {isArabic 
                  ? (editingProduct ? "تعديل المنتج" : "إضافة منتج جديد") 
                  : (editingProduct ? "Edit Product" : "Add New Product")}
              </h3>
              <button onClick={() => setProductModalOpen(false)} className="text-slate-450 hover:text-slate-850 dark:hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSaveProduct}>
              <div className="p-5 space-y-4 text-right">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "اسم المنتج (الأساسي)" : "Primary Product Name"}</label>
                    <input
                      type="text"
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                      placeholder="e.g. Espresso, Double Cheeseburger"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "الاسم بالعربية (اختياري)" : "Arabic Name (Optional)"}</label>
                    <input
                      type="text"
                      value={productForm.name_ar || ''}
                      onChange={(e) => setProductForm({ ...productForm, name_ar: e.target.value })}
                      placeholder="مثال: إسبريسو، تشيز برجر دبل"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
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
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "الفئة" : "Category"}</label>
                    <select
                      value={productForm.category_id}
                      onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                      required
                    >
                      <option value="" disabled>{isArabic ? "اختر فئة" : "Choose category"}</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <label className="text-xs font-black text-slate-800 dark:text-white block">{isArabic ? "مجموعة المحاسبة" : "Accounting Group"}</label>
                      <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400 mt-1">
                        {isArabic ? "تحدد هذه المجموعة ملف الضريبة المشترك للمنتج حسب محلي أو سفري." : "This group applies the shared tax profile for dine-in and takeaway orders."}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-rose-500 whitespace-nowrap">{isArabic ? "مطلوب" : "Required"}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={showInlineCustomGroup ? '__create_custom_group__' : productForm.accounting_group_id}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__create_custom_group__') {
                          setShowInlineCustomGroup(true);
                        } else {
                          setShowInlineCustomGroup(false);
                          setProductForm({ ...productForm, accounting_group_id: val });
                        }
                      }}
                      className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                      required
                    >
                      <option value="" disabled>{isArabic ? '— اختر مجموعة محاسبية —' : '— Select an accounting group —'}</option>
                      {selectableAccountingGroups.map(group => <option key={group.id} value={group.id}>{accountingGroupLabel(group)}</option>)}
                      <option value="__product_direct_vat__" className="font-bold text-blue-600 bg-blue-50 dark:bg-slate-800">
                        {isArabic ? "⚡ تحديد الضريبة مباشرة للمنتج" : "⚡ Set VAT directly for product"}
                      </option>
                      <option value="__create_custom_group__" className="font-bold text-amber-600 bg-amber-50 dark:bg-slate-800">
                        {isArabic ? "➕ ضريبة أخرى / مجموعة مخصصة" : "➕ Other / Custom Group"}
                      </option>
                    </select>
                    <button
                      type="button"
                      onClick={onManageAccountingGroups}
                      className="inline-flex justify-center items-center gap-2 px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-amber-400 hover:text-amber-700 text-xs font-bold transition-colors"
                    >
                      <Settings2 className="w-4 h-4" />
                      {isArabic ? 'إدارة المجموعات' : 'Manage accounting groups'}
                    </button>
                  </div>

                  {productForm.accounting_group_id === '__product_direct_vat__' && !showInlineCustomGroup && (
                    <div className="mt-3 p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-right space-y-3">
                      <h4 className="font-black text-xs text-blue-900 dark:text-blue-200">
                        {isArabic ? "تحديد الضريبة مباشرة للمنتج" : "Set VAT Directly for Product"}
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 block">{isArabic ? "ضريبة الصالة" : "Dine-in VAT"}</label>
                          <select
                            value={directVatForm.dine_in_rate}
                            onChange={(e) => setDirectVatForm({ ...directVatForm, dine_in_rate: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                          >
                            {[21, 12, 6, 0].map(r => <option key={`direct-dine-${r}`} value={r}>{r}%</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 block">{isArabic ? "ضريبة السفري" : "Takeaway VAT"}</label>
                          <select
                            value={directVatForm.takeaway_rate}
                            onChange={(e) => setDirectVatForm({ ...directVatForm, takeaway_rate: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                          >
                            {[21, 12, 6, 0].map(r => <option key={`direct-take-${r}`} value={r}>{r}%</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {showInlineCustomGroup && (
                    <div className="mt-3 p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-right space-y-3">
                      <h4 className="font-black text-xs text-amber-900 dark:text-amber-200">
                        {isArabic ? "إنشاء مجموعة محاسبية مخصصة جديدة" : "Create New Custom Accounting Group"}
                      </h4>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{isArabic ? "اسم المجموعة" : "Group Name"}</label>
                        <input
                          type="text"
                          value={customGroupForm.name}
                          onChange={(e) => setCustomGroupForm({ ...customGroupForm, name: e.target.value })}
                          placeholder={isArabic ? "مثال: مخبوزات، Ice Cream" : "e.g. Bakery, Ice Cream"}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{isArabic ? "ضريبة الصالة" : "Dine-in VAT"}</label>
                          <select
                            value={customGroupForm.dine_in_rate}
                            onChange={(e) => setCustomGroupForm({ ...customGroupForm, dine_in_rate: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                          >
                            {[21, 12, 6, 0].map(r => <option key={`dine-${r}`} value={r}>{r}%</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{isArabic ? "ضريبة السفري" : "Takeaway VAT"}</label>
                          <select
                            value={customGroupForm.takeaway_rate}
                            onChange={(e) => setCustomGroupForm({ ...customGroupForm, takeaway_rate: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                          >
                            {[21, 12, 6, 0].map(r => <option key={`take-${r}`} value={r}>{r}%</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleCreateInlineCustomGroup}
                          disabled={savingCustomGroup}
                          className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition-colors disabled:opacity-50"
                        >
                          {savingCustomGroup ? (isArabic ? "جارٍ الإنشاء..." : "Creating...") : (isArabic ? "إنشاء المجموعة" : "Create Group")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowInlineCustomGroup(false)}
                          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          {isArabic ? "إلغاء" : "Cancel"}
                        </button>
                      </div>
                    </div>
                  )}

                  {!accountingGroups.length && <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">{isArabic ? 'أنشئ مجموعة محاسبية أولاً ثم اخترها للمنتج.' : 'Create an accounting group first, then assign it to this product.'}</p>}
                  {selectedAccountingGroup && !showInlineCustomGroup && (
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                      <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-700 dark:text-slate-200">
                        {isArabic ? 'صالة' : 'Dine-in'}: {selectedAccountingProfile?.dine_in_tax_rate?.rate ?? '—'}%
                      </div>
                      <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-700 dark:text-slate-200">
                        {isArabic ? 'سفري' : 'Takeaway'}: {selectedAccountingProfile?.takeaway_tax_rate?.rate ?? '—'}%
                      </div>
                    </div>
                  )}
                </section>
              </div>
              <div className="p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex gap-2">
                <button
                  type="submit"
                  disabled={!canSubmitProductForm(productForm, savingProduct)}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingProduct ? (isArabic ? "جارٍ الحفظ..." : "Saving...") : (isArabic ? "حفظ" : "Save")}
                </button>
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-850 dark:text-white">
                {isArabic 
                  ? (editingModifier ? "تعديل الإضافة" : "إضافة خيار جديد") 
                  : (editingModifier ? "Edit Modifier" : "Add New Modifier")}
              </h3>
              <button onClick={() => setModifierModalOpen(false)} className="text-slate-450 hover:text-slate-850 dark:hover:text-white">✕</button>
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
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
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "المنتج التابع له" : "Link to Product"}</label>
                    <select
                      value={modifierForm.product_id}
                      onChange={(e) => setModifierForm({ ...modifierForm, product_id: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
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
              <div className="p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs py-2.5 rounded-xl transition-all"
                >
                  {isArabic ? "حفظ" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setModifierModalOpen(false)}
                  className="px-4 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
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
