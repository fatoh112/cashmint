import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import StoresManagement from './StoresManagement';
import StoreDetail from './StoreDetail';
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
  AlertCircle,
  RefreshCw,
  Clock,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Server,
  Terminal,
  Search,
  Filter,
  ArrowRight,
  Settings,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export default function SuperAdminDashboard({ session, setView: _setView }) {
  const [activeTab, setActiveTab] = useState('stores'); // 'stores', 'store_detail', 'analytics', 'system_health', 'audit_logs', 'hubrise', 'settings'
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  
  const [isArabic, setIsArabic] = useState(() => {
    return localStorage.getItem('app_language') === 'ar';
  });
  
  const [adminEmail, setAdminEmail] = useState('');
  const [notification, setNotification] = useState(null);
  const [storesList, setStoresList] = useState([]);
  
  // Date/Store filter states for Global Analytics
  const [dateFilter, setDateFilter] = useState('last_30_days'); 
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedStoreFilter, setSelectedStoreFilter] = useState('all');
  
  // Analytics Data
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  // System Health Data
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  
  // Audit Logs States
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActorQuery, setAuditActorQuery] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalCount, setAuditTotalCount] = useState(0);
  const auditPerPage = 15;

  // Maintenance Modal Config States
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintScope, setMaintScope] = useState('global');
  const [maintStoreId, setMaintStoreId] = useState('');
  const [maintEnabled, setMaintEnabled] = useState(false);
  const [maintMsgAr, setMaintMsgAr] = useState('');
  const [maintMsgEn, setMaintMsgEn] = useState('');
  const [maintStartsAt, setMaintStartsAt] = useState('');
  const [maintEndAt, setMaintEndAt] = useState('');
  const [maintSubmitting, setMaintSubmitting] = useState(false);

  // Current system maintenance status (for global indicator)
  const [globalMaintenance, setGlobalMaintenance] = useState(null);

  useEffect(() => {
    if (session?.user) {
      setAdminEmail(session.user.email || 'superadmin@cashmint.online');
    }
  }, [session]);

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

  // URL deep linking routing
  useEffect(() => {
    const handleUrlRouting = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/stores\/([a-f0-9-]{36})$/i);
      if (match) {
        setSelectedStoreId(match[1]);
        setActiveTab('store_detail');
      } else {
        setSelectedStoreId(null);
        if (activeTab === 'store_detail') {
          setActiveTab('stores');
        }
      }
    };

    handleUrlRouting();
    window.addEventListener('popstate', handleUrlRouting);
    return () => window.removeEventListener('popstate', handleUrlRouting);
  }, []);

  const navigateToStoreDetail = (storeId) => {
    window.history.pushState(null, '', `/stores/${storeId}`);
    setSelectedStoreId(storeId);
    setActiveTab('store_detail');
  };

  const navigateBack = () => {
    window.history.pushState(null, '', '/');
    setSelectedStoreId(null);
    setActiveTab('stores');
  };

  // Load stores list for filters & maintenance
  const loadStoresList = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('id, name, onboarding_completed')
        .order('name');
      if (error) throw error;
      setStoresList(data || []);
    } catch (err) {
      console.error('Error fetching stores list:', err);
    }
  }, []);

  // Fetch Global Maintenance Configuration Status
  const fetchGlobalMaintenanceStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('system_maintenance')
        .select('*')
        .eq('scope', 'global')
        .maybeSingle();
      if (!error && data) {
        setGlobalMaintenance(data);
        setMaintEnabled(data.enabled);
        setMaintMsgAr(data.message_ar || '');
        setMaintMsgEn(data.message_en || '');
        setMaintStartsAt(data.starts_at ? new Date(data.starts_at).toISOString().slice(0, 16) : '');
        setMaintEndAt(data.expected_end_at ? new Date(data.expected_end_at).toISOString().slice(0, 16) : '');
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadStoresList();
    fetchGlobalMaintenanceStatus();
  }, [loadStoresList, fetchGlobalMaintenanceStatus]);

  // Date range calculator
  const calculateDateRange = (filter) => {
    const now = new Date();
    let start, end;
    end = new Date();
    
    if (filter === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (filter === 'yesterday') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, -1);
    } else if (filter === 'last_7_days') {
      start = new Date(now.setDate(now.getDate() - 7));
    } else if (filter === 'last_30_days') {
      start = new Date(now.setDate(now.getDate() - 30));
    } else if (filter === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filter === 'prev_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else {
      start = customStartDate ? new Date(customStartDate) : new Date(now.setDate(now.getDate() - 30));
      end = customEndDate ? new Date(customEndDate) : new Date();
    }
    return { start: start.toISOString(), end: end.toISOString() };
  };

  // Fetch Global Analytics
  const fetchAnalytics = useCallback(async () => {
    try {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      
      const { start, end } = calculateDateRange(dateFilter);
      const storeIdParam = selectedStoreFilter === 'all' ? null : selectedStoreFilter;
      
      const { data, error } = await supabase.rpc('superadmin_global_analytics', {
        p_start_date: start,
        p_end_date: end,
        p_store_id: storeIdParam
      });

      if (error) throw error;
      setAnalyticsData(data);
    } catch (err) {
      console.error('Error fetching system analytics:', err);
      setAnalyticsError(isArabic ? 'فشل تحميل الإحصائيات العامة.' : 'Failed to fetch global aggregations.');
    } finally {
      setAnalyticsLoading(false);
    }
  }, [dateFilter, customStartDate, customEndDate, selectedStoreFilter, isArabic]);

  // Fetch System Health
  const fetchSystemHealth = useCallback(async () => {
    try {
      setHealthLoading(true);
      const { data, error } = await supabase.rpc('superadmin_get_system_health');
      if (error) throw error;
      setHealthData(data);
    } catch (err) {
      console.error('Error fetching health logs:', err);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Fetch Audit Logs
  const fetchAuditLogs = useCallback(async () => {
    try {
      setAuditLoading(true);
      let queryObj = supabase
        .from('superadmin_audit_logs')
        .select('*', { count: 'exact' });

      if (auditActorQuery.trim()) {
        queryObj = queryObj.ilike('actor_email', `%${auditActorQuery.trim()}%`);
      }
      if (auditActionFilter !== 'all') {
        queryObj = queryObj.eq('action', auditActionFilter);
      }
      if (auditEntityFilter !== 'all') {
        queryObj = queryObj.eq('entity_type', auditEntityFilter);
      }

      const fromRange = (auditPage - 1) * auditPerPage;
      const toRange = fromRange + auditPerPage - 1;

      const { data, count, error } = await queryObj
        .order('created_at', { ascending: false })
        .range(fromRange, toRange);

      if (error) throw error;
      setAuditLogs(data || []);
      setAuditTotalCount(count || 0);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  }, [auditActorQuery, auditActionFilter, auditEntityFilter, auditPage]);

  // Load relevant data based on active tab
  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalytics();
    } else if (activeTab === 'system_health') {
      fetchSystemHealth();
    } else if (activeTab === 'audit_logs') {
      fetchAuditLogs();
    }
  }, [activeTab, fetchAnalytics, fetchSystemHealth, fetchAuditLogs]);

  // Handle Maintenance Toggle Submission
  const handleSaveMaintenanceConfig = async (e) => {
    e.preventDefault();
    try {
      setMaintSubmitting(true);
      const storeUUID = maintScope === 'store' ? maintStoreId : null;
      if (maintScope === 'store' && !storeUUID) {
        showNotification(isArabic ? 'الرجاء اختيار المتجر المتأثر' : 'Please select the affected store', 'error');
        return;
      }

      const { error } = await supabase.rpc('superadmin_toggle_maintenance', {
        p_scope: maintScope,
        p_store_id: storeUUID,
        p_enabled: maintEnabled,
        p_message_ar: maintMsgAr,
        p_message_en: maintMsgEn,
        p_starts_at: maintStartsAt ? new Date(maintStartsAt).toISOString() : null,
        p_expected_end_at: maintEndAt ? new Date(maintEndAt).toISOString() : null
      });

      if (error) throw error;
      showNotification(
        isArabic 
          ? 'تم تطبيق إعدادات الصيانة وحفظ السجلات بنجاح' 
          : 'Maintenance configurations saved and logged successfully'
      );
      setShowMaintenanceModal(false);
      fetchGlobalMaintenanceStatus();
    } catch (err) {
      console.error('Error saving maintenance details:', err);
      showNotification(isArabic ? 'فشل حفظ إعدادات الصيانة' : 'Failed to update maintenance settings', 'error');
    } finally {
      setMaintSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none" dir={isArabic ? "rtl" : "ltr"}>
      
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[300] px-6 py-3 rounded-xl shadow-xl transition-all duration-300 flex items-center gap-2 text-slate-950 font-bold ${
          notification.type === 'error' ? 'bg-rose-400' : 'bg-cyan-400'
        }`}>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Structure Wrapper */}
      <div className="flex-1 flex overflow-hidden h-screen">
        
        {/* SIDEBAR NAVIGATION */}
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
              onClick={() => { setActiveTab('stores'); setSelectedStoreId(null); }}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'stores' || activeTab === 'store_detail'
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
              onClick={() => setActiveTab('system_health')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'system_health' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10 font-black' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-850'
              }`}
            >
              <Activity className="w-4.5 h-4.5" />
              <span>{isArabic ? "حالة النظام" : "System Health"}</span>
            </button>

            <button
              onClick={() => setActiveTab('audit_logs')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'audit_logs' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10 font-black' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-850'
              }`}
            >
              <Database className="w-4.5 h-4.5" />
              <span>{isArabic ? "سجلات العمليات" : "Audit Operations"}</span>
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
              <span>{isArabic ? "إعدادات HubRise" : "HubRise Settings"}</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full px-4 py-3 rounded-xl font-bold text-xs transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'settings' 
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10 font-black' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-850'
              }`}
            >
              <Settings className="w-4.5 h-4.5" />
              <span>{isArabic ? "إعدادات النظام" : "System Control"}</span>
            </button>
          </nav>

          {/* User Profile Widget */}
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
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-extrabold text-white">
                {activeTab === 'stores' && (isArabic ? "المتاجر والمستأجرين" : "Stores & Tenants")}
                {activeTab === 'store_detail' && (isArabic ? "تفاصيل المتجر" : "Store Detail Overview")}
                {activeTab === 'analytics' && (isArabic ? "لوحة الإحصائيات العامة" : "Global System Analytics")}
                {activeTab === 'system_health' && (isArabic ? "مراقبة صحة النظام" : "System Health Monitor")}
                {activeTab === 'audit_logs' && (isArabic ? "سجلات الأمان والرقابة" : "System Audit Logs Ledger")}
                {activeTab === 'hubrise' && (isArabic ? "إعدادات الربط السحابي" : "HubRise Developer Configs")}
                {activeTab === 'settings' && (isArabic ? "التحكم بالنظام" : "System Configuration Center")}
              </h2>
              {globalMaintenance?.enabled && (
                <span className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[8px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  <span>{isArabic ? "وضع الصيانة نشط" : "Maintenance Active"}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-4">
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
              <StoresManagement 
                showNotification={showNotification} 
                isArabic={isArabic} 
                onSelectStore={navigateToStoreDetail}
              />
            )}

            {activeTab === 'store_detail' && selectedStoreId && (
              <StoreDetail 
                storeId={selectedStoreId} 
                onBack={navigateBack} 
                isArabic={isArabic} 
              />
            )}

            {activeTab === 'analytics' && (
              <div className="space-y-6 animate-fade-in text-right">
                
                {/* Filters Section */}
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 font-bold block">{isArabic ? "تصفية حسب التاريخ" : "Timeframe Range"}</label>
                      <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="bg-slate-850 border border-slate-750 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 font-bold"
                      >
                        <option value="today">{isArabic ? "اليوم" : "Today"}</option>
                        <option value="yesterday">{isArabic ? "أمس" : "Yesterday"}</option>
                        <option value="last_7_days">{isArabic ? "آخر 7 أيام" : "Last 7 Days"}</option>
                        <option value="last_30_days">{isArabic ? "آخر 30 يوم" : "Last 30 Days"}</option>
                        <option value="this_month">{isArabic ? "الشهر الحالي" : "This Month"}</option>
                        <option value="prev_month">{isArabic ? "الشهر السابق" : "Previous Month"}</option>
                        <option value="custom">{isArabic ? "نطاق مخصص" : "Custom Date Range"}</option>
                      </select>
                    </div>

                    {dateFilter === 'custom' && (
                      <>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 font-bold block">{isArabic ? "من تاريخ" : "Start Date"}</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            className="bg-slate-850 border border-slate-750 text-white rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-cyan-500 text-left font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 font-bold block">{isArabic ? "إلى تاريخ" : "End Date"}</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            className="bg-slate-850 border border-slate-750 text-white rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-cyan-500 text-left font-mono"
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 font-bold block">{isArabic ? "تصفية حسب المتجر" : "Filter by Store Tenant"}</label>
                      <select
                        value={selectedStoreFilter}
                        onChange={(e) => setSelectedStoreFilter(e.target.value)}
                        className="bg-slate-850 border border-slate-750 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 font-bold"
                      >
                        <option value="all">{isArabic ? "جميع المتاجر" : "All Stores"}</option>
                        {storesList.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={fetchAnalytics}
                    disabled={analyticsLoading}
                    className="bg-cyan-500 hover:bg-cyan-600 active:scale-98 text-slate-950 font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-cyan-500/10 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${analyticsLoading ? 'animate-spin' : ''}`} />
                    <span>{isArabic ? "تحديث البيانات" : "Fetch Report"}</span>
                  </button>
                </div>

                {analyticsError ? (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-6 rounded-2xl text-center text-xs font-bold">
                    {analyticsError}
                  </div>
                ) : analyticsLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="h-28 bg-slate-900 rounded-2xl animate-pulse" />
                    <div className="h-28 bg-slate-900 rounded-2xl animate-pulse" />
                    <div className="h-28 bg-slate-900 rounded-2xl animate-pulse" />
                    <div className="h-28 bg-slate-900 rounded-2xl animate-pulse" />
                  </div>
                ) : analyticsData ? (
                  <div className="space-y-6">
                    
                    {/* Store Onboarding Overview Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {[
                        {
                          title: isArabic ? "إجمالي المتاجر المسجلة" : "Total Registered Stores",
                          value: `${analyticsData.summary?.total_stores || 0}`,
                          color: "text-cyan-400",
                          icon: Store
                        },
                        {
                          title: isArabic ? "المتاجر المكتمل إعدادها" : "Onboarded Stores",
                          value: `${analyticsData.summary?.onboarded_stores || 0}`,
                          color: "text-emerald-400",
                          icon: CheckCircle
                        },
                        {
                          title: isArabic ? "متاجر قيد الإعداد والمتابعة" : "Stores Pending Onboarding",
                          value: `${analyticsData.summary?.pending_onboarding_stores || 0}`,
                          color: "text-amber-400",
                          icon: Clock
                        }
                      ].map((card, idx) => {
                        const Icon = card.icon;
                        return (
                          <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-slate-500 uppercase">{card.title}</p>
                              <p className="text-base font-black text-white">{card.value}</p>
                            </div>
                            <div className={`p-3 bg-slate-850 rounded-xl ${card.color}`}>
                              <Icon className="w-4.5 h-4.5" />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      {[
                        {
                          title: isArabic ? "إجمالي المبيعات (Gross)" : "Gross GTV",
                          value: `${(analyticsData.summary?.total_gross_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`,
                          color: "text-emerald-400",
                          icon: BarChart2
                        },
                        {
                          title: isArabic ? "صافي المبيعات (Net)" : "Net Sales",
                          value: `${(analyticsData.summary?.total_net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`,
                          color: "text-cyan-400",
                          icon: Activity
                        },
                        {
                          title: isArabic ? "إجمالي الضريبة (VAT)" : "VAT Collected",
                          value: `${(analyticsData.summary?.total_vat || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`,
                          color: "text-indigo-400",
                          icon: Database
                        },
                        {
                          title: isArabic ? "الطلبات المكتملة" : "Completed Tickets",
                          value: (analyticsData.summary?.completed_orders || 0).toString(),
                          color: "text-amber-400",
                          icon: Store
                        }
                      ].map((card, idx) => {
                        const Icon = card.icon;
                        return (
                          <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                            <div className="space-y-1">
                              <p className="text-[10px] font-bold text-slate-500 uppercase">{card.title}</p>
                              <p className="text-base font-black text-white">{card.value}</p>
                            </div>
                            <div className={`p-3 bg-slate-850 rounded-xl ${card.color}`}>
                              <Icon className="w-4.5 h-4.5" />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Secondary Metrics Card */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      {[
                        {
                          title: isArabic ? "المرتجعات" : "Refunds Volume",
                          value: isArabic ? "ربط المرتجعات: غير مهيأ" : "Refund integration: Not configured",
                          color: "text-rose-400"
                        },
                        {
                          title: isArabic ? "عمليات دفع كارد فاشلة" : "Failed Card Payments",
                          value: (analyticsData.summary?.failed_card_payments || 0).toString(),
                          color: "text-amber-400"
                        },
                        {
                          title: isArabic ? "فروع ونقاط البيع المتصلة" : "Total Terminals Configured",
                          value: `${analyticsData.summary?.online_terminals || 0} / ${analyticsData.summary?.offline_terminals || 0} (Online/Offline)`,
                          color: "text-blue-400"
                        },
                        {
                          title: isArabic ? "طلبات معلقة / جزئية" : "Pending / Split orders",
                          value: `${analyticsData.summary?.pending_orders || 0} / ${analyticsData.summary?.partially_paid_orders || 0}`,
                          color: "text-purple-400"
                        }
                      ].map((card, idx) => (
                        <div key={idx} className="bg-slate-900/60 border border-slate-850 rounded-2xl p-4 flex flex-col justify-center space-y-1">
                          <p className="text-[9px] font-bold text-slate-500 uppercase">{card.title}</p>
                          <p className={`text-sm font-black ${card.color}`}>{card.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* CSS Bar Chart & Leaderboard */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* CSS Bar Chart - Sales Over Time */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                        <h4 className="font-extrabold text-xs text-white">{isArabic ? "مبيعات المستأجرين اليومية (آخر 7 أيام نشطة)" : "Daily GTV Performance (Active Days)"}</h4>
                        <div className="space-y-3">
                          {analyticsData.sales_over_time?.slice(-7).map((day, idx) => {
                            const maxVal = Math.max(...analyticsData.sales_over_time.map(d => d.gross_sales || 1));
                            const percent = ((day.gross_sales || 0) / maxVal) * 100;
                            return (
                              <div key={idx} className="space-y-1">
                                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                                  <span>{day.day}</span>
                                  <span className="text-white font-extrabold">{day.gross_sales.toLocaleString(undefined, { minimumFractionDigits: 2 })} EUR ({day.order_count} {isArabic ? "طلبات" : "orders"})</span>
                                </div>
                                <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-850">
                                  <div 
                                    className="h-full bg-cyan-400 rounded-full transition-all duration-500" 
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                          {(!analyticsData.sales_over_time || analyticsData.sales_over_time.length === 0) && (
                            <p className="text-xs text-slate-500 text-center py-8">{isArabic ? "لا توجد بيانات مبيعات في الفترة المحددة" : "No sales logged during this period"}</p>
                          )}
                        </div>
                      </div>

                      {/* Top Stores Leaderboard */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                        <h4 className="font-extrabold text-xs text-white">{isArabic ? "أعلى 5 متاجر حسب حجم المبيعات" : "Top 5 Stores by Gross Volume"}</h4>
                        <div className="space-y-3">
                          {analyticsData.top_stores?.slice(0, 5).map((store, idx) => {
                            const maxVal = Math.max(...analyticsData.top_stores.map(s => s.gross_sales || 1));
                            const percent = ((store.gross_sales || 0) / maxVal) * 100;
                            return (
                              <div key={idx} className="space-y-1">
                                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                                  <span>{store.store_name}</span>
                                  <span className="text-white font-extrabold">{store.gross_sales.toLocaleString(undefined, { minimumFractionDigits: 2 })} EUR</span>
                                </div>
                                <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-850">
                                  <div 
                                    className="h-full bg-emerald-400 rounded-full transition-all duration-500" 
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                          {(!analyticsData.top_stores || analyticsData.top_stores.length === 0) && (
                            <p className="text-xs text-slate-500 text-center py-8">{isArabic ? "لم تسجل أي مبيعات بعد" : "No stores have recorded orders yet"}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Store Performance Matrix Table */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                      <h4 className="font-extrabold text-xs text-white">{isArabic ? "بيانات أداء المستأجرين التفصيلية" : "Detailed Tenant Performance Ledger"}</h4>
                      
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead>
                            <tr className="text-slate-500 text-[10px] uppercase font-bold border-b border-slate-850 bg-slate-950/40">
                              <th className="px-4 py-3">{isArabic ? "المتجر" : "Store Name"}</th>
                              <th className="px-4 py-3">{isArabic ? "الوضع" : "Status"}</th>
                              <th className="px-4 py-3">{isArabic ? "إجمالي المبيعات" : "Gross"}</th>
                              <th className="px-4 py-3">{isArabic ? "صافي المبيعات" : "Net"}</th>
                              <th className="px-4 py-3">{isArabic ? "الضريبة المستحقة" : "VAT"}</th>
                              <th className="px-4 py-3">{isArabic ? "الطلبات" : "Orders Count"}</th>
                              <th className="px-4 py-3">{isArabic ? "متوسط الطلب" : "Avg Order"}</th>
                              <th className="px-4 py-3">{isArabic ? "نقاط الدفع" : "Terminals"}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850/50 text-slate-300">
                            {analyticsData.store_performance?.map(perf => (
                              <tr key={perf.store_id} className="hover:bg-slate-850/20">
                                <td className="px-4 py-3 font-bold text-white">
                                  <button
                                    onClick={() => navigateToStoreDetail(perf.store_id)}
                                    className="hover:text-cyan-400 font-extrabold text-right cursor-pointer"
                                  >
                                    {perf.store_name}
                                  </button>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                    perf.store_status === 'Onboarded' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                                  }`}>
                                    {perf.store_status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-bold">{(perf.gross_sales || 0).toLocaleString()} EUR</td>
                                <td className="px-4 py-3">{(perf.net_sales || 0).toLocaleString()} EUR</td>
                                <td className="px-4 py-3 text-slate-400">{(perf.vat || 0).toLocaleString()} EUR</td>
                                <td className="px-4 py-3 font-mono">{perf.order_count || 0}</td>
                                <td className="px-4 py-3 font-bold text-white">{(perf.avg_order_value || 0).toLocaleString()} EUR</td>
                                <td className="px-4 py-3">
                                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                                    perf.terminal_status === 'Online' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-slate-850 text-slate-500'
                                  }`}>
                                    {perf.terminal_status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </div>
                ) : null}

              </div>
            )}

            {/* TAB: SYSTEM HEALTH */}
            {activeTab === 'system_health' && (
              <div className="space-y-6 animate-fade-in text-right">
                <div className="flex justify-between items-center bg-slate-900 p-5 rounded-2xl border border-slate-800">
                  <div>
                    <h3 className="font-extrabold text-sm text-white">{isArabic ? "مراقبة صحة النظام والأجهزة" : "Real-time System Health Monitor"}</h3>
                    <p className="text-[10px] text-slate-400 mt-1">{isArabic ? "حالة الخوادم، اتصالات أجهزة الدفع، والطلبات العالقة" : "Database status, Stripe webhook listeners, and reader connectivity heartbeats"}</p>
                  </div>
                  <button
                    onClick={fetchSystemHealth}
                    disabled={healthLoading}
                    className="bg-slate-850 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-slate-750 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
                    <span>{isArabic ? "تحديث الفحص" : "Ping Servers"}</span>
                  </button>
                </div>

                {healthLoading && !healthData ? (
                  <div className="h-96 bg-slate-900 rounded-3xl animate-pulse" />
                ) : healthData ? (
                  <div className="space-y-6">
                    
                    {/* Health metrics grid */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-xs">
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-slate-500 font-bold uppercase">{isArabic ? "اتصال قاعدة البيانات" : "PostgreSQL Database"}</p>
                          <span className="text-emerald-400 font-extrabold flex items-center gap-1">
                            <CheckCircle className="w-4 h-4" />
                            <span>{isArabic ? "متصل / ممتاز" : "Online / Reachable"}</span>
                          </span>
                        </div>
                        <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
                          <Server className="w-5 h-5" />
                        </div>
                      </div>

                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                        <div className="space-y-1 text-right">
                          <p className="text-slate-500 font-bold uppercase">{isArabic ? "آخر طلب ناجح" : "Last System Order"}</p>
                          <p className="text-white font-extrabold">{healthData.latest_order_time ? new Date(healthData.latest_order_time).toLocaleTimeString() : 'No Orders today'}</p>
                        </div>
                        <div className="p-3 bg-cyan-500/10 text-cyan-400 rounded-xl">
                          <CheckCircle className="w-5 h-5" />
                        </div>
                      </div>

                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                        <div className="space-y-1 text-right">
                          <p className="text-slate-500 font-bold uppercase">{isArabic ? "أجهزة دفع نشطة" : "Online Bridge/Readers"}</p>
                          <p className="text-white font-black">{healthData.total_terminals - healthData.offline_terminals} {isArabic ? "نشطة" : "online"} ({healthData.offline_terminals} {isArabic ? "غير متصلة" : "offline"})</p>
                        </div>
                        <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
                          <Terminal className="w-5 h-5" />
                        </div>
                      </div>

                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                        <div className="space-y-1 text-right">
                          <p className="text-slate-500 font-bold uppercase">{isArabic ? "المعاملات العالقة" : "Stuck Requests / Orders"}</p>
                          <p className="text-rose-400 font-black">{healthData.stuck_payments + healthData.stuck_pending + healthData.stuck_split} {isArabic ? "أخطاء / معاملات عالقة" : "stuck issues"}</p>
                        </div>
                        <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl">
                          <AlertCircle className="w-5 h-5" />
                        </div>
                      </div>
                    </div>

                    {/* Incidents and Terminals Table */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Incidents log */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                        <h4 className="font-extrabold text-xs text-white">{isArabic ? "بلاغات الأخطاء والمعاملات العالقة" : "Stuck Operations & System Alerts"}</h4>
                        <div className="space-y-3">
                          {healthData.incidents?.map((inc, idx) => (
                            <div key={idx} className="p-3 bg-slate-950 border border-slate-850 rounded-xl flex items-start gap-3 justify-between">
                              <div className="space-y-1">
                                <span className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[8px] font-bold px-1.5 py-0.2 rounded uppercase">
                                  {inc.incident_type}
                                </span>
                                <p className="text-[10px] text-white font-bold mt-1">{inc.store_name} - {inc.message}</p>
                                <p className="text-[8px] text-slate-500 font-mono select-all">UUID: {inc.entity_id}</p>
                              </div>
                              <span className="text-[9px] text-slate-500 shrink-0 font-bold">{new Date(inc.incident_time).toLocaleTimeString()}</span>
                            </div>
                          ))}
                          {(!healthData.incidents || healthData.incidents.length === 0) && (
                            <p className="text-xs text-slate-500 text-center py-8">{isArabic ? "لا توجد مشاكل معلقة حالياً في النظام" : "No incidents detected in the system"}</p>
                          )}
                        </div>
                      </div>

                      {/* Terminal health ledger */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                        <h4 className="font-extrabold text-xs text-white">{isArabic ? "حالة اتصال أجهزة الدفع (Terminals)" : "Card Readers & Bridge Heartbeats"}</h4>
                        <div className="space-y-3">
                          {healthData.terminals?.map((term, idx) => (
                            <div key={idx} className="p-3 bg-slate-950 border border-slate-850 rounded-xl flex items-center justify-between gap-3 text-xs">
                              <div>
                                <p className="font-bold text-white">{term.store_name} - {term.device_name || 'Terminal reader'}</p>
                                <p className="text-[9px] text-slate-500 font-mono mt-0.5 select-all">Serial: {term.stripe_reader_serial || 'N/A'}</p>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <span className={`text-[8px] font-black px-1.5 py-0.2 rounded border uppercase ${
                                  term.online_badge === 'online' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                }`}>
                                  {term.online_badge}
                                </span>
                              </div>
                            </div>
                          ))}
                          {(!healthData.terminals || healthData.terminals.length === 0) && (
                            <p className="text-xs text-slate-500 text-center py-8">{isArabic ? "لم يتم تكوين أي أجهزة دفع في النظام بعد" : "No terminals configured in the system"}</p>
                          )}
                        </div>
                      </div>

                    </div>

                  </div>
                ) : null}
              </div>
            )}

            {/* TAB: AUDIT LOGS */}
            {activeTab === 'audit_logs' && (
              <div className="space-y-6 animate-fade-in text-right">
                
                {/* Search / Filter header */}
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-semibold">
                  <div className="flex flex-wrap items-center gap-4 flex-1">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="w-4 h-4 text-slate-500 absolute top-3.5 right-3" />
                      <input
                        type="text"
                        value={auditActorQuery}
                        onChange={(e) => { setAuditActorQuery(e.target.value); setAuditPage(1); }}
                        placeholder={isArabic ? "البحث بالبريد الإلكتروني للآدمن..." : "Search by Admin Email..."}
                        className="w-full bg-slate-950 border border-slate-750 text-white rounded-xl pr-9 pl-4 py-2.5 text-xs focus:outline-none focus:border-cyan-500 font-bold"
                      />
                    </div>

                    <div className="space-y-1">
                      <select
                        value={auditActionFilter}
                        onChange={(e) => { setAuditActionFilter(e.target.value); setAuditPage(1); }}
                        className="bg-slate-950 border border-slate-750 text-white rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-cyan-500 font-bold"
                      >
                        <option value="all">{isArabic ? "جميع العمليات" : "All Actions"}</option>
                        <option value="update_feature_flag">{isArabic ? "تعديل الميزات" : "Feature Flag Updated"}</option>
                        <option value="maintenance_enabled">{isArabic ? "تفعيل الصيانة" : "Maintenance Enabled"}</option>
                        <option value="maintenance_disabled">{isArabic ? "إلغاء الصيانة" : "Maintenance Disabled"}</option>
                        <option value="store_created">{isArabic ? "إنشاء متجر" : "Store Created"}</option>
                        <option value="store_enabled">{isArabic ? "تفعيل متجر" : "Store Activated"}</option>
                        <option value="store_disabled">{isArabic ? "تعطيل متجر" : "Store Deactivated"}</option>
                        <option value="store_updated">{isArabic ? "تعديل متجر" : "Store Updated"}</option>
                        <option value="store_deleted">{isArabic ? "حذف متجر" : "Store Deleted"}</option>
                        <option value="user_added_to_store">{isArabic ? "إضافة مستخدم متجر" : "User Appended"}</option>
                        <option value="user_removed_from_store">{isArabic ? "إلغاء مستخدم متجر" : "User Revoked"}</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <select
                        value={auditEntityFilter}
                        onChange={(e) => { setAuditEntityFilter(e.target.value); setAuditPage(1); }}
                        className="bg-slate-950 border border-slate-750 text-white rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-cyan-500 font-bold"
                      >
                        <option value="all">{isArabic ? "جميع الكيانات" : "All Entity Types"}</option>
                        <option value="store">{isArabic ? "متجر" : "Store"}</option>
                        <option value="store_user">{isArabic ? "مستعمل" : "Store User"}</option>
                        <option value="payment_config">{isArabic ? "إعدادات الدفع" : "Payment Config"}</option>
                        <option value="pos_device">{isArabic ? "جهاز كاشير" : "POS Device"}</option>
                        <option value="terminal_device">{isArabic ? "جهاز قارئ كروت" : "Terminal"}</option>
                        <option value="store_feature_flag">{isArabic ? "ميزة متجر" : "Feature Flag"}</option>
                        <option value="system_maintenance">{isArabic ? "صيانة النظام" : "System Maintenance"}</option>
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={fetchAuditLogs}
                    disabled={auditLoading}
                    className="bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
                    <span>{isArabic ? "تحديث السجلات" : "Reload Logs"}</span>
                  </button>
                </div>

                {auditLoading && auditLogs.length === 0 ? (
                  <div className="h-96 bg-slate-900 rounded-3xl animate-pulse" />
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead>
                          <tr className="text-slate-500 text-[10px] uppercase font-bold border-b border-slate-800 bg-slate-850/40">
                            <th className="px-6 py-4">{isArabic ? "المسؤول" : "Actor Email"}</th>
                            <th className="px-6 py-4">{isArabic ? "العملية" : "Action"}</th>
                            <th className="px-6 py-4">{isArabic ? "نوع الكيان" : "Entity Type"}</th>
                            <th className="px-6 py-4">{isArabic ? "القيمة السابقة" : "Old Value"}</th>
                            <th className="px-6 py-4">{isArabic ? "القيمة الجديدة" : "New Value"}</th>
                            <th className="px-6 py-4">{isArabic ? "الوقت والتاريخ" : "Timestamp"}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850/50 text-slate-350">
                          {auditLogs.map(log => (
                            <tr key={log.id} className="hover:bg-slate-850/20 transition-colors">
                              <td className="px-6 py-4 font-bold text-white">
                                <div>
                                  <p>{log.actor_email || 'system'}</p>
                                  <p className="text-[9px] text-slate-500 font-mono select-all">{log.actor_user_id || 'system_role'}</p>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[9px] font-extrabold px-2 py-0.5 rounded font-mono">
                                  {log.action}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-bold uppercase text-[9.5px] text-slate-400 font-mono">{log.entity_type}</td>
                              <td className="px-6 py-4 font-mono text-[9px] max-w-[200px] truncate select-all" title={JSON.stringify(log.old_value)}>{JSON.stringify(log.old_value) || '-'}</td>
                              <td className="px-6 py-4 font-mono text-[9px] max-w-[200px] truncate select-all" title={JSON.stringify(log.new_value)}>{JSON.stringify(log.new_value) || '-'}</td>
                              <td className="px-6 py-4 text-slate-450">{new Date(log.created_at).toLocaleString()}</td>
                            </tr>
                          ))}
                          {auditLogs.length === 0 && (
                            <tr>
                              <td colSpan={6} className="py-12 text-center text-slate-500">{isArabic ? "لا توجد سجلات رقابة تطابق الفلاتر المحددة" : "No audit operations found matching filters"}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {auditTotalCount > auditPerPage && (
                      <div className="p-4 border-t border-slate-850 bg-slate-900/50 flex justify-between items-center text-xs font-bold text-slate-400">
                        <span>{isArabic ? `إجمالي السجلات: ${auditTotalCount}` : `Total Logs count: ${auditTotalCount}`}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                            disabled={auditPage === 1}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span>{isArabic ? `صفحة ${auditPage} من ${Math.ceil(auditTotalCount/auditPerPage)}` : `Page ${auditPage} of ${Math.ceil(auditTotalCount/auditPerPage)}`}</span>
                          <button
                            onClick={() => setAuditPage(p => p + 1)}
                            disabled={auditPage >= Math.ceil(auditTotalCount/auditPerPage)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )}
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
              <div className="space-y-6 max-w-2xl animate-fade-in text-right">
                
                {/* Maintenance Mode Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between items-start border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="font-extrabold text-sm text-white">{isArabic ? "إعدادات صيانة النظام" : "System Maintenance Settings"}</h3>
                      <p className="text-[10px] text-slate-400 mt-1">{isArabic ? "تفعيل صيانة شاملة أو صيانة مخصصة لمتاجر معينة" : "Manage scoped outages and warning messages for checkout points"}</p>
                    </div>
                    
                    <button
                      onClick={() => setShowMaintenanceModal(true)}
                      className="bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg transition-all cursor-pointer"
                    >
                      {isArabic ? "تهيئة وضع الصيانة" : "Configure Outage"}
                    </button>
                  </div>

                  <div className="bg-slate-950 p-4 border border-slate-850 rounded-xl flex items-center justify-between text-xs font-semibold">
                    <div>
                      <p className="text-white font-bold">{isArabic ? "حالة الصيانة العالمية حالياً" : "Global Maintenance Outage Status"}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{isArabic ? "تؤثر على جميع المستأجرين ونقاط البيع لمنع تلقي طلبات جديدة" : "Affects all tenant checkouts globally if activated"}</p>
                    </div>
                    
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                      globalMaintenance?.enabled 
                        ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    }`}>
                      {globalMaintenance?.enabled ? (isArabic ? 'نشط' : 'Active') : (isArabic ? 'معطل' : 'Disabled')}
                    </span>
                  </div>
                </div>

                {/* Database backup informational instruction card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                  <h3 className="font-extrabold text-sm text-white border-b border-slate-800 pb-3">{isArabic ? "النسخ الاحتياطي لقاعدة البيانات (Database Backups)" : "Database Backups Status"}</h3>
                  
                  <div className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-3 text-xs">
                    <div className="flex items-center gap-2 text-cyan-400 font-extrabold">
                      <Database className="w-4.5 h-4.5" />
                      <span>{isArabic ? "النسخ الاحتياطي السحابي نشط وتلقائي" : "Supabase Infrastructure Managed Backups"}</span>
                    </div>
                    
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      {isArabic 
                        ? "يتم تشغيل قاعدة بيانات Cashmint بالكامل على البنية التحتية السحابية لشركة Supabase. يتم أخذ نسخ احتياطية للمخطط والبيانات بشكل تلقائي ومجدول كل 24 ساعة (مع حماية واسترجاع بنقرة واحدة في حالات الطوارئ)."
                        : "The Cashmint application runs on managed Supabase server instances. Logical database backups and point-in-time recoveries are configured directly within the Supabase administration project dashboard."
                      }
                    </p>

                    <div className="border-t border-slate-850 pt-3 space-y-2 text-[10.5px]">
                      <p className="text-white font-bold">{isArabic ? "تعليمات إدارة النسخ الاحتياطي والاستعادة:" : "Instructions to manage and restore backups:"}</p>
                      <ul className="list-disc list-inside text-slate-500 space-y-1">
                        <li>{isArabic ? "1. افتح لوحة تحكم Supabase في المتصفح الخاص بك." : "1. Log into your Supabase Dashboard account."}</li>
                        <li>{isArabic ? `2. اختر المشروع المخصص للشبكة بالمعرف: pnffzpewnxeahspxofxo` : "2. Choose your live production project (ID: pnffzpewnxeahspxofxo)."}</li>
                        <li>{isArabic ? "3. انتقل إلى تبويب (Project Settings) ثم اختر (Database)." : "3. Navigate to 'Project Settings' and select 'Database'."}</li>
                        <li>{isArabic ? "4. انتقل لأسفل لقسم (Backups) للاطلاع على السجلات أو لتشغيل استعادة فورية." : "4. Scroll down to the 'Backups' section to view timestamps or trigger a restore."}</li>
                      </ul>
                    </div>
                  </div>
                </div>

              </div>
            )}

          </main>
        </div>

      </div>

      {/* Maintenance Mode Configuration Modal */}
      {showMaintenanceModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[320] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full shadow-2xl p-6 space-y-6 text-right">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-extrabold text-base text-white">{isArabic ? "تهيئة وإعداد وضع الصيانة" : "Configure Maintenance Outage"}</h3>
                <p className="text-[10px] text-cyan-400 font-bold mt-1">{isArabic ? "التحكم في مستويات الإغلاق المؤقت" : "Scope outage window and client notifications"}</p>
              </div>
              <button
                onClick={() => setShowMaintenanceModal(false)}
                className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMaintenanceConfig} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "نطاق الصيانة" : "Outage Scope"}</label>
                <select
                  value={maintScope}
                  onChange={(e) => setMaintScope(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                >
                  <option value="global">{isArabic ? "كامل النظام (جميع المتاجر)" : "Global (All Stores & POS)"}</option>
                  <option value="store">{isArabic ? "متجر مخصص فقط" : "Single Store Tenant"}</option>
                </select>
              </div>

              {maintScope === 'store' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "اختر المتجر المستهدف" : "Target Store"}</label>
                  <select
                    value={maintStoreId}
                    onChange={(e) => setMaintStoreId(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                    required
                  >
                    <option value="">{isArabic ? "-- اختر المتجر --" : "-- Select Store --"}</option>
                    {storesList.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-between p-3.5 bg-slate-850 border border-slate-750 rounded-xl">
                <div className="text-right">
                  <p className="text-xs font-bold text-white">{isArabic ? "تفعيل وضع الصيانة فوراً" : "Activate Maintenance Immediately"}</p>
                </div>
                <div 
                  onClick={() => setMaintEnabled(!maintEnabled)}
                  className={`w-9 h-5 rounded-full p-0.5 cursor-pointer flex items-center border transition-all duration-200 shrink-0 ${
                    maintEnabled 
                      ? 'bg-rose-500/20 border-rose-500/30 justify-end' 
                      : 'bg-slate-800 border-slate-750 justify-start'
                  }`}
                >
                  <div className={`w-3.8 h-3.8 rounded-full transition-all duration-200 ${
                    maintEnabled ? 'bg-rose-500' : 'bg-slate-500'
                  }`} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "رسالة الصيانة (عربي)" : "Outage Message (Arabic)"}</label>
                <input
                  type="text"
                  value={maintMsgAr}
                  onChange={(e) => setMaintMsgAr(e.target.value)}
                  placeholder="النظام حالياً تحت الصيانة للتحديث. يرجى المحاولة لاحقاً."
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">Outage Message (English)</label>
                <input
                  type="text"
                  value={maintMsgEn}
                  onChange={(e) => setMaintMsgEn(e.target.value)}
                  placeholder="The system is undergoing scheduled upgrades. Please try again soon."
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                  dir="ltr"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "وقت البدء" : "Outage Starts"}</label>
                  <input
                    type="datetime-local"
                    value={maintStartsAt}
                    onChange={(e) => setMaintStartsAt(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 font-mono text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "وقت الانتهاء المتوقع" : "Expected End"}</label>
                  <input
                    type="datetime-local"
                    value={maintEndAt}
                    onChange={(e) => setMaintEndAt(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 font-mono text-left"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={maintSubmitting}
                className="w-full py-3.5 bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-800 text-slate-950 rounded-xl font-extrabold text-xs shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
              >
                {maintSubmitting ? (
                  <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                ) : (
                  <span>{isArabic ? "حفظ وتطبيق التغييرات" : "Publish Outage Settings"}</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Super Admin Global AI Analyst */}
      <AIChatWidget isArabic={isArabic} isSuperAdmin={true} />
    </div>
  );
}
