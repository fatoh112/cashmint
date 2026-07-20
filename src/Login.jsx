import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { AlertCircle } from 'lucide-react';

export default function Login({ isArabic: propIsArabic, setIsArabic: propSetIsArabic, onLoginSuccess }) {
  const [activationCode, setActivationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [previewStore, setPreviewStore] = useState(null);

  const params = new URLSearchParams(window.location.search);
  const isAccountDeleted = params.get('error') === 'deleted';

  // Safe hook fallback if props are not defined
  const [localIsArabic, setLocalIsArabic] = useState(() => {
    const saved = localStorage.getItem('app_language');
    if (saved) return saved === 'ar';
    return true;
  });

  const isArabic = propIsArabic !== undefined ? propIsArabic : localIsArabic;
  const setIsArabic = (val) => {
    if (propSetIsArabic) {
      propSetIsArabic(val);
    } else {
      setLocalIsArabic(val);
      localStorage.setItem('app_language', val ? 'ar' : 'en');
    }
  };

  // Debounced search for the activation code to preview logo/name
  useEffect(() => {
    if (!activationCode.trim()) {
      setPreviewStore(null);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        const { data: verified, error } = await supabase.rpc('verify_pos_device_activation', {
          code_input: activationCode.trim()
        });
        if (error) throw error;
        const device = verified?.[0];
        if (device?.device_id) {
          const { data: catalog, error: catalogError } = await supabase.rpc('get_pos_catalog', {
            device_uuid: device.device_id
          });
          if (catalogError) throw catalogError;
          const storeData = catalog?.store;
          setPreviewStore(storeData ? { name: storeData.name, logo_url: storeData.logo_url } : null);
        } else {
          setPreviewStore(null);
        }
      } catch (err) {
        console.error("Preview logo fetch error:", err);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [activationCode]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!activationCode.trim()) {
      setErrorMsg(isArabic ? 'الرجاء إدخال رمز تفعيل الجهاز' : 'Please enter your device activation code');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');
      
      const { data: res, error } = await supabase.rpc('redeem_pos_activation_code', {
        p_code_input: activationCode.trim()
      });

      if (error) throw error;
      if (!res?.success) {
        throw new Error(res?.error || (isArabic ? 'رمز تفعيل الجهاز غير صالح أو انتهت صلاحيته.' : 'Invalid or expired device activation code.'));
      }

      // Store device credentials securely in localStorage
      localStorage.setItem('device_id', res.device_id);
      if (res.device_token) {
        localStorage.setItem('device_token', res.device_token);
      }
      localStorage.setItem('store_id', res.store_id);
      localStorage.setItem('device_name', res.device_name);

      // Touch active timestamp
      await supabase.rpc('touch_pos_device_v2', {
        p_device_id: res.device_id,
        p_device_token: res.device_token
      });

      if (onLoginSuccess) {
        onLoginSuccess(res.device_id, res.store_id);
      }
    } catch (err) {
      console.error("Auth error:", err);
      setErrorMsg(err.message || (isArabic ? 'خطأ في التحقق من البيانات' : 'Error verifying credentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir={isArabic ? "rtl" : "ltr"} className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-955 px-4 font-sans select-none relative text-slate-100">
      
      {/* Top corner Language Toggle button */}
      <div className={`absolute top-6 ${isArabic ? 'left-6' : 'right-6'}`}>
        <button
          type="button"
          onClick={() => setIsArabic(!isArabic)}
          className="text-xs font-extrabold text-slate-400 hover:text-slate-200 px-3.5 py-2 rounded-xl bg-slate-900/60 border border-slate-800 shadow-sm transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
        >
          <span>{isArabic ? "English (LTR)" : "العربية (RTL)"}</span>
        </button>
      </div>

      <div className="max-w-md w-full backdrop-blur-2xl rounded-3xl border border-slate-850 bg-slate-900/60 shadow-2xl shadow-amber-500/5 p-8 space-y-6 relative overflow-hidden">
        
        {/* Branding header */}
        <div className="text-center space-y-4 flex flex-col items-center">
          {previewStore ? (
            previewStore.logo_url ? (
              <img 
                src={previewStore.logo_url} 
                alt={previewStore.name} 
                className="w-20 h-20 rounded-2xl object-contain shadow-md mb-2 bg-white border border-slate-250 p-1 animate-pulse" 
              />
            ) : (
              <div className="inline-flex items-center justify-center px-6 py-2.5 rounded-2xl font-black tracking-wider text-xs shadow-lg uppercase border bg-amber-500 text-white shadow-amber-500/20 border-amber-400/20">
                {previewStore.name}
              </div>
            )
          ) : (
            <div className="inline-flex items-center justify-center px-6 py-2.5 rounded-2xl font-black tracking-wider text-xs shadow-lg uppercase border bg-amber-500 text-white shadow-amber-500/20 border-amber-400/20">
              Cashmint POS
            </div>
          )}

          <div className="flex flex-col items-center gap-2 mt-2">
            <h2 className="text-2xl font-black text-white tracking-tight mt-1 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-200">
              {isArabic ? "تنشيط جهاز POS" : "Activate POS Device"}
            </h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {isArabic ? "أدخل رمز تفعيل الجهاز الممنوح من لوحة التحكم" : "Enter the device activation code generated from the back office"}
            </p>
          </div>
        </div>

        {isAccountDeleted && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-500 text-red-200 rounded-lg text-sm text-center">
            <span>لقد تم إيقاف أو حذف الحساب من قبل الشركة، برجاء التواصل مع الدعم.</span>
          </div>
        )}

        {/* Error notification */}
        {errorMsg && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/25 rounded-2xl text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Login form */}
        <form onSubmit={handleLogin} className="space-y-6">
          
          <div className="space-y-2 text-right">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block px-1" htmlFor="activationCode">
              {isArabic ? "رمز تفعيل الجهاز" : "Device Activation Code"}
            </label>
            <div className="relative">
              <span className={`absolute inset-y-0 ${isArabic ? 'right-0 pr-4' : 'left-0 pl-4'} flex items-center pointer-events-none text-slate-500`}>
                <AlertCircle className="w-5 h-5" />
              </span>
              <input
                id="activationCode"
                type="text"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder={isArabic ? "مثال: 123456" : "e.g. 123456"}
                className={`w-full ${isArabic ? 'pr-11 pl-4' : 'pl-11 pr-4'} py-3.5 bg-slate-955/50 border border-slate-800 rounded-2xl text-white placeholder-slate-600 outline-none transition-all text-sm font-medium focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50`}
                disabled={loading}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-4 text-white font-extrabold text-sm rounded-2xl shadow-xl transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer border ${
              loading
                ? 'bg-amber-500/50 cursor-wait border-amber-500/10'
                : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/10 border-amber-500/10'
            }`}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              isArabic ? 'تنشيط الجهاز' : 'Activate Device'
            )}
          </button>

        </form>

        <div className="text-center">
          <span className="text-xs text-slate-500 dark:text-slate-600">
            {isArabic ? "إذا لم يكن لديك رمز تفعيل، الرجاء مراجعة مدير النظام." : "If you don't have an activation code, please contact your administrator."}
          </span>
        </div>

      </div>
    </div>
  );
}
