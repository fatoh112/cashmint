import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { printReceipt } from '../utils/printerService';
import PrintingDiagnosticsModal from '../components/admin/PrintingDiagnosticsModal';
import { 
  Printer, 
  Globe, 
  Check, 
  AlertCircle,
  CreditCard,
  Tv,
  Power,
  Coins,
  ShieldAlert,
  RefreshCw,
  Trash2,
  Copy,
  CheckCheck
} from 'lucide-react';

export default function IntegrationSettings({ store, setStore, showNotification, isArabic }) {
  const [printerIP, setPrinterIP] = useState(localStorage.getItem('local_printer_ip') || '');
  const [hubriseLocId, setHubriseLocId] = useState(store?.hubrise_location_id || '');
  const [hubriseApiKey, setHubriseApiKey] = useState(store?.hubrise_api_key || '');
  
  const [saving, setSaving] = useState(false);
  const [testingPrinter, setTestingPrinter] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [secretTapCount, setSecretTapCount] = useState(0);

  // Auto-print output toggles
  const [autoPrintCashier, setAutoPrintCashier] = useState(() => localStorage.getItem('auto_print_cashier') !== 'false');
  const [autoPrintCustomer, setAutoPrintCustomer] = useState(() => localStorage.getItem('auto_print_customer') === 'true');
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(() => localStorage.getItem('auto_print_kitchen') !== 'false');



  // Device Monitor & Activation States
  const [deviceTab, setDeviceTab] = useState('pos'); // 'pos' | 'payment'
  const [devices, setDevices] = useState([]);
  const [terminalDevices, setTerminalDevices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loadingMonitor, setLoadingMonitor] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [latestCode, setLatestCode] = useState('');
  const [latestTerminalCode, setLatestTerminalCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.removeItem('stripe_api_key');
    localStorage.removeItem('stripe_webhook_secret');
    localStorage.removeItem('stripe_terminal_id');
  }, []);

  useEffect(() => {
    if (store) {
      setHubriseLocId(store.hubrise_location_id || '');
      setHubriseApiKey(store.hubrise_api_key || '');
    }
  }, [store]);

  const handleCopyCode = async () => {
    if (!latestCode) return;
    try {
      await navigator.clipboard.writeText(latestCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showNotification(isArabic ? "تم نسخ الرمز إلى الحافظة!" : "Code copied to clipboard!", "success");
    } catch (err) {
      console.error("Failed to copy code:", err);
      showNotification(isArabic ? "فشل نسخ الرمز" : "Failed to copy code", "error");
    }
  };

  const fetchDevicesAndSessions = useCallback(async (isSilent = false) => {
    if (!store?.id) return;
    try {
      if (!isSilent) {
        setLoadingMonitor(prev => devices.length === 0 ? true : prev);
      }
      const { data: devs, error: devsErr } = await supabase
        .from('pos_devices')
        .select('*')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false });

      if (devsErr) throw devsErr;
      setDevices(devs || []);

      // Resolve actual restaurant_locations IDs for current store
      const { data: locs, error: locsErr } = await supabase
        .from('restaurant_locations')
        .select('id')
        .or(`store_id.eq.${store.id},id.eq.${store.id}`);

      if (locsErr) throw locsErr;

      const locationIds = Array.from(new Set((locs || []).map(l => l.id).filter(Boolean)));

      if (locationIds.length > 0) {
        const { data: terminals, error: terminalErr } = await supabase
          .from('terminal_devices')
          .select('id, display_name, status, reader_status, last_heartbeat_at, current_payment_request_id, app_version, location_id')
          .in('location_id', locationIds)
          .order('created_at', { ascending: false });
        if (terminalErr) throw terminalErr;
        setTerminalDevices(terminals || []);
      } else {
        setTerminalDevices([]);
      }

      if (devs && devs.length > 0) {
        const deviceIds = devs.map(d => d.id);
        const { data: sess, error: sessErr } = await supabase
          .from('cashier_sessions')
          .select('*')
          .in('device_id', deviceIds)
          .order('opened_at', { ascending: false });

        if (sessErr) throw sessErr;
        setSessions(sess || []);
      } else {
        setSessions([]);
      }

      const { data: ords, error: ordsErr } = await supabase
        .from('orders')
        .select('id, total_amount, created_at, status, raw_payload')
        .eq('store_id', store.id);

      if (ordsErr) throw ordsErr;
      setOrders(ords || []);
    } catch (err) {
      console.error("Error fetching monitor data:", err);
    } finally {
      setLoadingMonitor(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (!store?.id) return;
    fetchDevicesAndSessions(false);

    let isMounted = true;
    let channel = null;

    const setupSubscriptions = async () => {
      const { data: locs } = await supabase
        .from('restaurant_locations')
        .select('id')
        .or(`store_id.eq.${store.id},id.eq.${store.id}`);

      if (!isMounted) return;

      const locationIds = Array.from(new Set((locs || []).map(l => l.id).filter(Boolean)));

      channel = supabase.channel(`backoffice-device-monitor-${store.id}`);

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pos_devices', filter: `store_id=eq.${store.id}` },
        () => { fetchDevicesAndSessions(true); }
      );

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cashier_sessions' },
        () => { fetchDevicesAndSessions(true); }
      );

      locationIds.forEach(locId => {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'terminal_devices', filter: `location_id=eq.${locId}` },
          () => { fetchDevicesAndSessions(true); }
        );
      });

      channel.subscribe();
    };

    setupSubscriptions();

    return () => {
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [store?.id, fetchDevicesAndSessions]);

  const generateActivationCode = async (e) => {
    e.preventDefault();
    if (!deviceName.trim()) {
      showNotification(isArabic ? "الرجاء إدخال اسم الجهاز أولاً" : "Please enter a device name first", "error");
      return;
    }

    try {
      setGeneratingCode(true);
      const { data, error } = await supabase.rpc('generate_pos_activation_code', {
        p_store_id: store.id,
        p_device_name: deviceName.trim(),
        p_expiry_minutes: 15
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || (isArabic ? 'فشل إنشاء كود التفعيل' : 'Failed to generate code'));
      }

      setLatestCode(data.activation_code);
      setDeviceName('');
      showNotification(isArabic ? "تم إنشاء رمز التفعيل بنجاح! ينتهي خلال 15 دقيقة." : "Activation code generated! Expires in 15 minutes.", "success");
      fetchDevicesAndSessions();
    } catch (err) {
      console.error("Error generating activation code:", err);
      showNotification(err.message || (isArabic ? "فشل إنشاء رمز التفعيل" : "Failed to generate activation code"), "error");
    } finally {
      setGeneratingCode(false);
    }
  };

  const generateTerminalEnrollmentCode = async () => {
    if (!store?.id) return;
    try {
      setGeneratingCode(true);
      const { data, error } = await supabase.functions.invoke('create-terminal-enrollment-code', {
        body: { store_id: store.id }
      });
      if (error) throw error;
      setLatestTerminalCode(data.enrollment_code);
      showNotification(isArabic ? "تم إنشاء كود ربط قارئ البطاقة" : "Payment bridge enrollment code generated", "success");
    } catch (err) {
      console.error("Error generating terminal enrollment code:", err);
      showNotification(err.message || (isArabic ? "فشل إنشاء كود ربط قارئ البطاقة" : "Failed to generate payment bridge code"), "error");
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleToggleDeviceStatus = async (deviceId, currentStatus) => {
    try {
      const nextStatus = currentStatus === 'active' ? 'disabled' : 'active';
      const { data, error } = await supabase.rpc('set_pos_device_status', {
        p_device_id: deviceId,
        p_new_status: nextStatus,
        p_store_id: store.id
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update device status');

      showNotification(
        isArabic 
          ? (nextStatus === 'disabled' ? "تم إيقاف تفعيل الجهاز بنجاح" : "تم تفعيل الجهاز بنجاح")
          : (nextStatus === 'disabled' ? "Device disabled successfully" : "Device activated successfully"),
        "success"
      );
      fetchDevicesAndSessions();
    } catch (err) {
      console.error("Error updating device status:", err);
      showNotification(err.message || (isArabic ? "فشل تحديث حالة الجهاز" : "Failed to update device status"), "error");
    }
  };

  const handleRevokeDevice = async (deviceId) => {
    const confirmRevoke = window.confirm(
      isArabic
        ? "هل أنت متأكد من إلغاء تفعيل (Revoke) هذا الجهاز نهائياً؟ سيحتاج الجهاز إلى كود تفعيل جديد."
        : "Are you sure you want to revoke this device permanently? The device will require a new activation code."
    );
    if (!confirmRevoke) return;

    try {
      const { data, error } = await supabase.rpc('set_pos_device_status', {
        p_device_id: deviceId,
        p_new_status: 'revoked',
        p_store_id: store.id
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to revoke device');

      showNotification(
        isArabic ? "تم إلغاء تفعيل الجهاز نهائياً" : "Device revoked successfully",
        "success"
      );
      fetchDevicesAndSessions();
    } catch (err) {
      console.error("Error revoking device:", err);
      showNotification(err.message || (isArabic ? "فشل إلغاء تفعيل الجهاز" : "Failed to revoke device"), "error");
    }
  };

  const handleDeleteDevice = async (deviceId) => {
    const confirmDelete = window.confirm(
      isArabic 
        ? "هل أنت متأكد من حذف هذا الجهاز نهائياً؟ سيتم حذف جميع الورديات المرتبطة به." 
        : "Are you sure you want to delete this device permanently? All linked cashier sessions will be deleted."
    );
    if (!confirmDelete) return;

    try {
      const { error } = await supabase
        .from('pos_devices')
        .delete()
        .eq('id', deviceId);

      if (error) throw error;
      showNotification(
        isArabic ? "تم حذف الجهاز بنجاح" : "Device deleted successfully",
        "success"
      );
      fetchDevicesAndSessions();
    } catch (err) {
      console.error("Error deleting device:", err);
      showNotification(isArabic ? "فشل حذف الجهاز" : "Failed to delete device", "error");
    }
  };

  const handleDeleteShift = async (sessionId) => {
    const confirmDelete = window.confirm(
      isArabic 
        ? "هل أنت متأكد من حذف هذه الوردية نهائياً من قاعدة البيانات؟" 
        : "Are you sure you want to delete this shift session permanently?"
    );
    if (!confirmDelete) return;

    try {
      const { error } = await supabase
        .from('cashier_sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;
      
      showNotification(
        isArabic ? "تم حذف الوردية بنجاح" : "Shift deleted successfully",
        "success"
      );
      
      // Update local state instantly
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (err) {
      console.error("Error deleting shift:", err);
      showNotification(isArabic ? "فشل حذف الوردية" : "Failed to delete shift", "error");
    }
  };

  const handleClearTerminalRequest = async (terminalId) => {
    try {
      const { error } = await supabase
        .from('terminal_devices')
        .update({ current_payment_request_id: null })
        .eq('id', terminalId)
        .eq('location_id', store.id);

      if (error) throw error;
      showNotification(
        isArabic ? "تم تفريغ طلب الدفع المعلق بنجاح" : "Stale payment request cleared successfully",
        "success"
      );
      fetchDevicesAndSessions(true);
    } catch (err) {
      console.error("Error clearing payment request:", err);
      showNotification(isArabic ? "فشل تفريغ طلب الدفع" : "Failed to clear payment request", "error");
    }
  };

  const isDeviceOnline = (lastActiveAt) => {
    if (!lastActiveAt) return false;
    const activeTime = new Date(lastActiveAt).getTime();
    const oneMinuteAgo = Date.now() - 60000;
    return activeTime > oneMinuteAgo;
  };

  const calculateSessionMetrics = (session) => {
    const openedTime = new Date(session.opened_at).getTime();
    const closedTime = session.closed_at ? new Date(session.closed_at).getTime() : Date.now();

    const sessionOrders = orders.filter(o => {
      // 1. Direct session linkage check in raw_payload
      const rawPayload = o.raw_payload || {};
      const orderSessionId = rawPayload.cashier_session_id || rawPayload.shift_id;
      if (orderSessionId) {
        return orderSessionId === session.id && (o.status === 'completed' || o.status === 'new');
      }

      // 2. Fallback to time-based matching
      const orderTime = new Date(o.created_at).getTime();
      const isWithinTime = orderTime >= openedTime && orderTime <= closedTime;
      const isSuccessful = o.status === 'completed' || o.status === 'new';
      return isWithinTime && isSuccessful;
    });

    const totalProcessedFromOrders = sessionOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);

    // Sum completed orders or use total_sales (revenue) column in cashier_sessions as fallback
    const totalProcessed = totalProcessedFromOrders > 0 
      ? totalProcessedFromOrders 
      : parseFloat(session.total_sales || 0);

    const openingBal = parseFloat(session.opening_balance || 0);
    const closingBal = openingBal + totalProcessed;

    return {
      totalProcessed,
      closingBalance: closingBal
    };
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      // 1. Save local printer IP and auto-print output toggles
      localStorage.setItem('local_printer_ip', printerIP);
      localStorage.setItem('auto_print_cashier', autoPrintCashier ? 'true' : 'false');
      localStorage.setItem('auto_print_customer', autoPrintCustomer ? 'true' : 'false');
      localStorage.setItem('auto_print_kitchen', autoPrintKitchen ? 'true' : 'false');

      // 2. Save HubRise settings to database
      if (store) {
        const { error } = await supabase
          .from('stores')
          .update({
            hubrise_location_id: hubriseLocId || null,
            hubrise_api_key: hubriseApiKey || null
          })
          .eq('id', store.id);

        if (error) throw error;
        
        // Update parent store state
        setStore({
          ...store,
          hubrise_location_id: hubriseLocId,
          hubrise_api_key: hubriseApiKey
        });
      }

      showNotification(isArabic ? "تم حفظ جميع الإعدادات والربط بنجاح" : "All settings saved and integrated successfully");
    } catch (err) {
      console.error("Error saving integration settings:", err);
      showNotification(isArabic ? "خطأ أثناء حفظ الإعدادات" : "Error saving configuration settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleClearStripeSettings = () => {
    localStorage.removeItem('stripe_api_key');
    localStorage.removeItem('stripe_webhook_secret');
    localStorage.removeItem('stripe_terminal_id');
    showNotification(isArabic ? 'تم مسح إعدادات Stripe من هذا الجهاز' : 'Stripe settings cleared from this device', 'success');
  };

  const handleTestPrint = async () => {
    if (!printerIP) {
      showNotification(isArabic ? "الرجاء إدخال عنوان IP أولاً" : "Please configure a Printer IP address first", "error");
      return;
    }

    try {
      setTestingPrinter(true);
      showNotification(isArabic ? "جاري إرسال طباعة تجريبية للشبكة..." : "Sending local network test print...", "info");
      
      const dummyOrder = {
        total_amount: 12.50,
        raw_payload: {
          cart_items: [
            { name: "اختبار الطابعة / Printer Test Page", price: 12.50, quantity: 1 }
          ],
          timestamp: new Date().toISOString(),
          order_type: "dine_in"
        }
      };

      const res = await printReceipt(dummyOrder, printerIP, store ? store.name : 'Cashmint', { 
        skipFallback: true, 
        minimalTest: true, 
        isArabic 
      });
      if (res.success) {
        showNotification(isArabic ? "نجح الاتصال! تمت الطباعة بنجاح" : "Connection successful! Test receipt printed.", "success");
      } else {
        throw new Error(res.error);
      }
    } catch (err) {
      console.error(err);
      showNotification(isArabic ? `فشل الاتصال: ${err.message || 'الطابعة غير متصلة'}` : `Connection failed: ${err.message || 'Printer unreachable'}`, "error");
    } finally {
      setTestingPrinter(false);
    }
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      
      {/* Title */}
      <div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">
          {isArabic ? "ربط وإعدادات الأجهزة" : "Integration & Hardware Settings"}
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">
          {isArabic ? "تكوين الطابعة المحلية وربط الطلبات السحابية عبر HubRise" : "Configure local printer hardware and sync cloud orders with HubRise"}
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* LOCAL PRINTER HARDWARE */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-50 dark:border-slate-700 pb-3 text-slate-855 dark:text-white">
            <div className="p-2 bg-amber-50 dark:bg-amber-955/20 rounded-xl text-amber-500">
              <Printer className="w-5 h-5" />
            </div>
            <div className="flex-1 flex items-center justify-between">
              <div 
                onClick={() => {
                  const next = secretTapCount + 1;
                  if (next >= 7) {
                    setDiagnosticsOpen(true);
                    setSecretTapCount(0);
                  } else {
                    setSecretTapCount(next);
                  }
                }}
                className="cursor-pointer select-none"
                title="Tap 7 times to open Printing Diagnostics"
              >
                <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">{isArabic ? "طابعة الفواتير" : "Receipt Printer"}</h3>
                <p className="text-[10px] text-slate-400 dark:text-slate-400 font-bold">Epson TM-T20IV (ePOS XML / HTTP POST)</p>
              </div>
              <button
                type="button"
                onClick={() => setDiagnosticsOpen(true)}
                className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-xl text-[10px] font-black transition-all cursor-pointer"
              >
                {isArabic ? "تشخيص الطباعة (iPad Diagnostics)" : "Printing Diagnostics"}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
              {isArabic ? "عنوان IP المحلي للطابعة (Printer IP Address)" : "Local Printer IP"}
            </label>
            <input
              type="text"
              value={printerIP}
              onChange={(e) => setPrinterIP(e.target.value)}
              placeholder="مثال: 192.168.1.100"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
            />
            <span className="text-[9px] text-slate-400 dark:text-slate-400 font-bold block leading-relaxed">
              * تأكد من اتصال جهاز التابلت والطابعة بنفس شبكة الواي فاي المحلية.
            </span>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block uppercase">
              {isArabic ? "مخرجات الطباعة التلقائية (Auto-Print Outputs)" : "Auto-Print Outputs"}
            </span>

            <label className="flex items-center justify-between p-2 rounded-xl border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "إيصال الكاشير (Cashier Receipt)" : "Cashier Receipt"}</span>
              <input
                type="checkbox"
                checked={autoPrintCashier}
                onChange={(e) => setAutoPrintCashier(e.target.checked)}
                className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
              />
            </label>

            <label className="flex items-center justify-between p-2 rounded-xl border border-slate-100 dark:border-slate-750 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "إيصال العميل (Customer Receipt)" : "Customer Receipt"}</span>
              <input
                type="checkbox"
                checked={autoPrintCustomer}
                onChange={(e) => setAutoPrintCustomer(e.target.checked)}
                className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
              />
            </label>

            <label className="flex items-center justify-between p-2 rounded-xl border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "تذكرة المطبخ (Kitchen Ticket)" : "Kitchen Ticket"}</span>
              <input
                type="checkbox"
                checked={autoPrintKitchen}
                onChange={(e) => setAutoPrintKitchen(e.target.checked)}
                className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={handleTestPrint}
            disabled={testingPrinter}
            className="w-full py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs active:scale-[0.99] transition-all flex items-center justify-center gap-2"
          >
            {testingPrinter ? (
              <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
            ) : (
              <span>{isArabic ? "اختبار الاتصال وطباعة تجريبية" : "Test Printer"}</span>
            )}
          </button>
        </div>

        {/* HUBRISE API INTEGRATION */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-50 dark:border-slate-700 pb-3 text-slate-855 dark:text-white">
            <div className="p-2 bg-sky-50 dark:bg-sky-955/20 rounded-xl text-sky-500">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">{isArabic ? "ربط منصة HubRise" : "HubRise API Bridge"}</h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-400 font-bold">Cloud Webhooks & Order Sync</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                {isArabic ? "معرف موقع HubRise (Location ID)" : "HubRise Location ID"}
              </label>
              <input
                type="text"
                value={hubriseLocId}
                onChange={(e) => setHubriseLocId(e.target.value)}
                placeholder="مثال: hr_loc_a2b3"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                {isArabic ? "مفتاح واجهة البرمجة (HubRise API Access Token)" : "HubRise API Access Token"}
              </label>
              <input
                type="password"
                value={hubriseApiKey}
                onChange={(e) => setHubriseApiKey(e.target.value)}
                placeholder="••••••••••••••••••••••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="p-3.5 bg-sky-50/50 dark:bg-sky-955/30 rounded-xl border border-sky-100/50 dark:border-sky-900/30 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-sky-850 dark:text-sky-200 font-bold leading-normal">
                عنوان Webhook لتلقي الطلبات الخارجية: <br />
                <code className="bg-white/80 dark:bg-slate-900 px-1 py-0.5 rounded font-mono text-[9px] mt-1 select-all inline-block text-slate-700 dark:text-slate-200">
                  https://pnffzpewnxeahspxofxo.supabase.co/functions/v1/hubrise-webhook
                </code>
              </p>
            </div>
          </div>
        </div>

        {/* LEGACY MANUAL STRIPE CONFIGURATION (temporary testing rollback) */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-50 dark:border-slate-700 pb-3 text-slate-855 dark:text-white">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-955/20 rounded-xl text-emerald-500">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">{isArabic ? "إعداد Stripe الآمن" : "Secure Stripe Configuration"}</h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-400 font-bold">Stripe Terminal / BBPOS WisePad 3</p>
            </div>
          </div>

          <div className="space-y-3 text-right">
            <p className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-955/30 p-3 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">{isArabic ? 'يتم حفظ مفاتيح Stripe وأسرار Webhook في Supabase فقط، وليس في المتصفح أو تطبيق Android.' : 'Stripe secret keys and webhook secrets are stored only in Supabase secrets, never in this browser or the Android APK.'}</p>
            <button type="button" onClick={handleClearStripeSettings} className="w-full py-2 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl">{isArabic ? 'مسح أي إعدادات Stripe قديمة من هذا الجهاز' : 'Clear any legacy local Stripe settings'}</button>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-bold text-xs px-8 py-3.5 rounded-xl shadow-md shadow-amber-500/10 transition-all flex items-center gap-2 cursor-pointer"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>{isArabic ? "حفظ وتطبيق التغييرات" : "Save Configurations"}</span>
              </>
            )}
          </button>
        </div>

      </form>

      {/* DEVICE MANAGEMENT SECTION */}
      <div className="border-t border-slate-100 dark:border-slate-800 pt-8 space-y-6">
        <div className="flex justify-between items-center">
          <div className="text-right">
            <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">
              {isArabic ? "إدارة الأجهزة والوردية" : "Device & Shift Management"}
            </h2>
            <p className="text-xs text-slate-450 dark:text-slate-400 mt-1">
              {isArabic ? "توليد أكواد التنشيط، مراقبة اتصال المحطات، ومتابعة مبيعات الورديات" : "Generate activation codes, monitor terminal connection states, and track cashier session sales"}
            </p>
          </div>
          <button
            type="button"
            onClick={fetchDevicesAndSessions}
            disabled={loadingMonitor}
            className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all active:scale-95 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loadingMonitor ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* 1. DEVICE ACTIVATION CODE GENERATOR */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-6 space-y-5 text-right">
            <div className="flex items-center gap-3 border-b border-slate-50 dark:border-slate-750 pb-3 text-slate-855">
              <div className="p-2 bg-amber-50 dark:bg-amber-955/20 rounded-xl text-amber-500">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-sm dark:text-white">{isArabic ? "إنشاء كود تفعيل" : "Device Activation Codes"}</h3>
                <p className="text-[10px] text-slate-400 font-bold">Register new POS terminals</p>
              </div>
            </div>

            <form onSubmit={generateActivationCode} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 block">
                  {isArabic ? "اسم الجهاز الجديد" : "Device Identifier Name"}
                </label>
                <input
                  type="text"
                  required
                  placeholder={isArabic ? "مثال: محطة الكاونتر 2" : "e.g. Counter Register 2"}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                disabled={generatingCode}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white rounded-xl font-bold text-xs active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-amber-500/10"
              >
                {generatingCode ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>{isArabic ? "توليد كود التفعيل" : "Generate Activation Code"}</span>
                )}
              </button>
            </form>

            {latestCode && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-center space-y-3 animate-fade-in relative">
                <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  {isArabic ? "كود التفعيل الجديد" : "Active Registration Code"}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-xl font-black text-amber-600 dark:text-amber-400 font-mono tracking-widest select-all">
                    {latestCode}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg active:scale-90 transition-all cursor-pointer flex items-center justify-center border border-amber-500/20"
                    title={isArabic ? "نسخ الكود" : "Copy Code"}
                  >
                    {copied ? (
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                {copied && (
                  <span className="text-[9px] font-bold text-emerald-500 block animate-pulse">
                    {isArabic ? "تم النسخ!" : "Copied!"}
                  </span>
                )}
                <p className="text-[9px] text-slate-400">
                  {isArabic ? "* استخدم هذا الكود لتسجيل دخول جهاز الكاشير" : "* Enter this code to authenticate the cashier app"}
                </p>
              </div>
            )}
            <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-750 rounded-2xl text-center space-y-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {isArabic ? "ربط قارئ Stripe Android" : "Android Payment Bridge"}
              </p>
              <button
                type="button"
                onClick={generateTerminalEnrollmentCode}
                disabled={generatingCode}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white rounded-xl font-bold text-xs active:scale-[0.99] transition-all"
              >
                {isArabic ? "إنشاء كود ربط قارئ البطاقة" : "Generate Bridge Enrollment Code"}
              </button>
              {latestTerminalCode && (
                <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-widest select-all">
                  {latestTerminalCode}
                </p>
              )}
            </div>
          </div>

          {/* 2. LIVE DEVICE STATUS MONITOR */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-6 space-y-4 text-right flex flex-col h-[400px]">
            <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-750 pb-3 shrink-0">
              <div className="flex items-center gap-3 text-slate-855">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-955/20 rounded-xl text-emerald-500">
                  <Tv className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm dark:text-white">{isArabic ? "مراقبة الأجهزة الحية" : "Live Device Status"}</h3>
                  <p className="text-[10px] text-slate-400 font-bold">{isArabic ? "مراقبة شبكة أجهزة الكاشير وأجهزة الدفع" : "POS and payment terminal network status"}</p>
                </div>
              </div>
            </div>

            {/* TAB SWITCHER */}
            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setDeviceTab('pos')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                  deviceTab === 'pos'
                    ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                {isArabic ? `أجهزة الكاشير (${devices.length})` : `Cashier POS Devices (${devices.length})`}
              </button>
              <button
                type="button"
                onClick={() => setDeviceTab('payment')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                  deviceTab === 'payment'
                    ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                {isArabic ? `أجهزة الدفع (${terminalDevices.length})` : `Payment Devices (${terminalDevices.length})`}
              </button>
            </div>

            {/* DEVICE LIST */}
            <div className="flex-1 overflow-y-auto space-y-3 no-scrollbar pr-1">
              {/* TAB 1: CASHIER POS DEVICES */}
              {deviceTab === 'pos' && (
                devices.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-4">
                    <Tv className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs font-bold">{isArabic ? "لا توجد أجهزة كاشير مسجلة" : "No cashier POS devices registered"}</p>
                  </div>
                ) : (
                  devices.map(device => {
                    const online = isDeviceOnline(device.last_active_at) && device.status === 'active';
                    const activeSession = sessions.find(s => s.device_id === device.id && s.status === 'open');

                    return (
                      <div 
                        key={`pos-${device.id}`}
                        className="p-3 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-750 rounded-xl space-y-2 text-right"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${
                              device.status === 'revoked'
                                ? 'bg-rose-500'
                                : online
                                  ? 'bg-emerald-500 animate-pulse shadow-sm shadow-emerald-500/50'
                                  : 'bg-slate-400'
                            }`} />
                            <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-200">
                              {device.device_name}
                            </h4>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                              device.status === 'revoked'
                                ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400'
                                : online
                                  ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}>
                              {device.status === 'revoked'
                                ? (isArabic ? "موقوف" : "Disabled")
                                : online
                                  ? (isArabic ? "متصل" : "Connected")
                                  : (isArabic ? "غير متصل" : "Offline")
                              }
                            </span>

                            <button
                              type="button"
                              onClick={() => handleToggleDeviceStatus(device.id, device.status)}
                              className={`p-1.5 rounded-lg border transition-all active:scale-95 cursor-pointer ${
                                device.status === 'active'
                                  ? 'border-amber-200 hover:bg-amber-50 dark:border-amber-900/40 dark:hover:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                                  : 'border-emerald-200 hover:bg-emerald-50 dark:border-emerald-900/40 dark:hover:bg-emerald-950/40 text-emerald-500 dark:text-emerald-400'
                              }`}
                              title={device.status === 'active' ? (isArabic ? "تعطيل مؤقت" : "Disable Device") : (isArabic ? "تفعيل الجهاز" : "Enable Device")}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRevokeDevice(device.id)}
                              className="p-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/40 text-rose-500 dark:text-rose-400 transition-all active:scale-95 cursor-pointer"
                              title={isArabic ? "إلغاء التفعيل نهائياً (Revoke)" : "Revoke Device"}
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteDevice(device.id)}
                              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-750 text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-all active:scale-95 cursor-pointer"
                              title={isArabic ? "حذف الجهاز" : "Delete Device"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px]">
                          <div>
                            <span className="font-bold text-slate-400 dark:text-slate-500 block text-[9px] uppercase">ID:</span>
                            <span className="font-extrabold font-mono text-slate-700 dark:text-slate-300 select-all">
                              {device.id.slice(0, 8)}
                            </span>
                          </div>
                          <div>
                            <span className="font-bold text-slate-400 dark:text-slate-500 block text-[9px] uppercase">
                              {isArabic ? "كود التفعيل:" : "Activation Code:"}
                            </span>
                            <span className="font-extrabold font-mono text-amber-600 dark:text-amber-400 select-all">
                              {device.activation_code || '—'}
                            </span>
                          </div>
                        </div>

                        {activeSession && (
                          <div className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 pt-0.5">
                            {isArabic ? `الوردية الحالية: ${activeSession.cashier_name}` : `Active Shift: ${activeSession.cashier_name}`}
                          </div>
                        )}
                      </div>
                    );
                  })
                )
              )}

              {/* TAB 2: PAYMENT DEVICES */}
              {deviceTab === 'payment' && (
                terminalDevices.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-4">
                    <CreditCard className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs font-bold">{isArabic ? "لا توجد أجهزة دفع مسجلة" : "No payment devices registered"}</p>
                  </div>
                ) : (
                  terminalDevices.map(device => {
                    const heartbeatMs = device.last_heartbeat_at ? Date.now() - new Date(device.last_heartbeat_at).getTime() : Number.POSITIVE_INFINITY;
                    const online = heartbeatMs < 60000 && device.status !== 'disabled';
                    const readerConnected = device.reader_status === 'connected';

                    return (
                      <div
                        key={`terminal-${device.id}`}
                        className="p-3 bg-emerald-50/40 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900/30 rounded-xl space-y-2 text-right"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-200">{device.display_name}</h4>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${online ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                              {online ? (isArabic ? "الجسر متصل" : "Bridge online") : (isArabic ? "الجسر غير متصل" : "Bridge offline")}
                            </span>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${readerConnected ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                              {readerConnected ? (isArabic ? "القارئ متصل" : "Reader connected") : (isArabic ? "القارئ غير متصل" : "Reader disconnected")}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 dark:text-slate-400 pt-1 border-t border-emerald-100/60 dark:border-emerald-900/20">
                          <span>v{device.app_version || 'unknown'}</span>
                          {device.current_payment_request_id ? (
                            <span className="text-amber-600 font-bold flex items-center gap-1">
                              {isArabic ? "عملية دفع نشطة" : "Payment active"}
                              <button
                                type="button"
                                onClick={() => handleClearTerminalRequest(device.id)}
                                className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-sans text-[8px] hover:bg-amber-200 cursor-pointer"
                                title={isArabic ? "تفريغ الطلب المعلق" : "Clear active request"}
                              >
                                {isArabic ? "إلغاء" : "Clear"}
                              </button>
                            </span>
                          ) : (
                            <span className="text-slate-400">{isArabic ? "خامل" : "Idle"}</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>

          {/* 3. REVENUE AND METRICS TRACKING (Active & Recently Closed Shifts) */}
          <div className="space-y-6 flex flex-col">
            {/* Active Cashier Shifts */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-6 space-y-4 text-right flex flex-col h-[350px]">
              <div className="flex items-center gap-3 border-b border-slate-50 dark:border-slate-750 pb-3 shrink-0 text-slate-855">
                <div className="p-2 bg-sky-50 dark:bg-sky-955/20 rounded-xl text-sky-500">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm dark:text-white">{isArabic ? "مبيعات الورديات النشطة" : "Active Cashier Shifts"}</h3>
                  <p className="text-[10px] text-slate-400 font-bold">Shift revenue & cash drawer balances</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 no-scrollbar pr-1">
                {sessions.filter(s => s.status === 'open').length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-4">
                    <Coins className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs font-bold">{isArabic ? "لا توجد ورديات كاشير نشطة" : "No active cashier shifts"}</p>
                  </div>
                ) : (
                  sessions
                    .filter(s => s.status === 'open')
                    .map(session => {
                      const metrics = calculateSessionMetrics(session);
                      const device = devices.find(d => d.id === session.device_id);
                      return (
                        <div 
                          key={session.id}
                          className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-750 rounded-2xl space-y-3 text-right"
                        >
                          <div className="flex justify-between items-center border-b border-slate-100/60 dark:border-slate-750 pb-2">
                            <div>
                              <h4 className="font-extrabold text-xs text-slate-800 dark:text-white leading-none">
                                {session.cashier_name}
                              </h4>
                              <p className="text-[9px] text-slate-400 font-semibold mt-1">
                                {device ? device.device_name : (isArabic ? "جهاز غير معروف" : "Unknown Device")}
                              </p>
                            </div>
                            <span className="text-[9px] font-bold px-2 py-0.5 bg-emerald-50 dark:bg-emerald-955/20 text-emerald-600 dark:text-emerald-400 rounded-full">
                              {isArabic ? "نشطة" : "Active"}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="space-y-0.5">
                              <span className="text-[8px] font-bold text-slate-400 block uppercase">{isArabic ? "الافتتاحي" : "Opening"}</span>
                              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                                {parseFloat(session.opening_balance).toFixed(2)} €
                              </span>
                            </div>
                            <div className="space-y-0.5 border-x border-slate-100 dark:border-slate-750">
                              <span className="text-[8px] font-bold text-slate-400 block uppercase">{isArabic ? "المعالج" : "Processed"}</span>
                              <span className="text-xs font-black text-amber-500">
                                {metrics.totalProcessed.toFixed(2)} €
                              </span>
                            </div>
                            <div className="space-y-0.5">
                              <span className="text-[8px] font-bold text-slate-400 block uppercase">{isArabic ? "الختامي" : "Closing"}</span>
                              <span className="text-xs font-black text-emerald-500">
                                {metrics.closingBalance.toFixed(2)} €
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            {/* Recently Closed Shifts (Last 24 Hours) */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-6 space-y-4 text-right flex flex-col h-[350px]">
              <div className="flex items-center gap-3 border-b border-slate-50 dark:border-slate-750 pb-3 shrink-0 text-slate-855">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-955/20 rounded-xl text-emerald-500">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm dark:text-white">{isArabic ? "الورديات المغلقة مؤخراً" : "Recently Closed Shifts"}</h3>
                  <p className="text-[10px] text-slate-400 font-bold">{isArabic ? "الورديات المغلقة خلال آخر 24 ساعة" : "Closed shifts in the last 24 hours"}</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 no-scrollbar pr-1">
                {sessions.filter(s => {
                  if (s.status !== 'closed') return false;
                  if (!s.closed_at) return false;
                  const closedTime = new Date(s.closed_at).getTime();
                  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
                  return closedTime >= twentyFourHoursAgo;
                }).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-4">
                    <Coins className="w-8 h-8 mb-2 opacity-30 animate-pulse" />
                    <p className="text-xs font-bold">{isArabic ? "لا توجد ورديات مغلقة مؤخراً" : "No recently closed shifts"}</p>
                  </div>
                ) : (
                  sessions
                    .filter(s => {
                      if (s.status !== 'closed') return false;
                      if (!s.closed_at) return false;
                      const closedTime = new Date(s.closed_at).getTime();
                      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
                      return closedTime >= twentyFourHoursAgo;
                    })
                    .map(session => {
                      const metrics = calculateSessionMetrics(session);
                      const device = devices.find(d => d.id === session.device_id);
                      
                      const formatShiftTime = (isoString) => {
                        if (!isoString) return '';
                        const date = new Date(isoString);
                        return date.toLocaleTimeString(isArabic ? 'ar-EG' : 'en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        });
                      };

                      return (
                        <div 
                          key={session.id}
                          className="p-3.5 bg-slate-50/50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-750 rounded-2xl space-y-3 text-right"
                        >
                          <div className="flex justify-between items-center border-b border-slate-100/60 dark:border-slate-750 pb-2">
                            <div>
                              <h4 className="font-extrabold text-xs text-slate-800 dark:text-white leading-none">
                                {session.cashier_name}
                              </h4>
                              <p className="text-[9px] text-slate-400 font-semibold mt-1">
                                {device ? device.device_name : (isArabic ? "جهاز غير معروف" : "Unknown Device")}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold px-2 py-0.5 bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 rounded-full">
                                {isArabic ? "مغلقة" : "Closed"}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeleteShift(session.id)}
                                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-750 text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-all active:scale-95 cursor-pointer flex items-center justify-center"
                                title={isArabic ? "حذف الوردية" : "Delete Shift"}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="space-y-0.5">
                              <span className="text-[8px] font-bold text-slate-400 block uppercase">{isArabic ? "الفتح" : "Opened"}</span>
                              <span className="text-[10px] font-extrabold text-slate-700 dark:text-slate-200">
                                {formatShiftTime(session.opened_at)}
                              </span>
                            </div>
                            <div className="space-y-0.5 border-x border-slate-100 dark:border-slate-750">
                              <span className="text-[8px] font-bold text-slate-400 block uppercase">{isArabic ? "الإغلاق" : "Closed"}</span>
                              <span className="text-[10px] font-extrabold text-slate-700 dark:text-slate-200">
                                {formatShiftTime(session.closed_at)}
                              </span>
                            </div>
                            <div className="space-y-0.5">
                              <span className="text-[8px] font-bold text-slate-400 block uppercase">{isArabic ? "الإيرادات" : "Revenue"}</span>
                              <span className="text-xs font-black text-emerald-500">
                                {metrics.totalProcessed.toFixed(2)} €
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

          </div>

        </div>
      </div>

      <PrintingDiagnosticsModal
        isOpen={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        onRetryPrint={null}
        isArabic={isArabic}
        store={store}
      />
    </div>
  );
}
