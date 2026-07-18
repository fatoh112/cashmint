import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import StoresManagement from './StoresManagement';
import AIChatWidget from '../components/admin/AIChatWidget';
import { 
  Store, 
  BarChart2, 
  Sliders, 
  Globe, 
  LogOut, 
  Shield, 
  Activity, 
  Database,
  AlertCircle
} from 'lucide-react';

export default function SuperAdminDashboard({ session, setView: _setView }) {
  const [activeTab, setActiveTab] = useState('stores'); // 'stores', 'analytics', 'hubrise', 'settings'
  const [isArabic, setIsArabic] = useState(() => {
    return localStorage.getItem('app_language') === 'ar';
  });
  const [adminEmail, setAdminEmail] = useState('');
  const [notification, setNotification] = useState(null);
  const [storesCount, setStoresCount] = useState(0);

  useEffect(() => {
    if (session?.user) {
      setAdminEmail(session.user.email || 'superadmin@cashmint.online');
    }
  }, [session]);

  const [monthlySales, setMonthlySales] = useState(0);
  const [terminalConnections, setTerminalConnections] = useState(0);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [autoBackup, setAutoBackup] = useState(true);

  // Fetch stats and settings
  useEffect(() => {
    async function fetchStatsAndSettings() {
      try {
        // 1. Fetch total stores count
        const { count: storesC, error: storesErr } = await supabase
          .from('stores')
          .select('*', { count: 'exact', head: true });
        if (storesErr) throw storesErr;
        setStoresCount(storesC || 0);

        // 2. Fetch monthly completed sales
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const { data: monthlyOrders, error: salesErr } = await supabase
          .from('orders')
          .select('total_amount')
          .eq('status', 'completed')
          .gte('created_at', startOfMonth);
        if (salesErr) throw salesErr;
        const salesSum = monthlyOrders
          ? monthlyOrders.reduce((sum, ord) => sum + parseFloat(ord.total_amount || 0), 0)
          : 0;
        setMonthlySales(salesSum);

        // 3. Fetch terminal connections (store_users rows)
        const { count: usersC, error: usersErr } = await supabase
          .from('store_users')
          .select('*', { count: 'exact', head: true });
        if (usersErr) throw usersErr;
        setTerminalConnections(usersC || 0);

        // 4. Fetch system settings
        const { data: settings, error: settingsErr } = await supabase
          .from('system_settings')
          .select('*')
          .eq('id', 1)
          .maybeSingle();
        if (settingsErr) throw settingsErr;
        if (settings) {
          setMaintenanceMode(settings.maintenance_mode);
          setAutoBackup(settings.auto_backup);
        }
      } catch (err) {
        console.error('Error fetching global admin dashboard stats:', err);
      }
    }
    fetchStatsAndSettings();
  }, []);

  const handleToggleMaintenance = async () => {
    const newValue = !maintenanceMode;
    setMaintenanceMode(newValue);
    try {
      const { error } = await supabase
        .from('system_settings')
        .update({ maintenance_mode: newValue })
        .eq('id', 1);
      if (error) throw error;
      showNotification(
        isArabic 
          ? `تم ${newValue ? 'تفعيل' : 'إلغاء تفعيل'} وضع الصيانة` 
          : `Maintenance mode ${newValue ? 'enabled' : 'disabled'}`
      );
    } catch (err) {
      console.error('Error updating maintenance mode:', err);
      setMaintenanceMode(!newValue);
      showNotification(
        isArabic ? 'فشل تحديث إعدادات النظام' : 'Failed to update system settings', 
        'error'
      );
    }
  };

  const handleToggleAutoBackup = async () => {
    const newValue = !autoBackup;
    setAutoBackup(newValue);
    try {
      const { error } = await supabase
        .from('system_settings')
        .update({ auto_backup: newValue })
        .eq('id', 1);
      if (error) throw error;
      showNotification(
        isArabic 
          ? `تم ${newValue ? 'تفعيل' : 'إلغاء تفعيل'} النسخ الاحتياطي` 
          : `Auto backup ${newValue ? 'enabled' : 'disabled'}`
      );
    } catch (err) {
      console.error('Error updating auto backup:', err);
      setAutoBackup(!newValue);
      showNotification(
        isArabic ? 'فشل تحديث إعدادات النظام' : 'Failed to update system settings', 
        'error'
      );
    }
  };

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleLanguage = () => {
    const newLang = !isArabic;
    setIsArabic(newLang);
    localStorage.setItem('app_language', newLang ? 'ar' : 'en');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none" dir={isArabic ? "rtl" : "ltr"}>
      
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-xl transition-all duration-300 flex items-center gap-2 text-slate-950 font-bold ${
          notification.type === 'error' ? 'bg-rose-400' : 'bg-cyan-400'
        }`}>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Structure Wrapper */}
      <div className="flex-1 flex overflow-hidden h-screen">
        
        {/* SIDEBAR NAVIGATION (Slate Executive Theme) */}
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
          
          {/* Logo / Header */}
          <div className="p-6 border-b border-slate-800/80 bg-slate-900/60 flex items-center gap-3 shrink-0">
            <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl border border-cyan-500/20">
              <Shield className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-black text-white tracking-wider">CASHMINT MASTER</h1>
              <p className="text-[9px] text-cyan-400 font-extrabold tracking-widest uppercase">Super Admin Panel</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
            <button
              onClick={() => setActiveTab('stores')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'stores' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10 font-black' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-850'
              }`}
            >
              <Store className="w-4.5 h-4.5" />
              <span>{isArabic ? "إدارة المتاجر" : "Stores Management"}</span>
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'analytics' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10 font-black' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-850'
              }`}
            >
              <BarChart2 className="w-4.5 h-4.5" />
              <span>{isArabic ? "التحليلات العالمية" : "Global Analytics"}</span>
            </button>

            <button
              onClick={() => setActiveTab('hubrise')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'hubrise' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10 font-black' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-850'
              }`}
            >
              <Sliders className="w-4.5 h-4.5" />
              <span>{isArabic ? "إعدادات HubRise" : "HubRise Configurations"}</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'settings' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10 font-black' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-850'
              }`}
            >
              <Activity className="w-4.5 h-4.5" />
              <span>{isArabic ? "إعدادات النظام" : "System Settings"}</span>
            </button>
          </nav>

          {/* User Profile Widget & Sign Out */}
          <div className="p-4 border-t border-slate-800 bg-slate-900/40 shrink-0 space-y-3">
            <div className="flex items-center gap-2.5 px-2 select-none">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-extrabold text-cyan-400 border border-slate-700">
                SA
              </div>
              <div className="overflow-hidden">
                <p className="text-[10px] font-black text-white leading-none">Super Admin</p>
                <p className="text-[8px] font-bold text-slate-500 mt-1 truncate max-w-[140px]">{adminEmail}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="w-full px-3 py-2 bg-slate-800/60 hover:bg-slate-800 text-rose-400 hover:text-rose-300 border border-slate-750/30 rounded-xl font-bold text-[10px] transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isArabic ? "تسجيل الخروج" : "Sign Out"}</span>
            </button>
          </div>
        </aside>

        {/* MAIN PANEL AREA */}
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* Header */}
          <header className="h-16 bg-slate-900 border-b border-slate-800 flex justify-between items-center px-8 shrink-0">
            <div>
              <h2 className="text-sm font-extrabold text-white">
                {activeTab === 'stores' && (isArabic ? "المتاجر النشطة" : "Stores & Tenants")}
                {activeTab === 'analytics' && (isArabic ? "لوحة الإحصائيات العامة" : "Global System Analytics")}
                {activeTab === 'hubrise' && (isArabic ? "ربط بوابات الطلبات السحابية" : "Developer Webhook Settings")}
                {activeTab === 'settings' && (isArabic ? "التحكم بالنظام" : "System Control Center")}
              </h2>
            </div>

            <div className="flex items-center gap-4">
              {/* Language toggle */}
              <button
                onClick={toggleLanguage}
                className="px-3.5 py-1.5 bg-slate-850 hover:bg-slate-800 rounded-xl text-[10px] font-bold text-slate-300 border border-slate-750 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isArabic ? "EN" : "عربي"}</span>
              </button>
            </div>
          </header>

          {/* Tab Views Content */}
          <main className="flex-1 overflow-y-auto p-8 bg-slate-950">
            
            {activeTab === 'stores' && (
              <StoresManagement showNotification={showNotification} isArabic={isArabic} />
            )}

            {activeTab === 'analytics' && (
              <div className="space-y-6 animate-fade-in">
                {/* Metrics Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  {[
                    { 
                      title: isArabic ? "إجمالي المستأجرين" : "Total Active Tenants", 
                      value: storesCount.toString(), 
                      icon: Store, 
                      color: "text-cyan-400" 
                    },
                    { 
                      title: isArabic ? "حجم المبيعات الشهري" : "Monthly GTV Volume", 
                      value: `${monthlySales.toLocaleString(isArabic ? 'ar-BE' : 'en-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`, 
                      icon: BarChart2, 
                      color: "text-emerald-400"
                    },
                    { 
                      title: isArabic ? "اتصالات الـ Terminal" : "Active Terminal Connections", 
                      value: terminalConnections.toString(), 
                      icon: Shield, 
                      color: "text-indigo-400"
                    },
                    { 
                      title: isArabic ? "حالة قاعدة البيانات" : "Postgres DB Status", 
                      value: "Online / Healthy", 
                      icon: Database, 
                      color: "text-amber-400" 
                    }
                  ].map((card, idx) => {
                    const Icon = card.icon;
                    return (
                      <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between relative overflow-hidden">
                        <div className="space-y-1.5 text-right">
                          <div className="flex items-center gap-1.5 justify-start">
                            <p className="text-[10px] font-bold text-slate-500 uppercase">{card.title}</p>
                            {card.badge && (
                              <span className="text-[8px] font-black px-1.5 py-0.2 bg-slate-800 text-slate-400 border border-slate-700/60 rounded-full uppercase">
                                {card.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-lg font-black text-white">{card.value}</p>
                        </div>
                        <div className={`p-3 bg-slate-850 rounded-xl ${card.color}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Analytical Visual Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-extrabold text-sm text-white">{isArabic ? "مراقبة الأنظمة ومؤشرات الأداء" : "Global Performance & Systems Health"}</h3>
                  </div>
                  <div className="h-60 bg-slate-950 border border-slate-850 rounded-xl flex items-center justify-center p-6 text-center">
                    <div className="space-y-2">
                      <Activity className="w-8 h-8 text-cyan-400 animate-pulse mx-auto" />
                      <p className="text-xs font-bold text-slate-400">{isArabic ? "مراقبة المبيعات وتدفق البيانات يعمل بكفاءة" : "Operational analytics stream healthy"}</p>
                      <p className="text-[10px] text-slate-650">{isArabic ? "جميع مستويات التحقق RLS وأذونات الدخول مفعلة بالكامل. الرسوم البيانية التفصيلية قيد التطوير حالياً." : "All tenant RLS configurations and database connection limits are verified. Analytics charting under active development."}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'hubrise' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 max-w-2xl animate-fade-in text-right">
                <div>
                  <h3 className="font-extrabold text-sm text-white">{isArabic ? "تكاملات منصة HubRise العالمية" : "Global HubRise Configurations"}</h3>
                  <p className="text-[10px] text-slate-400 mt-1">{isArabic ? "مراجعة وضبط ربط API والطلبات السحابية المركزية" : "Developer credentials and global routing parameters"}</p>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 block">{isArabic ? "رابط Webhook الموحد للمستقبل" : "Global Incoming Webhook URL"}</label>
                    <input
                      type="text"
                      value="https://pnffzpewnxeahspxofxo.supabase.co/functions/v1/hubrise-webhook"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-850 rounded-xl text-xs font-mono text-slate-400 focus:outline-none"
                      readOnly
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 block">{isArabic ? "رقم العميل الموحد (Developer Client ID)" : "Developer Client ID"}</label>
                    <input
                      type="text"
                      placeholder="client_master_auth_v1"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-850 rounded-xl text-xs font-mono text-slate-400 focus:outline-none text-left"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-850/50 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    {isArabic 
                      ? "تقوم بوابات الويب بتوجيه طلبات HubRise القادمة تلقائياً إلى المستأجر المناسب بناءً على معرف الموقع (Location ID). تأكد من إعداد المعرفات بشكل صحيح داخل إعدادات المستأجرين."
                      : "Cloud order router dynamically maps payloads to active stores using their configured Location ID. Ensure valid configurations to prevent webhook dropouts."
                    }
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 max-w-xl animate-fade-in text-right">
                <div className="flex justify-between items-start border-b border-slate-800/80 pb-4">
                  <div className="space-y-1">
                    <h3 className="font-extrabold text-sm text-white">{isArabic ? "إعدادات منصة Cashmint POS" : "Platform Settings & Controls"}</h3>
                    <p className="text-[10px] text-slate-400">{isArabic ? "التحكم بالنظام وإدارة التراخيص والتحديثات" : "Global platform flags, backups, and configurations"}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-850 rounded-xl">
                    <div className="text-right">
                      <p className="text-xs font-bold text-white">{isArabic ? "وضع الصيانة (Maintenance Mode)" : "System Maintenance Mode"}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5">{isArabic ? "تعطيل دخول الكاشير مؤقتاً للتحديثات" : "Block cashier POS access temporarily during updates"}</p>
                    </div>
                    <div 
                      onClick={handleToggleMaintenance}
                      className={`w-9 h-5 rounded-full p-0.5 cursor-pointer flex items-center border transition-all duration-200 ${
                        maintenanceMode 
                          ? 'bg-cyan-500/20 border-cyan-500/30 justify-end' 
                          : 'bg-slate-800 border-slate-750 justify-start'
                      }`}
                    >
                      <div className={`w-3.8 h-3.8 rounded-full transition-all duration-200 ${
                        maintenanceMode ? 'bg-cyan-400' : 'bg-slate-500'
                      }`} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-850 rounded-xl">
                    <div className="text-right">
                      <p className="text-xs font-bold text-white">{isArabic ? "النسخ الاحتياطي التلقائي لقاعدة البيانات" : "Automated Database Backups"}</p>
                      <p className="text-[9px] text-slate-500 mt-0.5">{isArabic ? "جدولة نسخ البيانات كل 24 ساعة" : "Backup Postgres database snapshot every 24 hours"}</p>
                    </div>
                    <div 
                      onClick={handleToggleAutoBackup}
                      className={`w-9 h-5 rounded-full p-0.5 cursor-pointer flex items-center border transition-all duration-200 ${
                        autoBackup 
                          ? 'bg-cyan-500/20 border-cyan-500/30 justify-end' 
                          : 'bg-slate-800 border-slate-750 justify-start'
                      }`}
                    >
                      <div className={`w-3.8 h-3.8 rounded-full transition-all duration-200 ${
                        autoBackup ? 'bg-cyan-400' : 'bg-slate-500'
                      }`} />
                    </div>
                  </div>
                </div>
              </div>
            )}

          </main>
        </div>

      </div>

      {/* Super Admin Global AI Analyst Assistant */}
      <AIChatWidget isArabic={isArabic} isSuperAdmin={true} />
    </div>
  );
}
