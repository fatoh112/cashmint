import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import GroupConfigForm from './GroupConfigForm';
import ComboBuilderForm from './ComboBuilderForm';
import CsvImportModal from './CsvImportModal';
import { 
  Search, 
  ChevronDown, 
  Plus, 
  Trash2, 
  Edit2, 
  RefreshCw, 
  Layers, 
  Package,
  FileSpreadsheet
} from 'lucide-react';

export default function ItemsDashboard({ store, showNotification, isArabic }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('all'); // 'all', 'single', 'group'
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('active'); // 'active', 'archived'
  
  // Split Button Dropdown State
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Child Config Forms State
  const [groupConfigOpen, setGroupConfigOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [comboBuilderOpen, setComboBuilderOpen] = useState(false);

  // CSV Import Modal State
  const [csvModalOpen, setCsvModalOpen] = useState(false);

  const loadData = useCallback(async (isSilent = false) => {
    if (!store?.id) return;
    try {
      if (!isSilent) {
        setLoading(prev => items.length === 0 ? true : prev);
      }

      // Fetch Categories for this store only
      const { data: cats } = await supabase
        .from('categories')
        .select('*')
        .eq('store_id', store.id);
      setCategories(cats || []);

      // Fetch Products for this store only
      const { data: prods } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', store.id)
        .order('name');
      
      // Fetch Item Groups for this store only
      const { data: groups } = await supabase
        .from('item_groups')
        .select('*')
        .eq('store_id', store.id)
        .order('name');

      // Merge products and groups for high density list
      const combined = [
        ...(prods || []).map(p => ({ ...p, type: 'single', sku: p.sku || 'N/A' })),
        ...(groups || []).map(g => ({ ...g, type: 'group', price: g.group_price, category_id: 'group' }))
      ];
      setItems(combined);

    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ في تحميل الكتالوج المتقدم" : "Error loading advanced menu catalog", "error");
    } finally {
      setLoading(false);
    }
  }, [store?.id, isArabic, showNotification]);

  useEffect(() => {
    if (store?.id) {
      loadData(false);
    }
  }, [store?.id]);


  const handleDeleteItem = async (item) => {
    if (!confirm(isArabic ? `هل أنت متأكد من حذف ${item.name}؟` : `Are you sure you want to delete ${item.name}?`)) return;
    try {
      setLoading(true);
      const table = item.type === 'single' ? 'products' : 'item_groups';
      const { error } = await supabase.from(table).delete().eq('id', item.id);
      if (error) throw error;
      showNotification(isArabic ? "تم حذف العنصر بنجاح" : "Item deleted successfully");
      loadData();
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? "خطأ أثناء حذف العنصر" : "Error deleting item", "error");
    } finally {
      setLoading(false);
    }
  };

  // Filters logic
  const filteredItems = items.filter(item => {
    // 1. Tab filter
    const statusMatches = activeTab === 'active' ? true : false; // For now we list all as active, can support archived later
    
    // 2. Search query (by name, SKU, price)
    const query = searchQuery.toLowerCase();
    const nameMatch = item.name.toLowerCase().includes(query);
    const skuMatch = item.sku?.toLowerCase().includes(query) || false;
    const priceMatch = String(item.price).includes(query);
    const searchMatch = searchQuery === '' || nameMatch || skuMatch || priceMatch;

    // 3. Type filter
    const typeMatch = selectedType === 'all' || item.type === selectedType;

    // 4. Category filter
    const categoryMatch = selectedCategory === 'all' || item.category_id === selectedCategory;

    return statusMatches && searchMatch && typeMatch && categoryMatch;
  });

  if (groupConfigOpen) {
    return (
      <GroupConfigForm 
        store={store} 
        group={editingGroup} 
        onClose={() => {
          setGroupConfigOpen(false);
          setEditingGroup(null);
          loadData();
        }} 
        showNotification={showNotification}
        isArabic={isArabic}
      />
    );
  }

  if (comboBuilderOpen) {
    return <ComboBuilderForm store={store} showNotification={showNotification} isArabic={isArabic} onClose={() => { setComboBuilderOpen(false); loadData(); }} />;
  }

  return (
    <div className="space-y-5 text-right font-sans" dir={isArabic ? 'rtl' : 'ltr'}>
      
      {/* Sticky Header & Quick Actions Bar */}
      <div className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm z-20 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <span>{isArabic ? "إدارة بنود القائمة المتقدمة" : "Advanced Menu Management"}</span>
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">
            {isArabic ? "تكوين السلع الفردية، مجموعات الخيارات، وباقات الوجبات بنظام Lightspeed" : "Configure standalone items, choices groups, and bundles like Lightspeed"}
          </p>
        </div>

        {/* Action Controls & Primary Blue Split Button */}
        <div className="flex items-center gap-3 self-end sm:self-auto relative">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Menu Import Button */}
          <button
            onClick={() => setCsvModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 shadow-sm shadow-indigo-500/10"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{isArabic ? "استيراد من ملف CSV" : "Import from CSV"}</span>
          </button>

          {/* Primary Blue Split-Button */}
          <div className="inline-flex rounded-xl shadow-sm">
            <button
              onClick={() => {
                setEditingGroup(null);
                setGroupConfigOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-bold text-xs px-4 py-2.5 rounded-l-none rounded-r-xl transition-all flex items-center gap-2"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isArabic ? "إنشاء مجموعة خيارات" : "Create Item Group"}</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white p-2.5 rounded-r-none rounded-l-xl border-r border-blue-500 transition-all"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              
              {/* Dropdown Options */}
              {dropdownOpen && (
                <div className={`absolute ${isArabic ? 'left-0' : 'right-0'} mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden text-right py-1.5`}>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      showNotification(isArabic ? "ميزة إنشاء سلعة فردية مدمجة بالمنيو" : "Single item creation is handled in catalog panel", "info");
                    }}
                    className="w-full px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-right font-medium block"
                  >
                    {isArabic ? "سلعة فردية / Single Item" : "Single Item"}
                  </button>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setEditingGroup(null);
                      setGroupConfigOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-right font-medium block"
                  >
                    {isArabic ? "مجموعة خيارات / Item Group" : "Item Group"}
                  </button>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setComboBuilderOpen(true);
                    }}
                    className="w-full px-4 py-2.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-right font-medium block"
                  >
                    {isArabic ? "باقة كومبو / Combo Pack" : "Combo Pack"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SEARCH BAR & FILTER DROPDOWNS BAR */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isArabic ? "البحث بالاسم، الرمز SKU، أو السعر..." : "Search by name, SKU, price..."}
            className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-blue-500 text-xs font-semibold text-slate-800 dark:text-white placeholder-slate-350 dark:placeholder-slate-500"
          />
        </div>

        {/* Filters & Tabs */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          
          {/* Active/Archived Tabs */}
          <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'active' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              {isArabic ? "نشط" : "Active"}
            </button>
            <button
              onClick={() => setActiveTab('archived')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'archived' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              {isArabic ? "مؤرشف" : "Archived"}
            </button>
          </div>

          {/* Type Select */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-650 dark:text-slate-200 bg-white dark:bg-slate-900"
          >
            <option value="all">{isArabic ? "كل الأنواع" : "All Types"}</option>
            <option value="single">{isArabic ? "سلعة فردية" : "Single Item"}</option>
            <option value="group">{isArabic ? "مجموعة خيارات" : "Choices Group"}</option>
          </select>

          {/* Category Select */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-650 dark:text-slate-200 bg-white dark:bg-slate-900"
          >
            <option value="all">{isArabic ? "كل الفئات" : "All Categories"}</option>
            <option value="group">{isArabic ? "مجموعات خيارات فقط" : "Choices Groups Only"}</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

        </div>
      </div>

      {/* HIGH DENSITY DATA TABLE */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-400 dark:text-slate-400 font-bold border-b border-slate-150 dark:border-slate-700 uppercase">
              <tr>
                <th className="p-4">{isArabic ? "اسم البند" : "Item Name"}</th>
                <th className="p-4">{isArabic ? "الرمز SKU" : "SKU"}</th>
                <th className="p-4">{isArabic ? "نوع البند" : "Type"}</th>
                <th className="p-4">{isArabic ? "قيمة البند / السعر" : "Price"}</th>
                <th className="p-4">{isArabic ? "إعدادات الربط" : "Configuration"}</th>
                <th className="p-4 text-center">{isArabic ? "إجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-medium text-slate-700 dark:text-slate-200">
              {filteredItems.map(item => (
                <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-750/50 transition-all">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${item.type === 'single' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-500 dark:text-amber-400' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-500 dark:text-blue-400'}`}>
                        {item.type === 'single' ? <Package className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 dark:text-white">{item.name}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-400 font-semibold">ID: {item.id.substring(0, 8)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 font-mono text-slate-500 dark:text-slate-400">{item.sku || 'N/A'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      item.type === 'single' ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300' : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                    }`}>
                      {item.type === 'single' ? (isArabic ? 'سلعة فردية' : 'Single') : (isArabic ? 'مجموعة خيارات' : 'Choices Group')}
                    </span>
                  </td>
                  <td className="p-4 font-black text-slate-800 dark:text-white">
                    {parseFloat(item.price || 0).toFixed(2)} €
                  </td>
                  <td className="p-4 text-slate-450 dark:text-slate-400 leading-normal">
                    {item.type === 'group' ? (
                      <div>
                        <span className="font-semibold text-[10px] text-slate-500 dark:text-slate-400">
                          {item.is_required ? (isArabic ? 'إلزامي' : 'Required') : (isArabic ? 'اختياري' : 'Optional')}
                        </span>
                        <span className="mx-1 text-slate-300 dark:text-slate-600">|</span>
                        <span className="font-mono text-[9px]">
                          Min: {item.min_items} / Max: {item.max_items || 'No max'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px]">{isArabic ? "سعر كتالوج ثابت" : "Standard catalog price"}</span>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="flex justify-center gap-2.5">
                      <button
                        onClick={() => {
                          if (item.type === 'group') {
                            setEditingGroup(item);
                            setGroupConfigOpen(true);
                          } else {
                            showNotification(isArabic ? "يرجى تعديل السلع الفردية عبر لوحة الكتالوج" : "Use catalog tab to edit standalone product fields", "info");
                          }
                        }}
                        className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center transition-all"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item)}
                        className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan="6" className="p-10 text-center text-slate-400 font-bold">
                    {isArabic ? "لم يتم العثور على أي بنود مطابقة" : "No items matched current filter parameters"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        store={store}
        showNotification={showNotification}
        isArabic={isArabic}
        onSuccess={loadData}
        onImportComplete={loadData}
      />

    </div>
  );
}
