import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { Store, Plus, Edit2, Trash2, X, Check, Settings, Users } from 'lucide-react';
import CatalogManagerDrawer from './components/CatalogManagerDrawer';
import UserManagerDrawer from './components/UserManagerDrawer';

export default function StoresManagement({ showNotification, isArabic }) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Standard CRUD Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState(null); // null means creating
  const [storeName, setStoreName] = useState('');
  const [businessType, setBusinessType] = useState('restaurant');
  const [logoUrl, setLogoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Advanced Settings (God Mode) Modal states
  const [isGodModalOpen, setIsGodModalOpen] = useState(false);
  const [godStore, setGodStore] = useState(null);
  const [godStoreName, setGodStoreName] = useState('');
  const [godBusinessType, setGodBusinessType] = useState('restaurant');
  const [godThemeColor, setGodThemeColor] = useState('#00bcff');
  const [godLogoUrl, setGodLogoUrl] = useState('');
  const [godSubmitting, setGodSubmitting] = useState(false);

  // Catalog Management Drawer states
  const [isCatalogDrawerOpen, setIsCatalogDrawerOpen] = useState(false);
  const [catalogStoreId, setCatalogStoreId] = useState(null);
  const [catalogStoreName, setCatalogStoreName] = useState('');

  // User Management Drawer states
  const [isUserDrawerOpen, setIsUserDrawerOpen] = useState(false);
  const [userStoreId, setUserStoreId] = useState(null);
  const [userStoreName, setUserStoreName] = useState('');

  const fetchStores = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStores(data || []);
    } catch (err) {
      console.error('Error fetching stores:', err);
      showNotification(isArabic ? 'خطأ في جلب بيانات المتاجر' : 'Error fetching stores from database', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification, isArabic]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const handleOpenCreateModal = () => {
    setEditingStore(null);
    setStoreName('');
    setBusinessType('restaurant');
    setLogoUrl('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (store) => {
    setEditingStore(store);
    setStoreName(store.name || '');
    setBusinessType(store.business_type || 'restaurant');
    setLogoUrl(store.logo_url || '');
    setIsModalOpen(true);
  };

  const handleOpenGodModeModal = (store) => {
    setGodStore(store);
    setGodStoreName(store.name || '');
    setGodBusinessType(store.business_type || 'restaurant');
    setGodThemeColor(store.theme_color || '#00bcff');
    setGodLogoUrl(store.logo_url || '');
    setIsGodModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!storeName.trim()) {
      showNotification(isArabic ? 'الرجاء إدخال اسم المتجر' : 'Store name is required', 'error');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        name: storeName.trim(),
        business_type: businessType,
        logo_url: logoUrl.trim() || null,
        onboarding_status: editingStore?.onboarding_status || 'store_name_required',
        onboarding_completed: editingStore?.onboarding_completed || false,
        onboarding_completed_at: editingStore?.onboarding_completed_at || null
      };

      if (editingStore) {
        const { error } = await supabase
          .from('stores')
          .update(payload)
          .eq('id', editingStore.id);

        if (error) throw error;
        showNotification(isArabic ? 'تم تحديث بيانات المتجر بنجاح' : 'Store updated successfully');
      } else {
        const { error } = await supabase
          .from('stores')
          .insert([payload]);

        if (error) throw error;
        showNotification(isArabic ? 'تم إنشاء متجر جديد بنجاح' : 'New store tenant created successfully');
      }

      setIsModalOpen(false);
      fetchStores();
    } catch (err) {
      console.error('Error saving store:', err);
      const errMsg = err?.message || err?.details || (isArabic ? 'حدث خطأ أثناء الحفظ' : 'Error occurred while saving store');
      showNotification(isArabic ? `حدث خطأ أثناء الحفظ: ${errMsg}` : `Error saving store: ${errMsg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveGodMode = async (e) => {
    e.preventDefault();
    if (!godStoreName.trim()) {
      showNotification(isArabic ? 'الرجاء إدخال اسم المتجر' : 'Store name is required', 'error');
      return;
    }

    try {
      setGodSubmitting(true);
      const { error } = await supabase
        .from('stores')
        .update({
          name: godStoreName.trim(),
          business_type: godBusinessType,
          theme_color: godThemeColor.trim() || null,
          logo_url: godLogoUrl.trim() || null
        })
        .eq('id', godStore.id);

      if (error) throw error;
      showNotification(isArabic ? 'تم تحديث إعدادات التخصيص للمتجر' : 'Store customization settings updated successfully');
      setIsGodModalOpen(false);
      fetchStores();
    } catch (err) {
      console.error('Error saving advanced settings:', err);
      const errMsg = err?.message || err?.details || (isArabic ? 'خطأ في حفظ الإعدادات المتقدمة' : 'Error saving store advanced settings');
      showNotification(isArabic ? `خطأ في حفظ الإعدادات المتقدمة: ${errMsg}` : `Error saving store advanced settings: ${errMsg}`, 'error');
    } finally {
      setGodSubmitting(false);
    }
  };

  const handleDeleteStore = async (storeId, name) => {
    const confirmMsg = isArabic 
      ? `هل أنت متأكد من حذف متجر "${name}"؟ سيتم حذف جميع البيانات المرتبطة به.`
      : `Are you sure you want to delete store "${name}"? All associated data will be deleted.`;
      
    if (!window.confirm(confirmMsg)) return;

    try {
      setLoading(true);

      // 1. Fetch all store users to delete them from Supabase Auth
      const { data: storeUsers, error: fetchUsersErr } = await supabase
        .from('store_users')
        .select('user_id')
        .eq('store_id', storeId);

      if (fetchUsersErr) throw fetchUsersErr;

      // 2. Invoke admin-delete-user Edge Function for each user to clean up auth.users
      if (storeUsers && storeUsers.length > 0) {
        for (const u of storeUsers) {
          try {
            const { error: deleteUserErr } = await supabase.functions.invoke('admin-delete-user', {
              body: { user_id: u.user_id }
            });
            if (deleteUserErr) {
              console.error(`Failed to clean up auth user ${u.user_id}:`, deleteUserErr);
            }
          } catch (funcErr) {
            console.error(`Error invoking admin-delete-user function for user ${u.user_id}:`, funcErr);
          }
        }
      }

      // 3. Delete the store record
      const { error } = await supabase
        .from('stores')
        .delete()
        .eq('id', storeId);

      if (error) throw error;
      showNotification(isArabic ? 'تم حذف المتجر بنجاح' : 'Store tenant deleted successfully');
      fetchStores();
    } catch (err) {
      console.error('Error deleting store:', err);
      const errMsg = err?.message || err?.details || (isArabic ? 'فشل حذف المتجر' : 'Failed to delete store tenant');
      showNotification(isArabic ? `فشل حذف المتجر: ${errMsg}` : `Failed to delete store tenant: ${errMsg}`, 'error');
      setLoading(false);
    }
  };

  // Explicit bilingual store business type items
  const businessTypes = [
    { value: 'restaurant', label: 'Restaurant / مطعم' },
    { value: 'cafe', label: 'Cafe / كافيه' },
    { value: 'supermarket', label: 'Supermarket / سوبر ماركت' },
    { value: 'retail', label: 'Retail / تجزئة' }
  ];

  return (
    <div className="space-y-6">
      
      {/* Module Header */}
      <div className="flex justify-between items-center bg-slate-850 p-6 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-lg font-black text-white">
            {isArabic ? "إدارة المتاجر والمستأجرين" : "Stores & Tenants Management"}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isArabic ? "عرض وإنشاء وتعديل وحذف مستأجري النظام ونقاط البيع" : "Manage, create, update, and delete active stores on the platform"}
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="bg-cyan-500 hover:bg-cyan-600 active:scale-[0.98] text-slate-950 font-extrabold text-xs px-5 py-3 rounded-xl shadow-lg shadow-cyan-500/10 transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{isArabic ? "إنشاء متجر جديد" : "Create New Store"}</span>
        </button>
      </div>

      {/* Stores List Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {loading && stores.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-4">
            <div className="w-8 h-8 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
            <p className="text-xs font-bold text-slate-400">{isArabic ? "جاري تحميل المتاجر..." : "Loading stores list..."}</p>
          </div>
        ) : stores.length === 0 ? (
          <div className="p-12 text-center space-y-2.5">
            <Store className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-slate-350">{isArabic ? "لا توجد متاجر نشطة حالياً" : "No active store tenants found"}</p>
            <p className="text-xs text-slate-500">{isArabic ? "انقر على زر الإنشاء لإضافة متجر جديد" : "Click 'Create New Store' to register the first tenant"}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right" dir={isArabic ? "rtl" : "ltr"}>
              <thead>
                <tr className="border-b border-slate-800 bg-slate-850/50 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                  <th className="px-6 py-4">{isArabic ? "المعرف" : "ID"}</th>
                  <th className="px-6 py-4">{isArabic ? "اسم المتجر" : "Store Name"}</th>
                  <th className="px-6 py-4">{isArabic ? "نوع النشاط" : "Business Type"}</th>
                  <th className="px-6 py-4">{isArabic ? "لون الهوية" : "Theme Color"}</th>
                  <th className="px-6 py-4">{isArabic ? "تاريخ الإنشاء" : "Created At"}</th>
                  <th className="px-6 py-4 text-center">{isArabic ? "الإجراءات" : "Actions"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-semibold text-slate-300">
                {stores.map(store => (
                  <tr key={store.id} className="hover:bg-slate-850/30 transition-colors">
                    <td className="px-6 py-4 font-mono text-[10px] text-slate-500 select-all">{store.id.substring(0,8)}...</td>
                    <td className="px-6 py-4 font-extrabold text-white flex items-center gap-2">
                      {store.logo_url && (
                        <img src={store.logo_url} alt="Logo" className="w-6 h-6 rounded-lg bg-slate-800 border border-slate-750 object-contain p-0.5" />
                      )}
                      <span>{store.name || (isArabic ? 'بانتظار الإعداد' : 'Awaiting Setup')}</span>
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-400">
                      {businessTypes.find(t => t.value === store.business_type)?.label || store.business_type || 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 font-mono text-[10px]">
                        <span 
                          className="w-3.5 h-3.5 rounded border border-slate-700 shadow-sm block" 
                          style={{ backgroundColor: store.theme_color || '#00bcff' }}
                        />
                        <span className="text-slate-400">{store.theme_color || '#00bcff'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-400">{new Date(store.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            setUserStoreId(store.id);
                            setUserStoreName(store.name || '');
                            setIsUserDrawerOpen(true);
                          }}
                          className="p-2 hover:bg-slate-800 text-slate-450 hover:text-cyan-400 rounded-lg transition-colors cursor-pointer"
                          title={isArabic ? "إدارة مستخدمي المتجر" : "Manage Store Users"}
                        >
                          <Users className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleOpenGodModeModal(store)}
                          className="p-2 hover:bg-slate-800 text-slate-450 hover:text-amber-400 rounded-lg transition-colors cursor-pointer"
                          title={isArabic ? "إعدادات متقدمة (God Mode)" : "Advanced Customizations (God Mode)"}
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(store)}
                          className="p-2 hover:bg-slate-800 text-slate-450 hover:text-cyan-400 rounded-lg transition-colors cursor-pointer"
                          title={isArabic ? "تعديل أساسي" : "Basic Edit"}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteStore(store.id, store.name)}
                          className="p-2 hover:bg-slate-800 text-slate-450 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                          title={isArabic ? "حذف" : "Delete Store"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Basic CRUD Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[250] flex items-center justify-center p-4" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-6 text-right animate-fade-in">
            
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="font-extrabold text-base text-white">
                {editingStore 
                  ? (isArabic ? `تعديل متجر: ${editingStore.name}` : `Edit Store: ${editingStore.name}`)
                  : (isArabic ? "تسجيل متجر جديد" : "Register New Store")
                }
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">
                  {isArabic ? "اسم المتجر" : "Store Name"}
                </label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder={isArabic ? "اسم المتجر الجديد" : "Enter store name"}
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                  required
                />
              </div>

              {/* Logo URL */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">
                  {isArabic ? "رابط الشعار (Logo URL)" : "Brand Logo URL"}
                </label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">
                  {isArabic ? "نوع النشاط التجاري" : "Business Type"}
                </label>
                <select
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                >
                  {businessTypes.map(t => (
                    <option key={t.value} value={t.value} className="bg-slate-900 text-white">{t.label}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 bg-cyan-500 hover:bg-cyan-600 text-slate-950 rounded-xl font-extrabold text-xs shadow-lg shadow-cyan-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{editingStore ? (isArabic ? "حفظ التغييرات" : "Save Changes") : (isArabic ? "إنشاء المتجر" : "Create Store")}</span>
                  </>
                )}
              </button>
            </form>

          </div>
        </div>
      )}

      {/* Advanced Settings (God Mode) Modal */}
      {isGodModalOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-[250] flex items-center justify-center p-4" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full shadow-2xl p-6 space-y-6 text-right animate-fade-in">
            
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-extrabold text-base text-amber-400 flex items-center gap-1.5">
                  <Settings className="w-4.5 h-4.5 animate-spin-slow text-amber-400" />
                  <span>{isArabic ? "لوحة التخصيص المتقدمة (God Mode)" : "Advanced Customization (God Mode)"}</span>
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">
                  {isArabic ? `تعديل إعدادات الهوية البصرية للمتجر: ${godStore?.name}` : `Customize brand elements for: ${godStore?.name}`}
                </p>
              </div>
              <button
                onClick={() => setIsGodModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleSaveGodMode} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Store Name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">
                    {isArabic ? "اسم المتجر" : "Store Name"}
                  </label>
                  <input
                    type="text"
                    value={godStoreName}
                    onChange={(e) => setGodStoreName(e.target.value)}
                    placeholder={isArabic ? "اسم المتجر" : "Store name"}
                    className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                    required
                  />
                </div>

                {/* Business Type */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">
                    {isArabic ? "نوع النشاط التجاري" : "Business Type"}
                  </label>
                  <select
                    value={godBusinessType}
                    onChange={(e) => setGodBusinessType(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                  >
                    {businessTypes.map(t => (
                      <option key={t.value} value={t.value} className="bg-slate-900 text-white">{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Logo URL */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">
                  {isArabic ? "رابط الشعار (Logo URL)" : "Brand Logo URL"}
                </label>
                <input
                  type="url"
                  value={godLogoUrl}
                  onChange={(e) => setGodLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                  dir="ltr"
                />
              </div>

              {/* Theme Color */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">
                  {isArabic ? "لون الهوية البصرية (Theme Color)" : "Branding Theme Color"}
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={godThemeColor}
                    onChange={(e) => setGodThemeColor(e.target.value)}
                    placeholder="#00bcff"
                    className="flex-1 px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-mono font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                    dir="ltr"
                  />
                  <input
                    type="color"
                    value={godThemeColor.startsWith('#') && godThemeColor.length === 7 ? godThemeColor : '#00bcff'}
                    onChange={(e) => setGodThemeColor(e.target.value)}
                    className="w-14 h-11 bg-transparent border-0 cursor-pointer rounded-xl overflow-hidden shrink-0"
                  />
                </div>
              </div>

              {/* Advanced Actions Separator */}
              <div className="border-t border-slate-800 pt-4 mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCatalogStoreId(godStore?.id);
                    setCatalogStoreName(godStoreName.trim() || godStore?.name || '');
                    setIsCatalogDrawerOpen(true);
                    setIsGodModalOpen(false);
                  }}
                  className="w-full py-3 bg-slate-800 hover:bg-slate-750 active:scale-[0.99] text-cyan-400 rounded-xl font-bold text-xs border border-cyan-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Store className="w-4.5 h-4.5" />
                  <span>{isArabic ? "إدارة كتالوج المنتجات" : "Manage Store Catalog"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUserStoreId(godStore?.id);
                    setUserStoreName(godStoreName.trim() || godStore?.name || '');
                    setIsUserDrawerOpen(true);
                    setIsGodModalOpen(false);
                  }}
                  className="w-full py-3 bg-slate-800 hover:bg-slate-750 active:scale-[0.99] text-cyan-400 rounded-xl font-bold text-xs border border-cyan-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Users className="w-4.5 h-4.5" />
                  <span>{isArabic ? "إدارة مستخدمي المتجر" : "Manage Store Users"}</span>
                </button>

                <button
                  type="submit"
                  disabled={godSubmitting}
                  className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-extrabold text-xs shadow-lg shadow-amber-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {godSubmitting ? (
                    <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{isArabic ? "حفظ التغييرات المتقدمة" : "Save Advanced Customizations"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      <CatalogManagerDrawer
        isOpen={isCatalogDrawerOpen}
        onClose={() => setIsCatalogDrawerOpen(false)}
        storeId={catalogStoreId}
        storeName={catalogStoreName}
        isArabic={isArabic}
      />

      <UserManagerDrawer
        isOpen={isUserDrawerOpen}
        onClose={() => setIsUserDrawerOpen(false)}
        storeId={userStoreId}
        storeName={userStoreName}
        isArabic={isArabic}
      />

    </div>
  );
}
