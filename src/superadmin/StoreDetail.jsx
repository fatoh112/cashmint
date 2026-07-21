import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { 
  ArrowLeft, 
  Store, 
  Users, 
  CreditCard, 
  Laptop, 
  Settings, 
  Activity, 
  Shield, 
  UserPlus, 
  Trash2, 
  Plus, 
  Check, 
  AlertCircle, 
  RefreshCw,
  Clock,
  CheckCircle,
  Eye,
  Sliders,
  DollarSign
} from 'lucide-react';

export default function StoreDetail({ storeId, onBack, isArabic }) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'users', 'locations', 'devices', 'payments', 'flags', 'activity'
  const [store, setStore] = useState(null);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [devices, setDevices] = useState([]);
  const [paymentConfigs, setPaymentConfigs] = useState([]);
  const [featureFlags, setFeatureFlags] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [recentRefunds, setRecentRefunds] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [notification, setNotification] = useState(null);

  // User Drawer/Add form states
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('cashier');
  const [newUserAiEnabled, setNewUserAiEnabled] = useState(false);
  const [addingUser, setAddingUser] = useState(false);

  // Feature Flag config states
  const [editingFlagKey, setEditingFlagKey] = useState(null);
  const [flagConfigText, setFlagConfigText] = useState('{}');

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const loadStoreData = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);

      // 1. Fetch Store Base Info
      const { data: storeData, error: storeErr } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .single();
      if (storeErr) throw storeErr;
      setStore(storeData);

      // 2. Fetch Store Users
      const { data: userData, error: userErr } = await supabase
        .from('store_users')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (userErr) throw userErr;

      // Resolve emails in parallel using get_user_email RPC
      const usersWithEmails = await Promise.all(
        (userData || []).map(async (u) => {
          try {
            const { data: emailData, error: rpcErr } = await supabase
              .rpc('get_user_email', { user_uuid: u.user_id });
            if (rpcErr) throw rpcErr;
            return { ...u, email: emailData || 'No Email Registered' };
          } catch {
            return { ...u, email: 'Awaiting Resolution' };
          }
        })
      );
      setUsers(usersWithEmails);

      // 3. Fetch Locations
      const { data: locData, error: locErr } = await supabase
        .from('restaurant_locations')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (locErr) throw locErr;
      setLocations(locData || []);

      const locationIds = (locData || []).map(l => l.id);

      // 4. Fetch Devices (POS devices associated directly)
      const { data: posData, error: posErr } = await supabase
        .from('pos_devices')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (posErr) throw posErr;
      setDevices(posData || []);

      // 5. Fetch Payment Configs & Terminal Devices if locationIds exist
      if (locationIds.length > 0) {
        // Fetch Payment Configs
        const { data: payConfigs, error: payErr } = await supabase
          .from('restaurant_payment_configs')
          .select('*')
          .in('location_id', locationIds);
        if (payErr) throw payErr;
        setPaymentConfigs(payConfigs || []);

        // Fetch Terminal Devices (bridge / readers)
        const { data: terminals, error: termErr } = await supabase
          .from('terminal_devices')
          .select('*')
          .in('location_id', locationIds)
          .order('created_at', { ascending: false });
        if (termErr) throw termErr;
        
        // Merge POS devices and Terminal devices in a single view
        // (will display separately in the UI)
      } else {
        setPaymentConfigs([]);
      }

      // 6. Fetch Feature Flags
      const { data: flagData, error: flagErr } = await supabase
        .from('store_feature_flags')
        .select('*')
        .eq('store_id', storeId);
      if (flagErr) throw flagErr;

      const flagMap = {};
      // Seeding default features if not configured yet
      const defaultKeys = ['split_payment', 'stripe_terminal', 'menu_import', 'accounting_exports', 'onboarding_wizard', 'experimental_features'];
      defaultKeys.forEach(k => {
        flagMap[k] = { enabled: k === 'split_payment' ? (storeData.split_payment_enabled || false) : false, configuration: {} };
      });
      if (flagData) {
        flagData.forEach(f => {
          flagMap[f.feature_key] = { id: f.id, enabled: f.enabled, configuration: f.configuration };
        });
      }
      setFeatureFlags(flagMap);

      // 7. Fetch global analytics summary for this store
      // Last 30 days default
      const end = new Date().toISOString();
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: analyticData, error: analyticErr } = await supabase
        .rpc('superadmin_global_analytics', {
          p_start_date: start,
          p_end_date: end,
          p_store_id: storeId
        });
      if (!analyticErr && analyticData) {
        setAnalytics(analyticData);
      }

      // 8. Fetch recent activities
      const { data: ords, error: ordsErr } = await supabase
        .from('orders')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!ordsErr) setRecentOrders(ords || []);

      const { data: pmts, error: pmtsErr } = await supabase
        .from('payments')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!pmtsErr) setRecentPayments(pmts || []);

      const { data: rfds, error: rfdsErr } = await supabase
        .from('refunds')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!rfdsErr) setRecentRefunds(rfds || []);

      // Fetch superadmin audit logs for this store
      const { data: audits, error: auditErr } = await supabase
        .from('superadmin_audit_logs')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!auditErr) setAuditLogs(audits || []);

    } catch (err) {
      console.error('Error loading store detail data:', err);
      setError(isArabic ? 'فشل تحميل تفاصيل المتجر والتبعيات.' : 'Failed to fetch store details and credentials.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [storeId, isArabic]);

  useEffect(() => {
    loadStoreData();
  }, [loadStoreData]);

  // Toggle Feature Flag
  const handleToggleFlag = async (key, currentEnabled, currentConfig) => {
    try {
      const nextEnabled = !currentEnabled;
      // Call RPC
      const { error: rpcErr } = await supabase.rpc('superadmin_update_store_feature_flag', {
        p_store_id: storeId,
        p_feature_key: key,
        p_enabled: nextEnabled,
        p_configuration: currentConfig || {}
      });
      if (rpcErr) throw rpcErr;

      showNotification(
        isArabic 
          ? `تم تحديث ميزة ${key} بنجاح` 
          : `Feature flag ${key} updated successfully`
      );
      loadStoreData();
    } catch (err) {
      console.error('Error toggling feature flag:', err);
      showNotification(isArabic ? 'فشل تحديث الإعدادات' : 'Failed to update feature flag settings', 'error');
    }
  };

  // Save Feature Flag Config JSON
  const handleSaveFlagConfig = async (e) => {
    e.preventDefault();
    try {
      const parsedConfig = JSON.parse(flagConfigText);
      const flagObj = featureFlags[editingFlagKey];
      const { error: rpcErr } = await supabase.rpc('superadmin_update_store_feature_flag', {
        p_store_id: storeId,
        p_feature_key: editingFlagKey,
        p_enabled: flagObj.enabled,
        p_configuration: parsedConfig
      });
      if (rpcErr) throw rpcErr;

      showNotification(isArabic ? 'تم حفظ التكوين بنجاح' : 'Feature configuration saved successfully');
      setEditingFlagKey(null);
      loadStoreData();
    } catch (err) {
      console.error('Error saving feature config:', err);
      showNotification(isArabic ? 'JSON غير صالح أو حدث خطأ أثناء الحفظ' : 'Invalid JSON or error saving configuration', 'error');
    }
  };

  // Add User to Store
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUserEmail.trim() || !newUserPassword.trim()) return;

    try {
      setAddingUser(true);
      const { data, error: funcErr } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: newUserEmail.trim(),
          password: newUserPassword.trim(),
          role: newUserRole,
          store_id: storeId,
          ai_enabled: newUserAiEnabled
        }
      });

      if (funcErr) throw funcErr;
      if (data?.error) throw new Error(data.error);

      showNotification(
        isArabic 
          ? 'تم إنشاء وتعيين مستخدم المتجر بنجاح' 
          : 'Store user account created and assigned successfully'
      );
      setShowAddUserModal(false);
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('cashier');
      setNewUserAiEnabled(false);
      loadStoreData();
    } catch (err) {
      console.error('Error adding user:', err);
      showNotification(isArabic ? `فشل إضافة المستخدم: ${err.message}` : `Failed to add user: ${err.message}`, 'error');
    } finally {
      setAddingUser(false);
    }
  };

  // Delete/Revoke User Access
  const handleRevokeUser = async (u) => {
    const confirmMsg = isArabic 
      ? `هل أنت متأكد من إلغاء الصلاحية وحذف حساب "${u.email}"؟`
      : `Are you sure you want to revoke access and delete "${u.email}"?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const { data, error: deleteErr } = await supabase.functions.invoke('admin-delete-user', {
        body: { user_id: u.user_id }
      });

      if (deleteErr) throw deleteErr;
      if (data?.error) throw new Error(data.error);

      showNotification(isArabic ? 'تم إلغاء صلاحية المستخدم بنجاح' : 'User account access revoked successfully');
      loadStoreData();
    } catch (err) {
      console.error('Error deleting user:', err);
      showNotification(isArabic ? 'فشل إزالة صلاحيات المستخدم' : 'Failed to revoke user access', 'error');
    }
  };

  // Disable/Revoke POS device
  const handleToggleDeviceStatus = async (device) => {
    const nextStatus = device.status === 'active' ? 'disabled' : 'active';
    const confirmMsg = isArabic 
      ? `هل أنت متأكد من ${nextStatus === 'active' ? 'تفعيل' : 'تعطيل'} هذا الجهاز؟`
      : `Are you sure you want to ${nextStatus === 'active' ? 'enable' : 'disable'} this device?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const { error: deviceErr } = await supabase
        .from('pos_devices')
        .update({ status: nextStatus })
        .eq('id', device.id);
      if (deviceErr) throw deviceErr;

      showNotification(
        isArabic 
          ? `تم ${nextStatus === 'active' ? 'تفعيل' : 'تعطيل'} الجهاز بنجاح` 
          : `Device has been ${nextStatus} successfully`
      );
      loadStoreData();
    } catch (err) {
      console.error('Error updating device status:', err);
      showNotification(isArabic ? 'فشل تحديث حالة الجهاز' : 'Failed to update device status', 'error');
    }
  };

  // Sanitize Provider Config display
  const getSanitizedConfigString = (config) => {
    if (!config) return '{}';
    const sanitized = { ...config };
    const sensitiveKeys = ['secret', 'key', 'token', 'password', 'private', 'credential'];
    for (const k of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
        sanitized[k] = '********';
      }
    }
    return JSON.stringify(sanitized, null, 2);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 bg-slate-900 rounded-xl animate-pulse w-32" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-44 bg-slate-900 rounded-3xl animate-pulse" />
          <div className="h-44 bg-slate-900 rounded-3xl animate-pulse" />
          <div className="h-44 bg-slate-900 rounded-3xl animate-pulse" />
        </div>
        <div className="h-96 bg-slate-900 rounded-3xl animate-pulse" />
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="bg-rose-500/10 border border-rose-500/20 rounded-3xl p-8 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-400 mx-auto" />
        <h3 className="font-extrabold text-white text-lg">{isArabic ? "حدث خطأ" : "An Error Occurred"}</h3>
        <p className="text-slate-400 max-w-md mx-auto text-xs">{error || (isArabic ? "لم يتم العثور على هذا المتجر في قاعدة البيانات" : "Store record could not be loaded")}</p>
        <button
          onClick={onBack}
          className="bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl cursor-pointer transition-colors"
        >
          {isArabic ? "العودة للقائمة" : "Go Back to List"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in text-right" dir={isArabic ? "rtl" : "ltr"}>
      
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[300] px-6 py-3 rounded-xl shadow-xl transition-all duration-300 flex items-center gap-2 text-slate-950 font-bold ${
          notification.type === 'error' ? 'bg-rose-400' : 'bg-cyan-400'
        }`}>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header breadcrumb & info */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-10 h-10 bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-750 flex items-center justify-center transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-white">{store.name}</h2>
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${
                store.onboarding_completed 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}>
                {store.onboarding_completed ? (isArabic ? 'مكتمل الإعداد' : 'Onboarded') : (isArabic ? 'قيد الإعداد' : 'Pending Onboarding')}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold mt-1 font-mono">{store.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={loadStoreData}
            disabled={refreshing}
            className="w-10 h-10 bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-750 flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          {
            title: isArabic ? "مبيعات الشهر الإجمالية" : "Monthly Gross Sales",
            value: `${(analytics?.summary?.total_gross_sales || 0).toLocaleString(isArabic ? 'ar-BE' : 'en-BE', { minimumFractionDigits: 2 })} EUR`,
            icon: DollarSign,
            color: "text-emerald-400"
          },
          {
            title: isArabic ? "صافي المبيعات" : "Monthly Net Sales",
            value: `${(analytics?.summary?.total_net_sales || 0).toLocaleString(isArabic ? 'ar-BE' : 'en-BE', { minimumFractionDigits: 2 })} EUR`,
            icon: Activity,
            color: "text-cyan-400"
          },
          {
            title: isArabic ? "الأجهزة النشطة" : "Active POS Devices",
            value: devices.filter(d => d.status === 'active').length.toString(),
            icon: Laptop,
            color: "text-indigo-400"
          },
          {
            title: isArabic ? "مستخدمي المتجر" : "Assigned Staff",
            value: users.length.toString(),
            icon: Users,
            color: "text-amber-400"
          }
        ].map((card, idx) => {
          const Icon = card.icon;
          return (
            <div key={idx} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
              <div className="space-y-1.5 text-right">
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

      {/* Tabs list */}
      <div className="flex border-b border-slate-850 overflow-x-auto gap-2">
        {[
          { key: 'overview', label: isArabic ? "نظرة عامة" : "Overview" },
          { key: 'users', label: isArabic ? "المستخدمين" : "Users & Staff" },
          { key: 'locations', label: isArabic ? "الفروع والمواقع" : "Locations" },
          { key: 'devices', label: isArabic ? "أجهزة الكاشير" : "POS & Terminals" },
          { key: 'payments', label: isArabic ? "تهيئة الدفع" : "Payment Configurations" },
          { key: 'flags', label: isArabic ? "صلاحيات الميزات" : "Feature Flags" },
          { key: 'activity', label: isArabic ? "السجل والنشاط" : "Activity Logs" }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
              activeTab === tab.key 
                ? 'border-cyan-500 text-cyan-400 font-black' 
                : 'border-transparent text-slate-400 hover:text-white hover:border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab contents */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <h3 className="font-extrabold text-sm text-white border-b border-slate-800 pb-3">{isArabic ? "معلومات المتجر الأساسية" : "Store Summary Detail"}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs font-semibold">
              <div className="space-y-4">
                <div className="flex justify-between py-2 border-b border-slate-850/50">
                  <span className="text-slate-400">{isArabic ? "اسم المتجر" : "Store Name"}</span>
                  <span className="text-white font-extrabold">{store.name}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-850/50">
                  <span className="text-slate-400">{isArabic ? "نوع النشاط" : "Business Type"}</span>
                  <span className="text-white capitalize">{store.business_type}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-850/50">
                  <span className="text-slate-400">{isArabic ? "تاريخ التسجيل" : "Registration Date"}</span>
                  <span className="text-white">{new Date(store.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between py-2 border-b border-slate-850/50">
                  <span className="text-slate-400">{isArabic ? "معرف الموقع في HubRise" : "HubRise Location ID"}</span>
                  <span className="text-white font-mono select-all">{store.hubrise_location_id || 'Not Linked'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-850/50">
                  <span className="text-slate-400">{isArabic ? "مفتاح الربط HubRise" : "HubRise API Key"}</span>
                  <span className="text-white font-mono select-all">{store.hubrise_api_key ? '••••••••' : 'Not Linked'}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-850/50">
                  <span className="text-slate-400">{isArabic ? "العملة الافتراضية" : "Store Currency"}</span>
                  <span className="text-white font-bold">{store.currency || 'EUR'}</span>
                </div>
              </div>
            </div>

            {/* Sub-analytics for the store */}
            <div className="mt-8 space-y-4">
              <h4 className="font-bold text-xs text-slate-400">{isArabic ? "مؤشرات الأداء للشهر الحالي" : "Performance Indicators (30 Days)"}</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-right">
                <div className="bg-slate-950 p-4 border border-slate-850 rounded-xl space-y-1">
                  <p className="text-[9px] text-slate-500 font-bold uppercase">{isArabic ? "إجمالي الطلبات المكتملة" : "Completed Orders"}</p>
                  <p className="text-lg font-black text-white">{analytics?.summary?.completed_orders || 0}</p>
                </div>
                <div className="bg-slate-950 p-4 border border-slate-850 rounded-xl space-y-1">
                  <p className="text-[9px] text-slate-500 font-bold uppercase">{isArabic ? "متوسط قيمة الطلب" : "Average Order Value"}</p>
                  <p className="text-lg font-black text-white">{(analytics?.summary?.avg_order_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} EUR</p>
                </div>
                <div className="bg-slate-950 p-4 border border-slate-850 rounded-xl space-y-1">
                  <p className="text-[9px] text-slate-500 font-bold uppercase">{isArabic ? "إجمالي الضريبة (VAT)" : "Total Collected VAT"}</p>
                  <p className="text-lg font-black text-white">{(analytics?.summary?.total_vat || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} EUR</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: USERS & STAFF */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-extrabold text-sm text-white">{isArabic ? "إدارة مستخدمي المتجر" : "Staff & Members"}</h3>
              <button
                onClick={() => setShowAddUserModal(true)}
                className="bg-cyan-500 hover:bg-cyan-600 active:scale-98 text-slate-950 font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-cyan-500/10 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>{isArabic ? "إضافة مستخدم جديد" : "Add Staff Account"}</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase font-bold border-b border-slate-850 bg-slate-950/40">
                    <th className="px-4 py-3">{isArabic ? "المستخدم" : "Email"}</th>
                    <th className="px-4 py-3">{isArabic ? "الدور / الصلاحية" : "Role"}</th>
                    <th className="px-4 py-3">{isArabic ? "محلل الذكاء الاصطناعي" : "AI Access"}</th>
                    <th className="px-4 py-3">{isArabic ? "تاريخ التعيين" : "Assigned At"}</th>
                    <th className="px-4 py-3 text-center">{isArabic ? "الإجراءات" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850/50 text-xs text-slate-350">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-slate-850/20">
                      <td className="px-4 py-3 font-bold text-white">
                        <div>
                          <p dir="ltr" className="text-right">{u.email}</p>
                          <p dir="ltr" className="text-[9px] text-slate-500 font-mono mt-0.5 select-all">{u.user_id}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.role === 'admin' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'bg-slate-800 text-slate-400 border border-slate-700/60'
                        }`}>
                          {u.role === 'admin' ? (isArabic ? 'مدير الفرع' : 'Admin') : (isArabic ? 'كاشير' : 'Cashier')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold ${u.ai_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {u.ai_enabled ? (isArabic ? 'مفعل' : 'Enabled') : (isArabic ? 'معطل' : 'Disabled')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-450">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleRevokeUser(u)}
                          className="p-2 hover:bg-slate-850 text-slate-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                          title={isArabic ? "إلغاء الصلاحية وحذف الحساب" : "Delete user"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">{isArabic ? "لا يوجد مستخدمون معينون لهذا المتجر" : "No staff members mapped to this store"}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: LOCATIONS */}
        {activeTab === 'locations' && (
          <div className="space-y-6">
            <h3 className="font-extrabold text-sm text-white border-b border-slate-800 pb-3">{isArabic ? "فروع ومواقع المتجر" : "Store Locations"}</h3>
            
            <div className="grid grid-cols-1 gap-4">
              {locations.map(loc => {
                const config = paymentConfigs.find(c => c.location_id === loc.id);
                return (
                  <div key={loc.id} className="bg-slate-950 p-5 rounded-2xl border border-slate-850 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-white">{loc.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono select-all">{loc.id}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[9px] font-bold px-1.5 py-0.2 bg-slate-900 border border-slate-800 rounded text-slate-400">
                          {isArabic ? `العملة: ${loc.currency}` : `Currency: ${loc.currency}`}
                        </span>
                        {config ? (
                          <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
                            {config.provider_type} ({config.is_enabled ? (isArabic ? 'نشط' : 'Enabled') : (isArabic ? 'معطل' : 'Disabled')})
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-full">
                            {isArabic ? "لم يتم تكوين دفع كارد" : "No Card Payment Config"}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1 text-left">
                      <p className="text-[10px] text-slate-500 font-bold">{isArabic ? "تاريخ الإنشاء" : "Created At"}</p>
                      <p className="text-xs text-white">{new Date(loc.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                );
              })}
              {locations.length === 0 && (
                <div className="py-8 text-center text-slate-500 border border-slate-850 border-dashed rounded-2xl">{isArabic ? "لا توجد فروع مضافة حالياً" : "No locations found for this store"}</div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: DEVICES & TERMINALS */}
        {activeTab === 'devices' && (
          <div className="space-y-6">
            <h3 className="font-extrabold text-sm text-white border-b border-slate-800 pb-3">{isArabic ? "أجهزة نقاط البيع والـ Terminals" : "Hardware & Connections"}</h3>
            
            <div className="space-y-4">
              <h4 className="font-bold text-xs text-slate-400">{isArabic ? "أجهزة نقاط البيع المسجلة (POS)" : "Active Register / POS Devices"}</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead>
                    <tr className="text-slate-500 text-[10px] uppercase font-bold border-b border-slate-850 bg-slate-950/40">
                      <th className="px-4 py-3">{isArabic ? "اسم الجهاز / المعرف" : "Device Detail"}</th>
                      <th className="px-4 py-3">{isArabic ? "الرمز (POS Code)" : "Activation Code"}</th>
                      <th className="px-4 py-3">{isArabic ? "الحالة" : "Device Status"}</th>
                      <th className="px-4 py-3">{isArabic ? "تاريخ الإضافة" : "Added Date"}</th>
                      <th className="px-4 py-3 text-center">{isArabic ? "تغيير الحالة" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850/50 text-xs text-slate-350">
                    {devices.map(dev => (
                      <tr key={dev.id} className="hover:bg-slate-850/20">
                        <td className="px-4 py-3 font-bold text-white">
                          <div>
                            <p>{dev.display_name || 'POS Register'}</p>
                            <p className="text-[9px] text-slate-500 font-mono select-all">{dev.id}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-400 select-all">{dev.pos_code || 'Activated'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            dev.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {dev.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-450">{new Date(dev.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleDeviceStatus(dev)}
                            className={`font-bold text-[10px] px-2.5 py-1 rounded transition-colors cursor-pointer border ${
                              dev.status === 'active' 
                                ? 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-slate-950' 
                                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-slate-950'
                            }`}
                          >
                            {dev.status === 'active' ? (isArabic ? 'تعطيل' : 'Disable') : (isArabic ? 'تفعيل' : 'Enable')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {devices.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">{isArabic ? "لم يتم تسجيل أي أجهزة كاشير بعد" : "No registered POS devices found"}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: PAYMENTS */}
        {activeTab === 'payments' && (
          <div className="space-y-6">
            <h3 className="font-extrabold text-sm text-white border-b border-slate-800 pb-3">{isArabic ? "بوابات الدفع المسجلة" : "Payment Configurations"}</h3>
            
            <div className="grid grid-cols-1 gap-6">
              {paymentConfigs.map(config => (
                <div key={config.id} className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-black text-cyan-400 font-mono uppercase">{config.provider_type}</h4>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5 select-all">{config.id}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      config.is_enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {config.is_enabled ? (isArabic ? 'نشط' : 'Active') : (isArabic ? 'معطل' : 'Disabled')}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-500 block">{isArabic ? "معلومات التكوين المجهزة (عرض غير حساس)" : "Sanitized Provider Parameters"}</p>
                    <pre className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-[10px] font-mono text-slate-350 overflow-x-auto text-left" dir="ltr">
                      {getSanitizedConfigString(config.provider_config)}
                    </pre>
                  </div>
                </div>
              ))}
              {paymentConfigs.length === 0 && (
                <div className="py-8 text-center text-slate-500 border border-slate-850 border-dashed rounded-2xl">{isArabic ? "لم يتم تكوين بوابات دفع كارد لهذا المتجر بعد" : "No payment configurations found"}</div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: FEATURE FLAGS */}
        {activeTab === 'flags' && (
          <div className="space-y-6">
            <h3 className="font-extrabold text-sm text-white border-b border-slate-800 pb-3">{isArabic ? "التحكم بميزات وخصائص المتجر" : "Store Level Feature Flags"}</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.keys(featureFlags).map(key => {
                const flag = featureFlags[key];
                return (
                  <div key={key} className="bg-slate-950 p-5 rounded-2xl border border-slate-850 flex flex-col justify-between space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="text-right">
                        <p className="text-xs font-bold text-white font-mono">{key}</p>
                        <p className="text-[9px] text-slate-500 mt-1">
                          {key === 'split_payment' && (isArabic ? "تمكين تقسيم الدفع كاش/كارد" : "Allows split checkout (cash/card portions)")}
                          {key === 'stripe_terminal' && (isArabic ? "ربط أجهزة الدفع stripe" : "In-store Stripe Terminal reader payments")}
                          {key === 'menu_import' && (isArabic ? "استيراد كتالوج المنتجات" : "CSV and external HubRise catalog imports")}
                          {key === 'accounting_exports' && (isArabic ? "تقارير تصدير المحاسبة والضريبة" : "Daily closings exports and fiscal snapshots")}
                          {key === 'onboarding_wizard' && (isArabic ? "معالج الإعداد الأولي" : "Step-by-step onboarding configurations wizard")}
                          {key === 'experimental_features' && (isArabic ? "ميزات تجريبية" : "Developer/unstable sandbox settings")}
                        </p>
                      </div>
                      
                      <div 
                        onClick={() => handleToggleFlag(key, flag.enabled, flag.configuration)}
                        className={`w-9 h-5 rounded-full p-0.5 cursor-pointer flex items-center border transition-all duration-200 shrink-0 ${
                          flag.enabled 
                            ? 'bg-cyan-500/20 border-cyan-500/30 justify-end' 
                            : 'bg-slate-800 border-slate-750 justify-start'
                        }`}
                      >
                        <div className={`w-3.8 h-3.8 rounded-full transition-all duration-200 ${
                          flag.enabled ? 'bg-cyan-400' : 'bg-slate-500'
                        }`} />
                      </div>
                    </div>

                    <div className="flex justify-between items-center border-t border-slate-900 pt-3">
                      <span className="text-[9px] text-slate-500 font-bold">{isArabic ? "تكوين إضافي JSON" : "Configuration JSON"}</span>
                      <button
                        onClick={() => {
                          setEditingFlagKey(key);
                          setFlagConfigText(JSON.stringify(flag.configuration || {}, null, 2));
                        }}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>{isArabic ? "تعديل التكوين" : "Configure Parameters"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 7: ACTIVITY & INCIDENTS */}
        {activeTab === 'activity' && (
          <div className="space-y-6">
            <h3 className="font-extrabold text-sm text-white border-b border-slate-800 pb-3">{isArabic ? "سجلات النشاط والمعاملات" : "Transactions & Audit History"}</h3>
            
            <div className="space-y-6">
              {/* Recent Orders */}
              <div className="space-y-3">
                <h4 className="font-bold text-xs text-slate-400">{isArabic ? "آخر المبيعات والطلبات" : "Recent Orders"}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="text-slate-500 text-[9px] font-bold border-b border-slate-850 bg-slate-950/20">
                        <th className="px-4 py-2">{isArabic ? "الطلب" : "Order ID"}</th>
                        <th className="px-4 py-2">{isArabic ? "الحالة" : "Status"}</th>
                        <th className="px-4 py-2">{isArabic ? "القيمة" : "Amount"}</th>
                        <th className="px-4 py-2">{isArabic ? "تاريخ الطلب" : "Completed At"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850/40 text-slate-350">
                      {recentOrders.map(o => (
                        <tr key={o.id}>
                          <td className="px-4 py-2 font-mono select-all">{o.id.substring(0,8)}...</td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase ${
                              o.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {o.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-bold text-white">{(o.total_amount || 0).toLocaleString()} EUR</td>
                          <td className="px-4 py-2 text-slate-450">{new Date(o.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                      {recentOrders.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-slate-500">{isArabic ? "لا توجد طلبات مسجلة" : "No recent orders"}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit Logs */}
              <div className="space-y-3 mt-6">
                <h4 className="font-bold text-xs text-slate-400">{isArabic ? "تغييرات المشرفين على الفرع" : "Admin Operations log"}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="text-slate-500 text-[9px] font-bold border-b border-slate-850 bg-slate-950/20">
                        <th className="px-4 py-2">{isArabic ? "المسؤول" : "Actor"}</th>
                        <th className="px-4 py-2">{isArabic ? "الإجراء" : "Action"}</th>
                        <th className="px-4 py-2">{isArabic ? "التفاصيل" : "Details"}</th>
                        <th className="px-4 py-2">{isArabic ? "التاريخ" : "Timestamp"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850/40 text-slate-350">
                      {auditLogs.map(log => (
                        <tr key={log.id}>
                          <td className="px-4 py-2 font-bold text-white truncate max-w-[120px]">{log.actor_email || 'system'}</td>
                          <td className="px-4 py-2 text-cyan-400 font-bold font-mono text-[10px]">{log.action}</td>
                          <td className="px-4 py-2 font-mono text-[9px] truncate max-w-[180px]">{JSON.stringify(log.new_value)}</td>
                          <td className="px-4 py-2 text-slate-450">{new Date(log.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                      {auditLogs.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-slate-500">{isArabic ? "لا توجد سجلات تعديل" : "No admin operations logged"}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[320] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-6 text-right">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="font-extrabold text-base text-white">{isArabic ? "إنشاء وتعيين مستخدم المتجر" : "Register Store User"}</h3>
              <button
                onClick={() => setShowAddUserModal(false)}
                className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "البريد الإلكتروني" : "Email Address"}</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                  dir="ltr"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "كلمة المرور" : "Password"}</label>
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                  dir="ltr"
                  minLength={6}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block">{isArabic ? "الدور / الصلاحية" : "Assign Role"}</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                >
                  <option value="cashier">{isArabic ? "كاشير / موظف مبيعات" : "Cashier"}</option>
                  <option value="admin">{isArabic ? "مدير الفرع / Admin" : "Store Admin"}</option>
                </select>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-slate-850 border border-slate-750 rounded-xl">
                <div className="text-right">
                  <p className="text-xs font-bold text-white">{isArabic ? "صلاحية الذكاء الاصطناعي" : "AI Access Permission"}</p>
                </div>
                <div 
                  onClick={() => setNewUserAiEnabled(!newUserAiEnabled)}
                  className={`w-9 h-5 rounded-full p-0.5 cursor-pointer flex items-center border transition-all duration-200 shrink-0 ${
                    newUserAiEnabled 
                      ? 'bg-cyan-500/20 border-cyan-500/30 justify-end' 
                      : 'bg-slate-800 border-slate-750 justify-start'
                  }`}
                >
                  <div className={`w-3.8 h-3.8 rounded-full transition-all duration-200 ${
                    newUserAiEnabled ? 'bg-cyan-400' : 'bg-slate-500'
                  }`} />
                </div>
              </div>

              <button
                type="submit"
                disabled={addingUser}
                className="w-full py-3.5 bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-800 text-slate-950 disabled:text-slate-550 rounded-xl font-extrabold text-xs shadow-lg shadow-cyan-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
              >
                {addingUser ? (
                  <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                ) : (
                  <span>{isArabic ? "إنشاء وتعيين المستخدم" : "Create & Assign User"}</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Feature Flag Config Modal */}
      {editingFlagKey && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[320] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full shadow-2xl p-6 space-y-6 text-right">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-extrabold text-base text-white">{isArabic ? "تعديل إعدادات الميزة" : "Feature parameters config"}</h3>
                <p className="text-[10px] text-cyan-400 font-mono font-bold mt-1">{editingFlagKey}</p>
              </div>
              <button
                onClick={() => setEditingFlagKey(null)}
                className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleSaveFlagConfig} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 block text-left">Configuration JSON</label>
                <textarea
                  value={flagConfigText}
                  onChange={(e) => setFlagConfigText(e.target.value)}
                  rows={8}
                  className="w-full px-4 py-3 bg-slate-850 border border-slate-750 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-cyan-500 text-left"
                  dir="ltr"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-3.5 bg-cyan-500 hover:bg-cyan-600 text-slate-950 rounded-xl font-extrabold text-xs shadow-lg shadow-cyan-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
              >
                <span>{isArabic ? "حفظ التغييرات" : "Save Configuration"}</span>
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// Inline X replacement since we had some issues importing X
function X(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
  );
}
