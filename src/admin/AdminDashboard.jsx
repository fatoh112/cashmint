import React, { useState, useEffect, useRef } from 'react';
import CatalogManagement from './CatalogManagement';
import IntegrationSettings from './IntegrationSettings';
import SalesHistory from './SalesHistory';
import FullTransactionHistory from './FullTransactionHistory';
import AccountantExports from './AccountantExports';
import TaxManagement from './TaxManagement';
import ReceiptDesigner from './ReceiptDesigner';
const OnboardingWizard = React.lazy(() => import('../components/OnboardingWizard'));
import ItemsDashboard from '../components/admin/ItemsDashboard';
import AIChatWidget from '../components/admin/AIChatWidget';
import { supabase } from '../supabaseClient';
import { 
  ShoppingBag, 
  Settings, 
  BarChart3, 
  LogOut, 
  Languages,
  Package,
  Sun,
  Moon,
  Pencil,
  FileText,
  ReceiptText,
  Printer,
  History
} from 'lucide-react';

const BRANDING_VERSION = 'Cashmint v2.1';

export default function AdminDashboard({ store, setStore, session, setView: _setView, showNotification, isArabic, setIsArabic, theme, setTheme }) {
  const [activeModule, setActiveModule] = useState('sales'); // 'sales', 'catalog', 'integrations'
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [dbChecking, setDbChecking] = useState(session?.user?.email !== 'superadmin@cashmint.online');
  const [isOnboardingNeeded, setIsOnboardingNeeded] = useState(false);

  const headerLogoInputRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const verifyDatabaseAccount = async () => {
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) {
          throw new Error("No authenticated user");
        }

        // 1. Fetch store_users mapping
        const { data: mapping } = await supabase
          .from('store_users')
          .select('store_id')
          .eq('user_id', user.id)
          .maybeSingle();

        let storeRow = null;
        if (mapping?.store_id) {
          // 2. Fetch store details
          const { data } = await supabase
            .from('stores')
            .select('*')
            .eq('id', mapping.store_id)
            .maybeSingle();
          if (data) {
            storeRow = data;
          }
        }

        if (isMounted) {
          // Update local store state if store ID changes or store is not set
          if (storeRow && storeRow.id !== store?.id) {
            setStore(storeRow);
          }

          // 3. Check if onboarding is completed
          const isSetupIncomplete = !storeRow || 
            !storeRow.business_type || 
            storeRow.status === 'pending';

          if (isSetupIncomplete) {
            setIsOnboardingNeeded(true);
          }

          setDbChecking(false);
        }
      } catch (err) {
        console.error("Strict database verification failed:", err);
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('auth_error_reason', 'deleted');
        try {
          await supabase.auth.signOut();
        } catch (signOutErr) {
          console.error("Sign out error:", signOutErr);
        }
        window.location.href = '/?error=deleted';
      }
    };

    if (session?.user?.email !== 'superadmin@cashmint.online') {
      verifyDatabaseAccount();
    } else {
      setDbChecking(false);
    }

    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, store?.id]);

  if (dbChecking && !store) {
    return (
      <div dir={isArabic ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
            {isArabic ? "جاري تحميل بيانات المتجر..." : "Loading store details..."}
          </p>
        </div>
      </div>
    );
  }

  const isOnboardingWizardRequired = session?.user?.email !== 'superadmin@cashmint.online' && (
    !store || 
    !store?.business_type || 
    store?.status === 'pending'
  );

  if (isOnboardingNeeded || isOnboardingWizardRequired) {
    return (
      <div className="min-h-screen w-full bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-955 to-black flex items-center justify-center p-4">
        <React.Suspense fallback={
          <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
        }>
          <OnboardingWizard
            storeId={store?.id || null}
            isArabic={isArabic}
            onComplete={(updatedStore) => {
              // Clear stale POS keys
              const keysToRemove = [
                'device_id', 'cashier_session_id', 'cashier_name',
                'pos_menu_items', 'cashier_opening_balance', 'cashier_pin',
                'pin', 'lockout_stage', 'failed_attempts', 'lockout_until'
              ];
              keysToRemove.forEach(key => localStorage.removeItem(key));

              setStore(updatedStore);
              setIsOnboardingNeeded(false);
            }}
          />
        </React.Suspense>
      </div>
    );
  }

  const handleHeaderLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !store?.id) return;

    try {
      showNotification(isArabic ? "جاري رفع الشعار..." : "Uploading logo...", "info");
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${store?.id}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('logos')
        .getPublicUrl(filePath);

      // Update store logo in Supabase DB
      const { error: updateError } = await supabase
        .from('stores')
        .update({ logo_url: publicUrl })
        .eq('id', store?.id);

      if (updateError) throw updateError;

      // Update local state
      const updatedStore = { ...store, logo_url: publicUrl };
      setStore(updatedStore);
      localStorage.setItem('current_store_logo', publicUrl);

      showNotification(isArabic ? "تم تحديث الشعار بنجاح!" : "Logo updated successfully!", "success");
    } catch (err) {
      console.error("Error updating header logo:", err);
      showNotification(isArabic ? "فشل تحديث الشعار" : "Failed to update logo", "error");
    }
  };

  const handleLogout = async () => {
    // Clear all localStorage keys starting with sb- or containing supabase
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
        localStorage.removeItem(key);
      }
    }
    localStorage.removeItem('supabase.auth.token');
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Logout error:", err);
    }
    window.location.reload();
  };

  return (
    <div 
      dir={isArabic ? 'rtl' : 'ltr'} 
      className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 antialiased font-sans flex flex-col"
    >
      
      {/* HEADER BAR */}
      <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
        
        {/* Left/Right Header branding (RTL-aware) */}
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <input
              type="file"
              ref={headerLogoInputRef}
              onChange={handleHeaderLogoChange}
              accept="image/*"
              className="hidden"
            />
            <div 
              onClick={() => headerLogoInputRef.current?.click()}
              className="w-10 h-10 rounded-xl overflow-hidden shadow-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center cursor-pointer relative hover:scale-105 active:scale-[0.98] transition-all"
              title={isArabic ? "تغيير شعار المتجر" : "Change Store Logo"}
            >
              {store?.logo_url || localStorage.getItem("current_store_logo") ? (
                <img 
                  src={store?.logo_url || localStorage.getItem("current_store_logo")} 
                  alt={store ? store?.name : 'Store Logo'} 
                  className="w-full h-full object-contain" 
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-amber-500 to-orange-650 flex items-center justify-center text-white font-black text-xl">
                  {store?.name ? store?.name.trim().charAt(0).toUpperCase() : '?'}
                </div>
              )}
              {/* Subtle edit/pencil icon badge at the bottom corner */}
              <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white p-0.5 rounded-full shadow border border-white dark:border-slate-900 flex items-center justify-center hover:bg-amber-600 transition-colors">
                <Pencil className="w-2.5 h-2.5" />
              </div>
            </div>
          </div>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight leading-none">
              {store ? store?.name : 'Cashmint'} - {isArabic ? "لوحة التحكم" : "Backoffice"}
            </h1>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-1">
              {isArabic ? "إدارة الفرع والربط السحابي" : "Manage store settings & integrations"}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-4">
          
          {/* Bilingual Language Toggle Button */}
          <button
            onClick={() => setIsArabic(!isArabic)}
            className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:bg-amber-50/20 transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <Languages className="w-4 h-4" />
            <span>{isArabic ? "English (LTR)" : "العربية (RTL)"}</span>
          </button>

          {/* Sun/Moon Theme Toggle Button */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-750 transition-all duration-150 active:scale-95 flex items-center justify-center cursor-pointer border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
            title={theme === 'light' ? "تفعيل الوضع الداكن" : "تفعيل الوضع المضيء"}
          >
            {theme === 'light' ? <Moon className="w-4 h-4 text-slate-500" /> : <Sun className="w-4 h-4 text-amber-400" />}
          </button>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

          {/* User Profile Info */}
          <div className={`${isArabic ? 'text-right' : 'text-left'} hidden sm:block`}>
            <p className="text-xs font-black text-slate-700 dark:text-slate-200 leading-none">{session.user.email}</p>
            <p className="text-[9px] font-bold text-amber-500 mt-1">{isArabic ? "مدير النظام" : "System Administrator"}</p>
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

          {/* Logout Button */}
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 px-4 py-2.5 rounded-xl transition-all active:scale-95 flex items-center gap-2 shadow-sm shadow-rose-500/10 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{isArabic ? "تسجيل خروج" : "Logout"}</span>
          </button>
        </div>
      </header>

      {/* DASHBOARD LAYOUT BODY */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* SIDEBAR NAVIGATION */}
        <aside className="w-64 bg-white dark:bg-slate-800 border-l border-r border-slate-105 dark:border-slate-700 flex flex-col shrink-0">
          
          {/* Navigation Links */}
          <nav className="flex-1 p-4 space-y-2">
            
            {/* Sales Dashboard */}
            <button
              onClick={() => setActiveModule('sales')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'sales'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>{isArabic ? "لوحة المبيعات (آخر 24 ساعة)" : "Sales Dashboard (24 Hours)"}</span>
            </button>

            {/* Full Transaction History */}
            <button
              onClick={() => setActiveModule('full_history')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'full_history'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              <span>{isArabic ? "سجل المعاملات بالكامل" : "Full Transaction History"}</span>
            </button>

            {/* Catalog CRUD */}
            <button
              onClick={() => setActiveModule('catalog')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'catalog'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>{isArabic ? "إدارة الكتالوج والمنيو" : "Catalog Management"}</span>
            </button>

            {/* Advanced Menu */}
            <button
              onClick={() => setActiveModule('advanced_menu')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'advanced_menu'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>{isArabic ? "بنود المنيو المتقدمة" : "Advanced Menu / Items"}</span>
            </button>

            {/* Hardware & Integrations */}
            <button
              onClick={() => setActiveModule('integrations')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'integrations'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>{isArabic ? "إعدادات الأجهزة والربط" : "Integration & Hardware"}</span>
            </button>

            <button
              onClick={() => setActiveModule('receipt_designer')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'receipt_designer'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Printer className="w-4 h-4" />
              <span>{isArabic ? "مصمم الفواتير" : "Receipt Designer"}</span>
            </button>

            <button
              onClick={() => setActiveModule('accounting')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'accounting'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>{isArabic ? 'تصدير المحاسب' : 'Accountant Exports'}</span>
            </button>

            <button
              onClick={() => setActiveModule('taxes')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeModule === 'taxes'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-750 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <ReceiptText className="w-4 h-4" />
              <span>{isArabic ? 'المجموعات المحاسبية' : 'Accounting Groups'}</span>
            </button>

          </nav>

          {/* Footer branding details */}
          <div className="p-5 border-t border-slate-100 dark:border-slate-700 text-center">
            <span className="text-[9px] font-bold text-slate-350 dark:text-slate-500 tracking-wide uppercase">
              {BRANDING_VERSION}
            </span>
          </div>

        </aside>

        {/* WORKSPACE CONTENT AREA */}
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-900/50">
          
          {activeModule === 'sales' && (
            <SalesHistory 
              store={store} 
              showNotification={showNotification} 
              isArabic={isArabic} 
            />
          )}

          {activeModule === 'full_history' && (
            <FullTransactionHistory
              store={store}
              showNotification={showNotification}
              isArabic={isArabic}
            />
          )}

          {activeModule === 'catalog' && (
            <CatalogManagement 
              store={store} 
              showNotification={showNotification} 
              isArabic={isArabic} 
              onManageAccountingGroups={() => setActiveModule('taxes')}
            />
          )}

          {activeModule === 'advanced_menu' && (
            <ItemsDashboard 
              store={store} 
              showNotification={showNotification} 
              isArabic={isArabic} 
            />
          )}

          {activeModule === 'integrations' && (
            <IntegrationSettings 
              store={store} 
              setStore={setStore} 
              showNotification={showNotification} 
              isArabic={isArabic} 
            />
          )}

          {activeModule === 'receipt_designer' && (
            <ReceiptDesigner 
              store={store} 
              showNotification={showNotification} 
              isArabic={isArabic} 
            />
          )}

          {activeModule === 'accounting' && (
            <AccountantExports store={store} showNotification={showNotification} isArabic={isArabic} />
          )}

          {activeModule === 'taxes' && (
            <TaxManagement store={store} showNotification={showNotification} isArabic={isArabic} />
          )}

        </main>

      </div>

      {/* Floating AI Business Analyst widget */}
      <AIChatWidget isArabic={isArabic} />

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/45 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col p-6 space-y-6 text-right">
            {/* Header */}
            <div className="text-center space-y-1">
              <h3 className="font-extrabold text-lg text-slate-900 dark:text-white">
                {isArabic ? "تسجيل الخروج" : "Logout"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-350 mt-2 leading-relaxed">
                {isArabic ? "هل أنت متأكد من رغبتك في تسجيل الخروج؟" : "Are you sure you want to log out?"}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleLogout}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-[0.99] cursor-pointer"
              >
                {isArabic ? "تسجيل خروج" : "Logout"}
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-extrabold text-xs rounded-xl transition-all active:scale-[0.99] cursor-pointer"
              >
                {isArabic ? "إلغاء" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
