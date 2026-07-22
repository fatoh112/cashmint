import React, { useState, useEffect, useRef } from 'react';
import { 
  ReceiptText, 
  Save, 
  RotateCcw, 
  Lock, 
  Plus, 
  Trash2, 
  ArrowUp, 
  ArrowDown, 
  FileText, 
  Utensils, 
  Receipt, 
  RefreshCw,
  Sliders,
  ShieldCheck,
  UserCheck,
  Upload,
  Image as ImageIcon,
  X,
  Store,
  Phone
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getDefaultConfigForType, mergeAndEnforceReceiptConfig, BELGIUM_LOCKED_FIELDS } from '../utils/receiptSchema';
import ReceiptPreview from '../components/admin/ReceiptPreview';

const TEMPLATE_TYPES = [
  { id: 'pos_receipt', labelEn: 'Cashier Receipt', labelAr: 'إيصال الكاشير', icon: ReceiptText },
  { id: 'customer_receipt', labelEn: 'Customer Receipt', labelAr: 'إيصال العميل', icon: UserCheck },
  { id: 'kitchen_ticket', labelEn: 'Kitchen Ticket', labelAr: 'تذكرة المطبخ', icon: Utensils },
  { id: 'invoice', labelEn: 'Invoice', labelAr: 'فاتورة رسمية', icon: FileText },
  { id: 'refund_receipt', labelEn: 'Refund Receipt', labelAr: 'إيصال المرتجع', icon: Receipt }
];

const SECTION_LABELS = {
  header: { en: 'Header & Store Branding', ar: 'الهيدر والعلامة التجارية' },
  meta: { en: 'Order Info & Timestamps', ar: 'بيانات الطلب والوقت' },
  items: { en: 'Cart Items & Modifiers', ar: 'عناصر الطلب والإضافات' },
  subtotals: { en: 'Subtotal & Total Summary', ar: 'المجموع الكلي والفرعي' },
  tax_breakdown: { en: 'VAT Breakdown Table', ar: 'تفاصيل جدول الضريبة' },
  payments: { en: 'Payments & Change', ar: 'طريقة الدفع والباقي' },
  footer: { en: 'Footer Custom Messages', ar: 'رسائل الفوتر الترحيبية' }
};

export default function ReceiptDesigner({ store, showNotification, isArabic }) {
  const [selectedType, setSelectedType] = useState('pos_receipt');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [templateId, setTemplateId] = useState(null);
  const [config, setConfig] = useState(() => getDefaultConfigForType('pos_receipt'));

  // Custom line input states
  const [newHeaderLine, setNewHeaderLine] = useState('');
  const [newFooterLine, setNewFooterLine] = useState('');
  const fileInputRef = useRef(null);

  // Load store's receipt template from Supabase for selected type
  useEffect(() => {
    let isMounted = true;
    const fetchTemplate = async () => {
      if (!store?.id) return;
      try {
        setLoading(true);
        const queryTypes = selectedType === 'pos_receipt' ? ['pos_receipt', 'cashier_receipt'] : [selectedType];
        const { data, error } = await supabase
          .from('receipt_templates')
          .select('*')
          .eq('store_id', store.id)
          .in('template_type', queryTypes)
          .maybeSingle();

        if (error) throw error;

        if (isMounted) {
          if (data) {
            setTemplateId(data.id);
            setConfig(mergeAndEnforceReceiptConfig(data.config_json || {}, selectedType));
          } else {
            setTemplateId(null);
            setConfig(mergeAndEnforceReceiptConfig(getDefaultConfigForType(selectedType), selectedType));
          }
        }
      } catch (err) {
        console.error("Error loading receipt template:", err);
        showNotification(isArabic ? "خطأ في تحميل تصميم الإيصال" : "Error loading receipt template", "error");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTemplate();
    return () => { isMounted = false; };
  }, [store?.id, selectedType]);

  // Save template configuration to Supabase
  const handleSave = async () => {
    if (!store?.id) return;
    try {
      setSaving(true);
      const enforcedConfig = mergeAndEnforceReceiptConfig(config, selectedType);

      const payload = {
        store_id: store.id,
        template_type: selectedType,
        template_name: TEMPLATE_TYPES.find(t => t.id === selectedType)?.labelEn || 'Receipt Template',
        paper_width: enforcedConfig.paper_width,
        config_json: enforcedConfig,
        is_active: true,
        updated_at: new Date().toISOString()
      };

      let saveErr = null;
      if (templateId) {
        const { error } = await supabase
          .from('receipt_templates')
          .update(payload)
          .eq('id', templateId);
        saveErr = error;
      } else {
        const { data, error } = await supabase
          .from('receipt_templates')
          .insert([payload])
          .select()
          .single();
        if (data) setTemplateId(data.id);
        saveErr = error;
      }

      if (saveErr) throw saveErr;

      setConfig(enforcedConfig);
      showNotification(isArabic ? "تم حفظ تصميم الهيدر والإيصال بنجاح!" : "Receipt header & template saved successfully!", "success");
    } catch (err) {
      console.error("Error saving receipt template:", err);
      showNotification(isArabic ? "فشل حفظ تصميم الإيصال" : "Failed to save receipt template", "error");
    } finally {
      setSaving(false);
    }
  };

  // Reset config to default for current template type
  const handleResetToDefaults = () => {
    setConfig(mergeAndEnforceReceiptConfig(getDefaultConfigForType(selectedType), selectedType));
    showNotification(isArabic ? "تم استعادة الإعدادات الافتراضية" : "Reset to default layout", "info");
  };

  // Helper to update nested config properties
  const updateNestedConfig = (path, value) => {
    if (selectedType !== 'kitchen_ticket' && BELGIUM_LOCKED_FIELDS.includes(path)) {
      showNotification(isArabic ? "هذا حقل إلزامي بحسب القوانين البلجيكية ولا يمكن إغلاقه" : "Mandatory field required by Belgian tax regulations", "warning");
      return;
    }

    const parts = path.split('.');
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (parts.length === 1) {
        next[parts[0]] = value;
      } else if (parts.length === 2) {
        if (!next[parts[0]]) next[parts[0]] = {};
        next[parts[0]][parts[1]] = value;
      }
      return mergeAndEnforceReceiptConfig(next, selectedType);
    });
  };

  // Handle Logo Upload (Base64 data URL + Supabase storage fallback)
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showNotification(isArabic ? "حجم الصورة كبير جداً (الأقصى 2 ميجابايت)" : "File size too large (Max 2MB)", "error");
      return;
    }

    try {
      setUploadingLogo(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Url = reader.result;
        
        // Attempt to upload to Supabase storage bucket `receipt-assets` or `store-logos`
        try {
          const fileExt = file.name.split('.').pop();
          const filePath = `${store.id}/receipt_logo_${Date.now()}.${fileExt}`;
          const { data, error: uploadErr } = await supabase.storage
            .from('receipt-assets')
            .upload(filePath, file, { upsert: true });

          if (!uploadErr && data) {
            const { data: publicData } = supabase.storage.from('receipt-assets').getPublicUrl(filePath);
            if (publicData?.publicUrl) {
              updateNestedConfig('header.logo_url', publicData.publicUrl);
              updateNestedConfig('header.show_logo', true);
              showNotification(isArabic ? "تم رفع اللوجو بنجاح" : "Logo uploaded successfully", "success");
              setUploadingLogo(false);
              return;
            }
          }
        } catch (storageErr) {
          console.warn("Storage bucket upload skipped, using base64 data URL fallback:", storageErr);
        }

        // Fallback to Base64 data URL
        updateNestedConfig('header.logo_url', base64Url);
        updateNestedConfig('header.show_logo', true);
        showNotification(isArabic ? "تم حفظ اللوجو في الفاتورة" : "Logo loaded for receipt", "success");
        setUploadingLogo(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Error reading logo file:", err);
      showNotification(isArabic ? "خطأ في قراءة ملف اللوجو" : "Error processing logo file", "error");
      setUploadingLogo(false);
    }
  };

  // Remove Logo
  const handleRemoveLogo = () => {
    updateNestedConfig('header.logo_url', '');
    updateNestedConfig('header.show_logo', false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    showNotification(isArabic ? "تم إزالة اللوجو من الفاتورة" : "Logo removed from receipt", "info");
  };

  // Move section up/down in sections_order
  const handleMoveSection = (index, direction) => {
    const currentOrder = [...(config.sections_order || getDefaultConfigForType(selectedType).sections_order)];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) return;

    const temp = currentOrder[index];
    currentOrder[index] = currentOrder[targetIndex];
    currentOrder[targetIndex] = temp;

    setConfig(prev => ({ ...prev, sections_order: currentOrder }));
  };

  // Custom Header & Footer lines
  const handleAddHeaderLine = () => {
    if (!newHeaderLine.trim()) return;
    const current = config.header?.custom_lines || [];
    setConfig(prev => ({
      ...prev,
      header: { ...prev.header, custom_lines: [...current, newHeaderLine.trim()] }
    }));
    setNewHeaderLine('');
  };

  const handleRemoveHeaderLine = (index) => {
    const current = [...(config.header?.custom_lines || [])];
    current.splice(index, 1);
    setConfig(prev => ({
      ...prev,
      header: { ...prev.header, custom_lines: current }
    }));
  };

  const handleAddFooterLine = () => {
    if (!newFooterLine.trim()) return;
    const current = config.footer?.custom_lines || [];
    setConfig(prev => ({
      ...prev,
      footer: { ...prev.footer, custom_lines: [...current, newFooterLine.trim()] }
    }));
    setNewFooterLine('');
  };

  const handleRemoveFooterLine = (index) => {
    const current = [...(config.footer?.custom_lines || [])];
    current.splice(index, 1);
    setConfig(prev => ({
      ...prev,
      footer: { ...prev.footer, custom_lines: current }
    }));
  };

  const isKitchen = selectedType === 'kitchen_ticket';
  const activeLogo = config.header?.logo_url || store?.logo_url || '';

  return (
    <div dir={isArabic ? 'rtl' : 'ltr'} className="space-y-6 font-sans">
      
      {/* Top Action Header */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-white flex items-center gap-2.5">
            <ReceiptText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span>{isArabic ? "مصمم الهيدر والعلامة التجارية للفواتير" : "Receipt Header & Branding Designer"}</span>
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">
            {isArabic ? "تخصيص اللوجو، عنوان وتليفون المتجر، والسطور الترحيبية بحسب نوع الطباعة" : "Customize logo, store profile, phone numbers, and custom header/footer announcements"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleResetToDefaults}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{isArabic ? "استعادة الافتراضي" : "Reset Default"}</span>
          </button>

          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isArabic ? "حفظ التغييرات" : "Save Template"}</span>
          </button>
        </div>
      </div>

      {/* Template Type Switcher Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200/50 dark:border-slate-800 overflow-x-auto">
        {TEMPLATE_TYPES.map((type) => {
          const Icon = type.icon;
          const isActive = selectedType === type.id;
          return (
            <button
              key={type.id}
              onClick={() => setSelectedType(type.id)}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 ${
                isActive 
                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{isArabic ? type.labelAr : type.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* WORKSPACE */}
      {loading ? (
        <div className="bg-white dark:bg-slate-800 p-12 rounded-2xl border border-slate-100 dark:border-slate-700 text-center">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-400">{isArabic ? "جاري تحميل إعدادات الفاتورة..." : "Loading receipt settings..."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT COLUMN: Branding & Controls (7 Cols) */}
          <div className="lg:col-span-7 space-y-5">
            
            {/* SECTION 1: LOGO & BRANDING CUSTOMIZATION */}
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                <h3 className="font-extrabold text-sm text-slate-800 dark:text-white flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-indigo-500" />
                  <span>{isArabic ? "شعار الهيدر والعلامة التجارية (Receipt Logo)" : "Receipt Header Logo & Branding"}</span>
                </h3>
              </div>

              {/* Logo Preview & Uploader Controls */}
              <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-750">
                <div className="w-20 h-20 rounded-xl bg-white dark:bg-slate-800 border-2 border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center p-2 overflow-hidden shrink-0 relative">
                  {activeLogo ? (
                    <img src={activeLogo} alt="Receipt Logo" className="w-full h-full object-contain filter grayscale" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  )}
                </div>

                <div className="space-y-2 flex-1 text-center sm:text-left">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/jpg"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingLogo}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {uploadingLogo ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>{isArabic ? "رفع لوجو (JPG / PNG)" : "Upload Logo (JPG/PNG)"}</span>
                    </button>

                    {activeLogo && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="px-3.5 py-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 rounded-xl font-bold text-xs transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>{isArabic ? "إزالة اللوجو" : "Remove Logo"}</span>
                      </button>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-400">
                    {isArabic ? "يفضل رفع صورة بصيغة PNG شفافة أو أبيض وأسود بدقة عالية" : "Recommended: Monochrome PNG/JPG image max 2MB for high thermal contrast"}
                  </p>
                </div>
              </div>

              {/* Logo Display & Alignment Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer transition-all">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "عرض الشعار في الفاتورة" : "Display Logo on Receipt"}</span>
                  <input
                    type="checkbox"
                    checked={config.header?.show_logo ?? !isKitchen}
                    onChange={(e) => updateNestedConfig('header.show_logo', e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                </label>

                <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-700/60">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "محاذاة الشعار" : "Logo Alignment"}</span>
                  <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
                    {['left', 'center', 'right'].map((align) => (
                      <button
                        key={align}
                        type="button"
                        onClick={() => updateNestedConfig('header.logo_align', align)}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                          config.header?.logo_align === align ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                        }`}
                      >
                        {align}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 2: STORE NAME & PHONE OVERRIDES */}
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-3 flex items-center gap-2">
                <Store className="w-4 h-4 text-indigo-500" />
                <span>{isArabic ? "اسم ورقم تليفون المتجر في الفاتورة" : "Store Name & Phone Display Settings"}</span>
              </h3>

              <div className="space-y-4">
                {/* Store Name Toggle & Override */}
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer transition-all">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "عرض اسم المتجر التجاري" : "Display Store Name"}</span>
                    <input
                      type="checkbox"
                      checked={config.header?.show_store_name ?? !isKitchen}
                      onChange={(e) => updateNestedConfig('header.show_store_name', e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                    />
                  </label>

                  {config.header?.show_store_name && (
                    <div className="pl-2 space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-slate-400 block uppercase">{isArabic ? "تخصيص اسم المتجر في الفاتورة (اختياري)" : "Custom Receipt Store Name (Optional)"}</label>
                      <input
                        type="text"
                        value={config.header?.custom_store_name || ''}
                        onChange={(e) => updateNestedConfig('header.custom_store_name', e.target.value)}
                        placeholder={store?.name || "Cashmint Store"}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </div>

                {/* Phone Number Toggle & Override */}
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-750 cursor-pointer transition-all">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "عرض رقم تليفون المتجر" : "Display Phone Number"}</span>
                    <input
                      type="checkbox"
                      checked={config.header?.show_phone ?? true}
                      onChange={(e) => updateNestedConfig('header.show_phone', e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                    />
                  </label>

                  {config.header?.show_phone && (
                    <div className="pl-2 space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 dark:text-slate-400 block uppercase">{isArabic ? "تخصيص رقم الهاتف في الفاتورة" : "Custom Receipt Phone Number"}</label>
                      <input
                        type="text"
                        value={config.header?.custom_phone || ''}
                        onChange={(e) => updateNestedConfig('header.custom_phone', e.target.value)}
                        placeholder={store?.phone || "+32 2 555 0199"}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION 3: BELGIUM MANDATORY LEGAL LOCKS */}
            {!isKitchen && (
              <div className="bg-amber-50/50 dark:bg-amber-955/20 p-5 rounded-2xl border border-amber-200 dark:border-amber-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-sm text-amber-900 dark:text-amber-200 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-500" />
                    <span>{isArabic ? "البيانات المالية الإلزامية بالقانون البلجيكي" : "Belgian Fiscal Mandatory Fields"}</span>
                  </h3>
                  <span className="text-[10px] font-extrabold bg-amber-200/60 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full uppercase">LOCKED</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="flex items-center gap-1.5 p-2 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-amber-200/60 dark:border-amber-900/40 text-[11px] font-bold text-amber-850 dark:text-amber-300">
                    <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>Legal Name</span>
                  </div>
                  <div className="flex items-center gap-1.5 p-2 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-amber-200/60 dark:border-amber-900/40 text-[11px] font-bold text-amber-850 dark:text-amber-300">
                    <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>Store Address</span>
                  </div>
                  <div className="flex items-center gap-1.5 p-2 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-amber-200/60 dark:border-amber-900/40 text-[11px] font-bold text-amber-850 dark:text-amber-300">
                    <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>VAT Number</span>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 4: PAPER & LANGUAGE */}
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700 pb-3">
                <Sliders className="w-4 h-4 text-indigo-500" />
                <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">{isArabic ? "حجم الورق ولغة الطباعة" : "Paper Width & Print Language"}</h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase block">{isArabic ? "عرض الورق" : "Paper Width"}</label>
                  <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => updateNestedConfig('paper_width', 80)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        config.paper_width === 80 ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      80mm (Standard)
                    </button>
                    <button
                      type="button"
                      onClick={() => updateNestedConfig('paper_width', 58)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        config.paper_width === 58 ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      58mm (Compact)
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase block">{isArabic ? "لغة الطباعة" : "Language Mode"}</label>
                  <select
                    value={config.language_mode || 'en'}
                    onChange={(e) => updateNestedConfig('language_mode', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="en">English (الإنجليزية)</option>
                    <option value="ar">العربية (Arabic)</option>
                    <option value="fr">Français (الفرنسية)</option>
                    <option value="nl">Nederlands (الهولندية)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* SECTION 5: CUSTOM HEADER & FOOTER LINES */}
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-3">
                {isArabic ? "السطور الترحيبية والإضافية (Header & Footer Lines)" : "Custom Header & Footer Announcement Lines"}
              </h3>

              {/* Custom Header Lines */}
              <div className="space-y-2">
                <span className="text-xs font-extrabold text-slate-800 dark:text-white block">{isArabic ? "سطور الهيدر الإضافية" : "Header Custom Lines"}</span>
                <div className="space-y-1.5">
                  {(config.header?.custom_lines || []).map((line, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{line}</span>
                      <button type="button" onClick={() => handleRemoveHeaderLine(idx)} className="text-rose-500 hover:text-rose-700 p-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newHeaderLine}
                    onChange={(e) => setNewHeaderLine(e.target.value)}
                    placeholder={isArabic ? "سطر هيدر جديد..." : "Add header line..."}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button type="button" onClick={handleAddHeaderLine} className="px-3 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold text-xs flex items-center gap-1 shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isArabic ? "إضافة" : "Add"}</span>
                  </button>
                </div>
              </div>

              {/* Custom Footer Lines */}
              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <span className="text-xs font-extrabold text-slate-800 dark:text-white block">{isArabic ? "سطور الفوتر الإضافية" : "Footer Custom Lines"}</span>
                <div className="space-y-1.5">
                  {(config.footer?.custom_lines || []).map((line, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{line}</span>
                      <button type="button" onClick={() => handleRemoveFooterLine(idx)} className="text-rose-500 hover:text-rose-700 p-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFooterLine}
                    onChange={(e) => setNewFooterLine(e.target.value)}
                    placeholder={isArabic ? "سطر فوتر جديد..." : "Add footer line..."}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button type="button" onClick={handleAddFooterLine} className="px-3 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold text-xs flex items-center gap-1 shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isArabic ? "إضافة" : "Add"}</span>
                  </button>
                </div>
              </div>

            </div>

          </div>

          {/* RIGHT COLUMN: Real-time Live Thermal Preview (5 Cols) */}
          <div className="lg:col-span-5 lg:sticky lg:top-6 space-y-4">
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">{isArabic ? "معاينة الفاتورة المباشرة" : "Live Thermal Preview"}</h3>
                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-955/40 px-2 py-0.5 rounded-md uppercase">
                  {selectedType.replace('_', ' ')}
                </span>
              </div>

              <ReceiptPreview config={config} store={store} isArabic={isArabic} templateType={selectedType} />
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
