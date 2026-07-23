/* eslint-disable */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import Login from './Login';
import { printReceipt } from './utils/printerService';
import { calculateOrderAccounting } from './utils/taxCalculator';
import { validateSplitAmounts, calculateFiftyFiftySplit, toCents, fromCents } from './utils/splitPaymentUtils';
import { createTerminalAttemptFinalizer, isFinalTerminalStatus, normalizeTerminalStatus } from './utils/terminalAttempt';
import AdminDashboard from './admin/AdminDashboard';
import StoreThemeProvider from './providers/StoreThemeProvider';
import PrintingDiagnosticsModal from './components/admin/PrintingDiagnosticsModal';
import { addDiagnosticLog, setLastPrintAttempt, getLastPrintAttempt } from './utils/diagnosticLogger';
import CashmintLogo from './components/branding/CashmintLogo';
import IpadInstallGuide from './components/IpadInstallGuide';
import { isStandalone, isIosOrIpad } from './utils/pwaIpadUtils';

const currentMode = import.meta.env.VITE_APP_MODE || import.meta.env.MODE;

const isMasterHost = typeof window !== 'undefined' &&
  (
    window.location.hostname === 'cashmint.online' ||
    window.location.hostname.endsWith('.cashmint.online') ||
    import.meta.env.VITE_APP_MODE === 'master' ||
    import.meta.env.MODE === 'master'
  );

const isPosMode = (import.meta.env.VITE_APP_MODE === 'pos' || import.meta.env.MODE === 'pos') && !isMasterHost;
const isStoreMode = !isPosMode && !isMasterHost;

console.log("MODE AUDIT", {
  VITE_APP_MODE: import.meta.env.VITE_APP_MODE,
  MODE: import.meta.env.MODE,
  currentMode,
  isMasterHost,
  isPosMode,
  isStoreMode,
  hostname: typeof window !== 'undefined' ? window.location.hostname : 'ssr'
});


const isStoreOnboarded = (store) => Boolean(store?.onboarding_completed && store?.onboarding_status === 'completed');

const terminalCartFingerprint = (items) => JSON.stringify((items || []).map(item => ({
  productId: item.product?.id || null,
  quantity: item.quantity,
  modifiers: (item.selectedModifiers || []).map(modifier => ({ id: modifier.id, price: modifier.price_adjustment })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
})))

// Lazy load onboarding wizard, superadmin, and landing page components for build-time tree-shaking
const OnboardingWizard = React.lazy(() => import('./components/OnboardingWizard'));
const SuperAdminDashboard = isMasterHost
  ? React.lazy(() => import('./superadmin/SuperAdminDashboard'))
  : () => null;
const LandingPage = isMasterHost
  ? React.lazy(() => import('./landing/LandingPage'))
  : () => null;
import {
  Utensils,
  Leaf,
  CupSoda,
  Smile,
  Sparkles,
  PlusCircle,
  Layers,
  Users,
  UtensilsCrossed,
  Clock,
  Wifi,
  LogOut,
  ShoppingBag,
  Home,
  Trash2,
  Plus,
  Minus,
  Settings,
  Flame,
  Soup,
  Check,
  Sliders,
  Sun,
  Moon,
  User,
  Lock,
  AlertCircle,
  Globe,
  CreditCard,
  KeyRound,
  Shield,
  Pencil,
  Printer,
  UserCheck,
  RefreshCw,
  ArrowRight
} from 'lucide-react';

const DEFAULT_PIN = import.meta.env.VITE_ADMIN_PIN || "1234";

const ARABIC_TRANSLATIONS = {
  "Tacos": "تاكو",
  "Side": "أطباق جانبية",
  "Family Meals": "وجبات عائلية",
  "Vegetarian Burgers": "برجر نباتي",
  "Pasta": "باستا",
  "Kids Menu": "وجبات الأطفال",
  "Fries": "بطاطس مقلية",
  "Dranken": "المشروبات",
  "Extras": "إضافات",
  "Beef Burgers Menu": "وجبات برجر لحم",
  "Beef Burgers": "برجر لحم",
  "Chicken Burgers Menu": "وجبات برجر دجاج",
  "Chicken Burgers": "برجر دجاج"
};

const TRANSLATIONS = {
  ar: {
    // Header & Brand
    "POS": "نظام المبيعات",
    "main_branch": "فرع بروكسل الرئيسي",
    "connected": "متصل بالشبكة",
    "disconnected": "غير متصل",
    "digital_clock": "الساعة",
    "active_cashier": "الكاشير 1",
    "active_staff": "عامل نشط",
    "backoffice": "لوحة التحكم",
    "settings": "الإعدادات",
    "logout": "تسجيل الخروج",
    // Categories & Titles
    "categories": "الأقسام",
    "cart_details": "تفاصيل السلة",
    "clear_all": "مسح الكل",
    "dine_in": "صالة",
    "takeaway": "سفري",
    "empty_cart": "سلتك فارغة حالياً",
    "remove": "إزالة",
    "subtotal": "المجموع الفرعي (Subtotal)",
    "vat": "ضريبة القيمة المضافة",
    "total": "الإجمالي (Total)",
    "pay_cash": "إتمام الدفع نقداً",
    "pay_card": "إتمام الدفع بالبطاقة",
    "no_products": "لا توجد منتجات في هذا القسم حالياً",
    // Modals & Settings
    "edit_meal": "تعديل الوجبة",
    "available_extras": "خيارات الإضافات المتوفرة:",
    "add_to_cart": "إضافة للسلة",
    "cancel": "إلغاء",
    "hardware_settings": "إعدادات الأجهزة / Hardware Settings",
    "local_printer_ip": "عنوان IP لطابعة Epson TM-T20IV (Local Printer IP)",
    "hubrise_location_id": "معرّف موقع HubRise (HubRise Location ID)",
    "save_settings": "حفظ الإعدادات",
    "test_print": "طباعة تجريبية",
    "confirm_logout": "تأكيد تسجيل الخروج",
    "logout_question": "هل أنت تأكد من أنك تريد تسجيل الخروج من النظام؟",
    "confirm": "متأكد",
    "belgium_tax": "ضريبة بلجيكا",
    "contains_extras": "يحتوي على إضافات",
    "tacos": "تاكو",
    "side": "أطباق جانبية",
    "family_meals": "وجبات عائلية",
    "veg_burgers": "برجر نباتي",
    "pasta": "باستا",
    "kids_menu": "وجبات الأطفال",
    "fries": "بطاطس مقلية",
    "dranken": "المشروبات",
    "extras": "إضافات",
    "beef_burgers_menu": "وجبات برجر لحم",
    "beef_burgers": "برجر لحم",
    "chicken_burgers_menu": "وجبات برجر دجاج",
    "chicken_burgers": "برجر دجاج"
  },
  en: {
    // Header & Brand
    "POS": "POS",
    "main_branch": "Main Brussels Branch",
    "connected": "Connected",
    "disconnected": "Offline",
    "digital_clock": "Clock",
    "active_cashier": "POS 01",
    "active_staff": "Active Staff",
    "backoffice": "Backoffice",
    "settings": "Settings",
    "logout": "Logout",
    // Categories & Titles
    "categories": "Categories",
    "cart_details": "Cart Details",
    "clear_all": "Clear All",
    "dine_in": "Dine-in",
    "takeaway": "Takeaway",
    "empty_cart": "Your cart is empty",
    "remove": "Remove",
    "subtotal": "Subtotal",
    "vat": "VAT",
    "total": "Total",
    "pay_cash": "Pay Cash",
    "pay_card": "Pay Card",
    "no_products": "No products in this category",
    // Modals & Settings
    "edit_meal": "Edit Meal",
    "available_extras": "Available Extras:",
    "add_to_cart": "Add to Cart",
    "cancel": "Cancel",
    "hardware_settings": "Hardware Settings",
    "local_printer_ip": "Epson TM-T20IV IP Address",
    "hubrise_location_id": "HubRise Location ID",
    "save_settings": "Save Settings",
    "test_print": "Test Print",
    "confirm_logout": "Confirm Logout",
    "logout_question": "Are you sure you want to sign out?",
    "confirm": "Logout",
    "belgium_tax": "Belgium VAT",
    "contains_extras": "Contains modifiers",
    "tacos": "Tacos",
    "side": "Sides",
    "family_meals": "Family Meals",
    "veg_burgers": "Veggie Burgers",
    "pasta": "Pasta",
    "kids_menu": "Kids Menu",
    "fries": "Fries",
    "dranken": "Drinks",
    "extras": "Extras",
    "beef_burgers_menu": "Beef Burgers Menu",
    "beef_burgers": "Beef Burgers",
    "chicken_burgers_menu": "Chicken Burgers Menu",
    "chicken_burgers": "Chicken Burgers"
  }
};

const getCategoryIcon = (categoryName) => {
  if (!categoryName) return <Utensils className="w-4 h-4" />;
  const name = categoryName.toLowerCase();
  if (name.includes('chicken burger')) return <Utensils className="w-4.5 h-4.5 text-amber-500" />;
  if (name.includes('beef burger')) return <UtensilsCrossed className="w-4.5 h-4.5 text-orange-500" />;
  if (name.includes('burger')) return <Utensils className="w-4.5 h-4.5 text-amber-500" />;
  if (name.includes('tacos')) return <Layers className="w-4.5 h-4.5 text-yellow-500" />;
  if (name.includes('fries') || name.includes('بطاطس')) return <Flame className="w-4.5 h-4.5 text-red-500" />;
  if (name.includes('drink') || name.includes('dranken') || name.includes('مشروب')) return <CupSoda className="w-4.5 h-4.5 text-sky-500" />;
  if (name.includes('pasta')) return <Soup className="w-4.5 h-4.5 text-purple-500" />;
  if (name.includes('kids') || name.includes('أطفال')) return <Smile className="w-4.5 h-4.5 text-emerald-500" />;
  if (name.includes('side') || name.includes('جانب')) return <Sparkles className="w-4.5 h-4.5 text-teal-500" />;
  if (name.includes('extra') || name.includes('إضاف')) return <PlusCircle className="w-4.5 h-4.5 text-slate-500" />;
  if (name.includes('family') || name.includes('عائل')) return <Users className="w-4.5 h-4.5 text-indigo-500" />;
  if (name.includes('veggie') || name.includes('vegetarian') || name.includes('نبات')) return <Leaf className="w-4.5 h-4.5 text-emerald-500" />;
  return <Utensils className="w-4.5 h-4.5" />;
};

const getProductCategoryStyles = (categoryName) => {
  if (!categoryName) return { border: 'border-slate-150 dark:border-slate-750', bg: 'bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-855', accent: 'text-amber-600 dark:text-amber-400' };
  const name = categoryName.toLowerCase();

  if (name.includes('beef') || name.includes('لحم') || name.includes('burger')) {
    if (name.includes('chicken') || name.includes('دجاج')) {
      return {
        border: 'border-amber-250 dark:border-amber-900/40 hover:border-amber-400 dark:hover:border-amber-500',
        bg: 'bg-amber-50/15 dark:bg-slate-800/90 hover:bg-amber-50/25 dark:hover:bg-slate-850',
        accent: 'text-amber-650 dark:text-amber-450'
      };
    }
    return {
      border: 'border-orange-250 dark:border-orange-900/40 hover:border-orange-400 dark:hover:border-orange-500',
      bg: 'bg-orange-50/15 dark:bg-slate-800/90 hover:bg-orange-50/25 dark:hover:bg-slate-850',
      accent: 'text-orange-600 dark:text-orange-400'
    };
  }

  if (name.includes('chicken') || name.includes('دجاج')) {
    return {
      border: 'border-yellow-250 dark:border-yellow-900/40 hover:border-yellow-400 dark:hover:border-yellow-500',
      bg: 'bg-yellow-50/15 dark:bg-slate-800/90 hover:bg-yellow-50/25 dark:hover:bg-slate-850',
      accent: 'text-yellow-600 dark:text-yellow-400'
    };
  }

  if (name.includes('drink') || name.includes('dranken') || name.includes('مشروب') || name.includes('cola')) {
    return {
      border: 'border-sky-250 dark:border-sky-900/40 hover:border-sky-400 dark:hover:border-sky-500',
      bg: 'bg-sky-50/15 dark:bg-slate-800/90 hover:bg-sky-50/25 dark:hover:bg-slate-850',
      accent: 'text-sky-600 dark:text-sky-400'
    };
  }

  if (name.includes('fries') || name.includes('بطاطس') || name.includes('side') || name.includes('جانب') || name.includes('extra') || name.includes('إضاف')) {
    return {
      border: 'border-teal-250 dark:border-teal-900/40 hover:border-teal-400 dark:hover:border-teal-500',
      bg: 'bg-teal-50/15 dark:bg-slate-800/90 hover:bg-teal-50/25 dark:hover:bg-slate-850',
      accent: 'text-teal-600 dark:text-teal-400'
    };
  }

  if (name.includes('veggie') || name.includes('vegetarian') || name.includes('نبات') || name.includes('tacos') || name.includes('pasta') || name.includes('kids') || name.includes('أطفال')) {
    return {
      border: 'border-emerald-250 dark:border-emerald-900/40 hover:border-emerald-400 dark:hover:border-emerald-500',
      bg: 'bg-emerald-50/15 dark:bg-slate-800/90 hover:bg-emerald-50/25 dark:hover:bg-slate-850',
      accent: 'text-emerald-600 dark:text-emerald-400'
    };
  }

  return {
    border: 'border-slate-200 dark:border-slate-700/60 hover:border-amber-400 dark:hover:border-amber-500',
    bg: 'bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-855',
    accent: 'text-amber-500 dark:text-amber-450'
  };
};

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [isCheckingStore, setIsCheckingStore] = useState(true);
  const [showMasterLogin, setShowMasterLogin] = useState(false);
  const [store, setStore] = useState(null);
  const [userRole, setUserRole] = useState('cashier'); // 'cashier' or 'admin'

  // Static Device Authentication states
  const [deviceAuth, setDeviceAuth] = useState(null); // { deviceId, storeId }
  const [activeCashierSession, setActiveCashierSession] = useState(null); // { id, cashierName, openingBalance }
  const [cashierPin, setCashierPin] = useState('');
  const [isDeviceBlocked, setIsDeviceBlocked] = useState(false);

  const terminalDeviceCredentials = () => ({
    pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null,
    pos_device_token: localStorage.getItem('device_token') || null,
  });

  const handleAccountDeleted = async () => {
    console.warn("Account or store record not found. Terminating session...");
    const savedPrinterIP = localStorage.getItem('local_printer_ip');
    localStorage.clear();
    sessionStorage.clear();
    if (savedPrinterIP) localStorage.setItem('local_printer_ip', savedPrinterIP);
    localStorage.setItem('auth_error_reason', 'deleted');
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Sign out error:", err);
    }
    setSession(null);
    setStore(null);
    setUserRole('cashier');
    window.location.href = '/?error=deleted';
  };

  // Cashier Session setup states
  const [cashierNameInput, setCashierNameInput] = useState('');
  const [openingBalanceInput, setOpeningBalanceInput] = useState('0.00');
  const [setupPinInput, setSetupPinInput] = useState('0000');
  const [busyLevelInput, setBusyLevelInput] = useState('low');
  const [setupError, setSetupError] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);

  // Theme state & effect for manual Dark Mode
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);

  // Set mode-specific browser tab title
  useEffect(() => {
    if (isMasterHost) {
      document.title = 'Cashmint | الإدارة المركزية';
    } else if (isStoreMode) {
      if (store?.name) {
        document.title = `${store.name} | Cashmint إدارة المطعم`;
      } else {
        document.title = 'Cashmint | إدارة المطعم';
      }
    } else if (isPosMode) {
      const storeName = store?.name || localStorage.getItem('current_store_name');
      if (storeName) {
        document.title = `${storeName} | Cashmint نقاط البيع`;
      } else {
        document.title = 'Cashmint | نقاط البيع';
      }
    }
  }, [store?.name]);

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const headerLogoInputRef = useRef(null);
  const handleHeaderLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !store?.id) return;

    try {
      showNotification(isArabic ? "جاري رفع الشعار..." : "Uploading logo...", "info");

      const fileExt = file.name.split('.').pop();
      const fileName = `${store.id}-${Date.now()}.${fileExt}`;
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
        .eq('id', store.id);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [secretTapCount, setSecretTapCount] = useState(0);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [actualCashInput, setActualCashInput] = useState('');
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [printerIP, setPrinterIP] = useState(() => localStorage.getItem('local_printer_ip') || '');

  useEffect(() => {
    const checkDiagnosticsUrl = () => {
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      if (path.includes('/printing-diagnostics') || search.includes('diagnostics=printing') || hash.includes('printing-diagnostics')) {
        setDiagnosticsOpen(true);
      }
    };
    checkDiagnosticsUrl();
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', checkDiagnosticsUrl);
      return () => window.removeEventListener('popstate', checkDiagnosticsUrl);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      setPrinterIP(localStorage.getItem('local_printer_ip') || '');
    }
  }, [settingsOpen]);
  const [activeSettingsTab, setActiveSettingsTab] = useState('printer'); // 'printer', 'audio', 'display'
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(() => {
    return localStorage.getItem('auto_print_enabled') !== 'false';
  });
  const [autoPrintCashier, setAutoPrintCashier] = useState(() => localStorage.getItem('auto_print_cashier') !== 'false');
  const [autoPrintCustomer, setAutoPrintCustomer] = useState(() => localStorage.getItem('auto_print_customer') === 'true');
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(() => localStorage.getItem('auto_print_kitchen') !== 'false');

  const [notification, setNotification] = useState(null);
  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const [isArabic, setIsArabic] = useState(() => {
    const saved = localStorage.getItem('app_language');
    if (saved) return saved === 'ar';
    return true;
  });

  useEffect(() => {
    localStorage.setItem('app_language', isArabic ? 'ar' : 'en');
  }, [isArabic]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'app_language') {
        setIsArabic(e.newValue === 'ar');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  const [beepEnabled, setBeepEnabled] = useState(() => {
    return localStorage.getItem('beep_enabled') === 'true';
  });
  const [orderCompleteSoundEnabled, setOrderCompleteSoundEnabled] = useState(() => {
    return localStorage.getItem('order_complete_sound_enabled') === 'true';
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [productCardSize, setProductCardSize] = useState(() => {
    return localStorage.getItem('product_card_size') || 'spacious';
  });

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
      console.warn("Audio context failed:", e);
    }
  };

  const playChime = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const playTone = (freq, start, duration) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime + start);
        osc.start(audioCtx.currentTime + start);
        osc.stop(audioCtx.currentTime + start + duration);
      };
      playTone(523.25, 0, 0.12);
      playTone(659.25, 0.12, 0.20);
    } catch (e) {
      console.warn("Audio context failed:", e);
    }
  };
  const [hubriseLocationId, setHubriseLocationId] = useState('');
  const [view, setView] = useState('pos'); // 'pos' or 'admin'

  const t = (key) => {
    if (!key) return '';
    const cleanKey = key.trim();
    if (isArabic) {
      if (ARABIC_TRANSLATIONS[cleanKey]) return ARABIC_TRANSLATIONS[cleanKey];
    }

    const currentLang = isArabic ? 'ar' : 'en';
    if (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][cleanKey]) {
      return TRANSLATIONS[currentLang][cleanKey];
    }
    return cleanKey;
  };

  const [cart, setCart] = useState([]);
  const [resolvedTaxRates, setResolvedTaxRates] = useState({});
  const [bundleComponents, setBundleComponents] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  // Delivery orders originate from connected ordering channels, not this POS.
  const [orderType, setOrderType] = useState('takeaway');
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' or 'card'

  // The POS preview follows the same per-order-type resolver as checkout.
  // Checkout still recalculates on the database, so this is only a display aid.
  useEffect(() => {
    const storeId = store?.id || deviceAuth?.storeId || localStorage.getItem('store_id');
    const productIds = [...new Set(cart.flatMap(item => {
      const components = bundleComponents.filter(component => component.bundle_product_id === item.product?.id);
      return components.length ? components.map(component => component.component_product_id) : [item.product?.id];
    }).filter(Boolean))];
    if (!storeId || productIds.length === 0) { setResolvedTaxRates({}); return; }
    let cancelled = false;
    Promise.all(productIds.map(async (productId) => {
      const { data, error } = await supabase.rpc('resolve_store_tax_rate', {
        p_product_id: productId, p_store_id: storeId, p_order_type: orderType
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return [productId, Number(row?.vat_rate)];
    })).then((entries) => {
      if (!cancelled) setResolvedTaxRates(Object.fromEntries(entries));
    }).catch((error) => {
      console.warn('Could not resolve POS tax preview:', error.message);
      if (!cancelled) setResolvedTaxRates({});
    });
    return () => { cancelled = true; };
  }, [cart, bundleComponents, orderType, store?.id, deviceAuth?.storeId]);

  // Coupon/Promo Code states
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError, setCouponError] = useState(null);
  const [couponSuccessMessage, setCouponSuccessMessage] = useState(null);
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  // Stripe Terminal states
  const [showStripeModal, setShowStripeModal] = useState(false);
  const [activePaymentOrderId, setActivePaymentOrderId] = useState(null);
  const [activePaymentRequestId, setActivePaymentRequestId] = useState(null);
  const [stripeStatus, setStripeStatus] = useState('connecting'); // 'connecting', 'waiting_for_card', 'processing', 'success', 'failed'
  const [activePaymentProvider, setActivePaymentProvider] = useState('stripe_android_bridge');
  const [isCancellingPayment, setIsCancellingPayment] = useState(false);
  const [terminalRecovery, setTerminalRecovery] = useState(null);
  const [pendingTerminalOrder, setPendingTerminalOrder] = useState(null);
  const [terminalAvailability, setTerminalAvailability] = useState({ checked: false, available: false });
  const activePaymentRequestIdRef = useRef(null);
  const activePaymentOrderIdRef = useRef(null);
  const activePaymentOrderRef = useRef(null);
  const terminalAttemptRef = useRef({ paymentRequestId: null, generation: 0 });
  const activePaymentUnknownNoticeRef = useRef(false);
  const checkoutInFlightRef = useRef(false);
  const autoPrintJobsRef = useRef(new Map());
  const autoPrintQueueRef = useRef(Promise.resolve());

  const activateTerminalAttempt = useCallback(({ requestId, orderId, provider, status, order }) => {
    if (!requestId) return false;
    terminalAttemptRef.current = {
      paymentRequestId: requestId,
      generation: terminalAttemptRef.current.generation + 1,
    };
    activePaymentRequestIdRef.current = requestId;
    activePaymentOrderIdRef.current = orderId || null;
    if (order) activePaymentOrderRef.current = order;
    setTerminalRecovery(null);
    setActivePaymentOrderId(orderId || null);
    setActivePaymentRequestId(requestId);
    setActivePaymentProvider(provider || 'stripe_android_bridge');
    setStripeStatus(status || 'waiting_for_card');
    setShowStripeModal(true);
    return true;
  }, []);

  const resumeActiveTerminalPayment = useCallback((availability) => {
    const requestId = availability?.active_payment_request_id;
    if (!requestId) return false;
    return activateTerminalAttempt({
      requestId,
      orderId: availability.active_payment_order_id || null,
      provider: availability.provider_type,
      status: availability.active_payment_status || 'waiting_for_card',
    });
  }, [activateTerminalAttempt]);

  // Split Payment states
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitCashInput, setSplitCashInput] = useState('');
  const [splitCardInput, setSplitCardInput] = useState('');
  const [splitInputMode, setSplitInputMode] = useState('cash');
  const [activeSplit, setActiveSplit] = useState(null);
  const [isSubmittingSplit, setIsSubmittingSplit] = useState(false);
  const [confirmCashReturnedModal, setConfirmCashReturnedModal] = useState(false);

  const isOrderReceiptPrinted = (orderId) => {
    if (!orderId) return false;
    try {
      const raw = localStorage.getItem('printed_receipt_orders') || '[]';
      const list = JSON.parse(raw);
      return list.includes(orderId);
    } catch (e) {
      return false;
    }
  };

  const recordOrderReceiptPrinted = (orderId) => {
    if (!orderId) return;
    try {
      const raw = localStorage.getItem('printed_receipt_orders') || '[]';
      const list = JSON.parse(raw);
      if (!list.includes(orderId)) {
        list.push(orderId);
        if (list.length > 200) list.shift();
        localStorage.setItem('printed_receipt_orders', JSON.stringify(list));
      }
    } catch (e) {
      console.warn("Failed to update printed_receipt_orders:", e);
    }
  };

  const markOrderReceiptPrinted = (orderId) => {
    if (!orderId) return false;
    if (isOrderReceiptPrinted(orderId)) return false;
    recordOrderReceiptPrinted(orderId);
    return true;
  };
  useEffect(() => {
    activePaymentOrderIdRef.current = activePaymentOrderId;
  }, [activePaymentOrderId]);

  const enqueueAutoReceiptPrint = useCallback((order) => {
    console.log("[CASH-TRACE] enqueue-enter", order);
    addDiagnosticLog({
      type: '[CASH-TRACE]',
      step: 'enqueue-enter',
      success: true,
      metadata: { orderId: order?.id, paymentMethod: order?.payment_method || 'cash' }
    });

    const orderKey = order?.id || (order?.receipt_number ? `receipt-${order.receipt_number}` : null);
    if (!orderKey) {
      console.warn("🖨️ [AUTO-PRINT] Missing orderKey, skipping print.");
      addDiagnosticLog({
        type: '[CASH-TRACE]',
        step: 'missing-order-key',
        success: false,
        error: 'Missing order key'
      });
      return Promise.resolve({ success: false, skipped: true, reason: 'missing_order_key' });
    }

    const existingJob = autoPrintJobsRef.current.get(orderKey);
    if (existingJob) {
      console.log("🖨️ [AUTO-PRINT] Print job already queued/in progress for orderKey:", orderKey);
      return existingJob;
    }

    const job = autoPrintQueueRef.current
      .catch(() => { })
      .then(async () => {
        const autoPrintMaster = localStorage.getItem('auto_print_enabled') !== 'false';
        const localPrinterIP = localStorage.getItem('local_printer_ip') || '';

        const autoPrintCashier = localStorage.getItem('auto_print_cashier') !== 'false';
        const autoPrintCustomer = localStorage.getItem('auto_print_customer') === 'true';
        const autoPrintKitchen = localStorage.getItem('auto_print_kitchen') !== 'false';

        addDiagnosticLog({
          type: '[CASH-TRACE]',
          step: 'settings-check',
          success: true,
          metadata: { autoPrintMaster, localPrinterIP, autoPrintCashier, autoPrintCustomer, autoPrintKitchen }
        });

        // 0. Cash Order Data Validation before printing
        const rawItems = order?.raw_payload?.cart_items || [];
        const hasValidOrder = Boolean(order?.id);
        const hasCartItems = Array.isArray(rawItems) && rawItems.length > 0;
        const hasTotals = order?.total_amount !== undefined;
        const hasPrinterIP = Boolean(localPrinterIP);
        const hasOutputs = autoPrintCashier || autoPrintCustomer || autoPrintKitchen;

        if (!hasValidOrder || !hasCartItems || !hasTotals || !hasPrinterIP || !hasOutputs || !autoPrintMaster) {
          let validationErrCode = 'INVALID_ORDER_PAYLOAD';
          let validationMessage = 'Order validation failed: ';
          if (!hasValidOrder) { validationErrCode = 'MISSING_ORDER_ID'; validationMessage += 'Missing order ID. '; }
          else if (!hasCartItems) { validationErrCode = 'MISSING_CART_ITEMS'; validationMessage += 'Order payload has 0 cart items. '; }
          else if (!hasTotals) { validationErrCode = 'MISSING_TOTALS'; validationMessage += 'Order totals missing. '; }
          else if (!hasPrinterIP) { validationErrCode = 'MISSING_PRINTER_IP'; validationMessage += 'Printer IP address not set. '; }
          else if (!hasOutputs) { validationErrCode = 'NO_OUTPUTS_ENABLED'; validationMessage += 'No auto-print output toggles enabled. '; }
          else if (!autoPrintMaster) { validationErrCode = 'AUTO_PRINT_DISABLED'; validationMessage += 'Master auto-print toggle is disabled. '; }

          addDiagnosticLog({
            type: '[CASH-TRACE]',
            step: 'validation-failed',
            success: false,
            code: validationErrCode,
            error: validationMessage,
            metadata: { orderId: order?.id, itemCount: rawItems.length, localPrinterIP }
          });

          setLastPrintAttempt({
            orderId: order?.id || null,
            paymentMethod: order?.payment_method || 'cash',
            attemptedTypes: [],
            success: false,
            logoIncluded: false,
            errorStage: 'Validation',
            errorCode: validationErrCode,
            retryAllowed: false,
            printableOrder: order,
            rawEpsonResponse: null
          });

          if (!autoPrintMaster) {
            return { success: false, skipped: true, reason: 'disabled_or_no_ip' };
          }

          showNotification(
            isArabic ? "فشلت طباعة الفاتورة. افتح قائمة تشخيص الطباعة للتفاصيل." : "Receipt printing failed. Open Printing Diagnostics for details.",
            "error"
          );
          return { success: false, skipped: true, reason: validationErrCode };
        }

        console.log(`[CASH-TRACE] dedupe-before - orderId: ${order?.id}`);
        if (order?.id && isOrderReceiptPrinted(order.id)) {
          console.log(`[CASH-TRACE] dedupe-result - Order already printed previously: ${order.id}`);
          addDiagnosticLog({
            type: '[CASH-TRACE]',
            step: 'dedupe-check',
            success: true,
            metadata: { alreadyPrinted: true, orderId: order.id }
          });
          return { success: true, skipped: true, alreadyPrinted: true };
        }

        const enabledOutputs = [];
        if (autoPrintCashier) enabledOutputs.push('pos_receipt');
        if (autoPrintCustomer) enabledOutputs.push('customer_receipt');
        if (autoPrintKitchen) enabledOutputs.push('kitchen_ticket');

        // Fetch store templates
        console.log("[CASH-TRACE] template-fetch-start");
        const tplMap = {};
        if (store?.id) {
          try {
            const { data: tpls } = await supabase
              .from('receipt_templates')
              .select('template_type, config_json')
              .eq('store_id', store.id)
              .eq('is_active', true);

            (tpls || []).forEach(t => {
              tplMap[t.template_type] = t.config_json;
            });
            console.log("[CASH-TRACE] template-fetch-result", Object.keys(tplMap));
          } catch (e) {
            console.warn("[CASH-TRACE] template-fetch-result error:", e);
          }
        }

        let overallSuccess = true;
        let lastError = '';

        for (let i = 0; i < enabledOutputs.length; i++) {
          const outputType = enabledOutputs[i];
          const templateConfig = tplMap[outputType] || tplMap['cashier_receipt'] || tplMap['pos_receipt'];
          console.log(`🖨️ [AUTO-PRINT] Dispatching output ${i + 1}/${enabledOutputs.length} (${outputType}) to ${localPrinterIP}`);

          let jobRes = { success: false, error: 'Print job failed' };
          for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`[CASH-TRACE] network-send-start attempt ${attempt} for ${outputType}`);
            addDiagnosticLog({
              type: '[CASH-TRACE]',
              step: `network-send-start-${outputType}`,
              success: true,
              metadata: { attempt, outputType, printerIP: localPrinterIP }
            });

            jobRes = await printReceipt(order, localPrinterIP, store || 'Cashmint', {
              templateConfig,
              outputType,
              skipFallback: true,
              isArabic
            });

            console.log(`[CASH-TRACE] network-send-result attempt ${attempt}:`, jobRes);
            addDiagnosticLog({
              type: '[CASH-TRACE]',
              step: `network-send-result-${outputType}`,
              success: jobRes.success,
              status: jobRes.status,
              code: jobRes.code,
              transport: jobRes.transport,
              error: jobRes.error
            });

            if (jobRes.success) break;
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }

          if (!jobRes.success) {
            overallSuccess = false;
            lastError = jobRes.error || 'Printer unreachable';
          }

          if (i < enabledOutputs.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }

        setLastPrintAttempt({
          orderId: order.id,
          paymentMethod: order.payment_method || 'cash',
          attemptedTypes: enabledOutputs,
          success: overallSuccess,
          logoIncluded: Boolean(store?.logo_url || store?.logoUrl),
          errorStage: overallSuccess ? null : 'Epson Network POST',
          errorCode: overallSuccess ? null : (lastError || 'EPSON_RESPONSE_ERROR'),
          retryAllowed: !overallSuccess && !isOrderReceiptPrinted(order.id),
          printableOrder: order,
          rawEpsonResponse: lastError
        });

        if (!overallSuccess) {
          showNotification(
            isArabic ? "فشلت طباعة الفاتورة. افتح قائمة تشخيص الطباعة للتفاصيل." : "Receipt printing failed. Open Printing Diagnostics for details.",
            "error"
          );
        } else {
          if (order?.id) {
            console.log(`[CASH-TRACE] dedupe-write - recording print success for orderId: ${order.id}`);
            recordOrderReceiptPrinted(order.id);
            addDiagnosticLog({
              type: '[CASH-TRACE]',
              step: 'dedupe-write',
              success: true,
              metadata: { orderId: order.id }
            });
          }
          showNotification(isArabic ? "تم إرسال الفاتورة للطابعة بنجاح" : "Receipt printed successfully");
        }
        return { success: overallSuccess, error: lastError };
      });

    autoPrintJobsRef.current.set(orderKey, job);
    autoPrintQueueRef.current = job
      .catch(() => { })
      .then(() => new Promise(resolve => setTimeout(resolve, 3000)));
    setTimeout(() => autoPrintJobsRef.current.delete(orderKey), 60000);
    return job;
  }, [store, isArabic]);

  // The iPad never connects to a reader. It only enables card checkout when a
  // registered Android bridge has recently reported an attached reader.
  useEffect(() => {
    const storeId = store?.id || deviceAuth?.storeId || localStorage.getItem('store_id');
    const deviceId = deviceAuth?.deviceId || localStorage.getItem('device_id');
    if (!storeId) return;
    let alive = true;
    const check = async () => {
      const { data, error } = await supabase.rpc('terminal_payment_availability', { p_store_id: storeId, p_pos_device_id: deviceId || null });
      if (alive) {
        setTerminalAvailability(prev => {
          const nextAvailable = !error && data?.available === true;
          const nextReaderOnline = !error && data?.reader_online === true;
          const nextActivePayment = !error && data?.active_payment === true;
          const nextProvider = data?.provider_type || 'none';
          if (prev.checked && prev.available === nextAvailable && prev.readerOnline === nextReaderOnline && prev.activePayment === nextActivePayment && prev.providerType === nextProvider) {
            return prev;
          }
          return {
            checked: true,
            available: nextAvailable,
            readerOnline: nextReaderOnline,
            activePayment: nextActivePayment,
            providerType: nextProvider,
            readerBusy: !error && data?.reader_busy === true,
            activePaymentRequestId: !error ? data?.active_payment_request_id || null : null,
            activePaymentOrderId: !error ? data?.active_payment_order_id || null : null,
            activePaymentStatus: !error ? data?.active_payment_status || null : null,
            failureMessage: error?.message || data?.failure_message || null
          };
        });
        if (!error && data?.active_payment_request_id) resumeActiveTerminalPayment(data);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [store?.id, deviceAuth?.storeId, deviceAuth?.deviceId, resumeActiveTerminalPayment]);

  // Backoffice PIN Gate & OTP Recovery States
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isPinSetup, setIsPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(() => {
    const saved = localStorage.getItem('backoffice_failed_attempts');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [lockoutStage, setLockoutStage] = useState(() => {
    const saved = localStorage.getItem('backoffice_lockout_stage');
    return saved ? parseInt(saved, 10) : 0;
  });

  const handleSetFailedAttempts = (val) => {
    setFailedAttempts(val);
    localStorage.setItem('backoffice_failed_attempts', val.toString());
  };

  const handleSetLockoutStage = (val) => {
    setLockoutStage(val);
    localStorage.setItem('backoffice_lockout_stage', val.toString());
  };

  const [isOtpRecovery, setIsOtpRecovery] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [isOtpVerified, setIsOtpVerified] = useState(false);

  // Real-time Clock State
  const [currentTime, setCurrentTime] = useState('');

  // Network Status State
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Modifiers Modal State
  const [activeProduct, setActiveProduct] = useState(null);
  const [selectedModifiers, setSelectedModifiers] = useState([]);

  // Maintenance Mode States
  const [isUnderMaintenance, setIsUnderMaintenance] = useState(false);

  // Fetch and check maintenance mode status
  useEffect(() => {
    async function checkMaintenanceMode() {
      try {
        const { data, error } = await supabase
          .from('system_settings')
          .select('maintenance_mode')
          .eq('id', 1)
          .maybeSingle();

        if (error) throw error;
        if (data?.maintenance_mode) {
          // Verify if the active user is an admin or superadmin
          const isSuper = isMasterHost;
          const { storeData, roleVal } = await resolveTenant(session);

          if (!isSuper && roleVal !== 'admin') {
            setIsUnderMaintenance(true);
          } else {
            setIsUnderMaintenance(false);
          }
        } else {
          setIsUnderMaintenance(false);
        }
      } catch (err) {
        console.error("Error verifying maintenance mode status:", err);
      }
    }

    checkMaintenanceMode();
    // Check every 30 seconds
    const interval = setInterval(checkMaintenanceMode, 30000);
    return () => clearInterval(interval);
  }, [session, userRole, isMasterHost]);

  const resolveTenant = async (sessionData) => {
    if (!sessionData) return { storeData: null, roleVal: 'cashier', mappingExists: false };
    try {
      // Fetch mapping from store_users
      const { data: mapping, error: mapError } = await supabase
        .from('store_users')
        .select('store_id, role')
        .eq('user_id', sessionData.user.id)
        .limit(1)
        .maybeSingle();

      if (mapError) {
        await handleSupabaseError(mapError);
      }

      let fetchedStoreId = mapping?.store_id || null;
      let roleVal = mapping?.role || 'admin';
      let mappingExists = !!mapping;

      let storeData = null;
      if (fetchedStoreId) {
        const { data: storeRow, error: storeErr } = await supabase
          .from('stores')
          .select('*')
          .eq('id', fetchedStoreId)
          .maybeSingle();
        if (storeErr) await handleSupabaseError(storeErr);
        storeData = storeRow;
      }

      return { storeData, roleVal, mappingExists };
    } catch (err) {
      console.error("Error in resolveTenant:", err);
      return { storeData: null, roleVal: 'admin', mappingExists: false };
    }
  };

  // Error handling function to clear stale Supabase auth cache on 401
  const handleSupabaseError = async (error) => {
    if (!error) return;
    if (error.status === 401 || error.message?.includes('JWT') || error.message?.includes('invalid claim')) {
      console.warn("Unauthorized/expired JWT detected. Logging out...");
      try {
        await supabase.auth.signOut();
      } catch (signOutErr) {
        console.error("Error signing out:", signOutErr);
      }

      setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
  };

  const fetchPOSCatalogData = useCallback(async (customStore = store) => {
    // Device terminals use a server-side RPC because POS activation is anonymous.
    if (deviceAuth?.deviceId) {
      try {
        setLoadingData(true);
        setIsCheckingStore(true);
        const { data: catalog, error } = await supabase.rpc('get_pos_catalog', {
          device_uuid: deviceAuth.deviceId
        });
        if (error) throw error;
        const activeStore = catalog?.store || null;
        const cats = catalog?.categories || [];
        const prods = catalog?.products || [];
        const mods = catalog?.modifiers || [];
        const bundles = catalog?.bundle_components || [];
        setStore(activeStore);
        setCategories(cats);
        setProducts(prods);
        setModifiers(mods);
        setBundleComponents(bundles);
        setSelectedCategoryId(cats[0]?.id || null);
        localStorage.setItem('pos_menu_items', JSON.stringify({ categories: cats, products: prods, modifiers: mods, bundleComponents: bundles }));
        return;
      } catch (err) {
        console.error('Error fetching POS catalog:', err);
        showNotification('Error loading POS catalog', 'error');
      } finally {
        setLoadingData(false);
        setIsCheckingStore(false);
      }
    }

    let activeStore = customStore;

    // If no store is provided/set, but we have deviceAuth, fetch the store info first
    if (!activeStore && deviceAuth?.storeId) {
      try {
        setLoadingData(true);
        setIsCheckingStore(true);
        await supabase.auth.getSession();
        const { data: fetchedStore, error: storeErr } = await supabase
          .from('stores')
          .select('*')
          .eq('id', deviceAuth.storeId)
          .maybeSingle();

        if (storeErr) {
          console.error("Store fetch error:", storeErr);
          await handleSupabaseError(storeErr);
          showNotification("خطأ في تحميل بيانات المتجر", "error");
        }
        if (fetchedStore) {
          activeStore = fetchedStore;
          setStore(fetchedStore);
          setHubriseLocationId(fetchedStore.hubrise_location_id || '');
          setUserRole('cashier');
          localStorage.setItem('store_id', fetchedStore.id);
          localStorage.setItem('current_store_name', fetchedStore.name || '');
          localStorage.setItem('current_store_logo', fetchedStore.logo_url || '');
        } else {
          setStore(null);
          setUserRole(null);
        }
      } catch (err) {
        console.error("Error loading store:", err);
      }
    }

    if (!activeStore) {
      setLoadingData(false);
      setIsCheckingStore(false);
      return;
    }

    try {
      setLoadingData(true);
      setIsCheckingStore(true);

      // If in master mode or no store found/incomplete store profile, do not fetch POS catalog data
      if (import.meta.env.VITE_APP_MODE === 'master' || !activeStore.name || !activeStore.business_type) {
        setCategories([]);
        setProducts([]);
        setModifiers([]);
        return;
      }

      // Fetch Categories for this store only
      const { data: cats, error: catsErr } = await supabase
        .from('categories')
        .select('*')
        .eq('store_id', activeStore.id)
        .order('name');
      if (catsErr) {
        await handleSupabaseError(catsErr);
        throw catsErr;
      }

      // Fetch Products for this store only
      const { data: prods, error: prodsErr } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', activeStore.id)
        .order('name');
      if (prodsErr) {
        await handleSupabaseError(prodsErr);
        throw prodsErr;
      }

      // Fetch Modifiers
      const { data: mods, error: modsErr } = await supabase
        .from('modifiers')
        .select('*');
      if (modsErr) {
        await handleSupabaseError(modsErr);
        throw modsErr;
      }

      setCategories(cats || []);
      setProducts(prods || []);

      // Filter modifiers to only those belonging to store's products
      const prodIds = (prods || []).map(p => p.id);
      const filteredMods = (mods || []).filter(m => prodIds.includes(m.product_id));
      setModifiers(filteredMods);

      // Write menu to localStorage immediately
      localStorage.setItem('pos_menu_items', JSON.stringify({
        categories: cats || [],
        products: prods || [],
        modifiers: filteredMods
      }));

      if (cats && cats.length > 0) {
        setSelectedCategoryId(cats[0].id);
      } else {
        setSelectedCategoryId(null);
      }
    } catch (err) {
      console.error("Error fetching POS data:", err);
      showNotification("خطأ في تحميل البيانات من السيرفر", "error");
    } finally {
      setLoadingData(false);
      setIsCheckingStore(false);
    }
  }, [deviceAuth, store?.id]);

  const initSession = useCallback(async () => {
    try {
      setLoadingSession(true);
      const { data: { session: sessionData }, error } = await supabase.auth.getSession();
      if (error) {
        await handleSupabaseError(error);
        setSession(null);
        return;
      }

      if (sessionData) {
        if (isMasterHost && sessionData.user?.email !== 'superadmin@cashmint.online') {
          await supabase.auth.signOut();
          setSession(null);
          setLoadingSession(false);
          return;
        }
        setSession(sessionData);

        // Clear Stale Storage on User Switch
        const storedUserId = localStorage.getItem('current_user_id');
        if (storedUserId && storedUserId !== sessionData.user.id) {
          console.log("User switch detected! Clearing store-related local storage keys...");
          localStorage.removeItem('store_id');
          localStorage.removeItem('device_id');
          localStorage.removeItem('cashier_session_id');
          localStorage.removeItem('cashier_name');
          localStorage.removeItem('current_store_name');
          localStorage.removeItem('current_store_logo');
          localStorage.removeItem('pos_menu_items');
          localStorage.removeItem('cashier_opening_balance');
          localStorage.removeItem('cashier_pin');
          localStorage.removeItem('pin');
          localStorage.removeItem('lockout_stage');
          localStorage.removeItem('failed_attempts');
          localStorage.removeItem('lockout_until');
          setStore(null);
          setDeviceAuth(null);
          setActiveCashierSession(null);
          setCashierPin('');
        }
        localStorage.setItem('current_user_id', sessionData.user.id);

        const { storeData, roleVal, mappingExists } = await resolveTenant(sessionData);

        // Enforce account check for non-superadmins
        if (sessionData.user?.email !== 'superadmin@cashmint.online') {
          if (!mappingExists || (mappingExists && !storeData)) {
            await handleAccountDeleted();
            return;
          }
        }

        setUserRole(roleVal);

        setStore(storeData);
        if (storeData) {
          localStorage.setItem('store_id', storeData.id);
          localStorage.setItem('current_store_name', storeData.name || '');
          localStorage.setItem('current_store_logo', storeData.logo_url || '');
        }

        // If master host or in store/backoffice mode, stop here and bypass POS checks
        if (isMasterHost || isStoreMode) {
          setLoadingSession(false);
          setIsCheckingStore(false);
          return;
        }
      } else {
        setSession(null);
      }
    } catch (err) {
      console.error("Error restoring session:", err);
    } finally {
      setLoadingSession(false);
    }

    // If master or store mode, stop and do not do POS checks
    if (isMasterHost || isStoreMode) {
      setLoadingSession(false);
      setIsCheckingStore(false);
      return;
    }

    // POS mode device & cashier session resolution
    const storedDeviceId = localStorage.getItem('device_id');
    const storedStoreId = localStorage.getItem('store_id');
    if (storedDeviceId && storedStoreId) {
      setDeviceAuth({ deviceId: storedDeviceId, storeId: storedStoreId });

      const storedSessionId = localStorage.getItem('cashier_session_id');
      const storedCashierName = localStorage.getItem('cashier_name');
      const storedOpeningBalance = localStorage.getItem('cashier_opening_balance');
      const storedPin = localStorage.getItem('cashier_pin');
      if (storedSessionId && storedCashierName) {
        setActiveCashierSession({
          id: storedSessionId,
          cashierName: storedCashierName,
          openingBalance: parseFloat(storedOpeningBalance || 0),
          totalSales: 0,
          cashBalance: parseFloat(storedOpeningBalance || 0)
        });
        setCashierPin(storedPin || '');
      }
    }
    setLoadingSession(false);
  }, [isMasterHost, isStoreMode, resolveTenant]);

  // Load device authentication and cashier session from localStorage / Supabase session
  useEffect(() => {
    initSession();

    // Listen for auth changes if in store/admin/master mode
    let subscription = null;
    if (isMasterHost || isStoreMode) {
      const { data } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
        if (isMasterHost && currentSession && currentSession.user?.email !== 'superadmin@cashmint.online') {
          await supabase.auth.signOut();
          setSession(null);
          return;
        }
        setSession(currentSession);
        if (currentSession) {
          setIsCheckingStore(true);
          // Clear Stale Storage on User Switch
          const storedUserId = localStorage.getItem('current_user_id');
          if (storedUserId && storedUserId !== currentSession.user.id) {
            console.log("User switch detected on auth change! Clearing store-related local storage keys...");
            localStorage.removeItem('store_id');
            localStorage.removeItem('device_id');
            localStorage.removeItem('cashier_session_id');
            localStorage.removeItem('cashier_name');
            localStorage.removeItem('cashier_opening_balance');
            localStorage.removeItem('cashier_pin');
            localStorage.removeItem('pin');
            localStorage.removeItem('lockout_stage');
            localStorage.removeItem('failed_attempts');
            localStorage.removeItem('lockout_until');
            setStore(null);
            setDeviceAuth(null);
            setActiveCashierSession(null);
            setCashierPin('');
          }
          localStorage.setItem('current_user_id', currentSession.user.id);

          try {
            const { storeData, roleVal, mappingExists } = await resolveTenant(currentSession);

            // Enforce account check for non-superadmins
            if (currentSession.user?.email !== 'superadmin@cashmint.online') {
              if (!mappingExists || (mappingExists && !storeData)) {
                await handleAccountDeleted();
                return;
              }
            }

            setUserRole(roleVal);
            setStore(storeData);
            if (storeData) {
              localStorage.setItem('store_id', storeData.id);
            }
          } catch (err) {
            console.error("Error fetching store on auth change:", err);
          } finally {
            setIsCheckingStore(false);
          }
        } else {
          setStore(null);
          setUserRole('cashier');
          localStorage.removeItem('current_user_id');
          setIsCheckingStore(false);
        }
      });
      subscription = data?.subscription || null;
    }

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, [isArabic]);

  // Real-time status subscription for active device_id
  useEffect(() => {
    if (!deviceAuth?.deviceId) return;

    const deviceSubscription = supabase
      .channel('device-status-realtime')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events
          schema: 'public',
          table: 'pos_devices',
          filter: `id=eq.${deviceAuth.deviceId}`
        },
        (payload) => {
          console.log('Real-time device change:', payload);
          if (payload.eventType === 'DELETE') {
            showNotification(isArabic ? "تم حذف هذا الجهاز من المسؤول!" : "This device has been deleted by the administrator!", "error");
            handleRemoteRevokeLogout();
          } else if (payload.eventType === 'UPDATE' && payload.new && payload.new.status !== 'active') {
            showNotification(isArabic ? "تم إلغاء تفعيل هذا الجهاز من المسؤول!" : "This device has been deactivated by the administrator!", "error");
            handleRemoteRevokeLogout();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(deviceSubscription);
    };
  }, [deviceAuth?.deviceId, isArabic]);

  // Periodic device heartbeat & remote disable control (every 20s)
  useEffect(() => {
    const deviceId = deviceAuth?.deviceId || localStorage.getItem('device_id');
    const deviceToken = localStorage.getItem('device_token');
    if (!deviceId) return;

    const checkDeviceHeartbeat = async () => {
      try {
        const { data, error } = await supabase.rpc('touch_pos_device_v2', {
          p_device_id: deviceId,
          p_device_token: deviceToken || null
        });

        if (error) throw error;
        if (!data || data.is_blocked || data.status !== 'active') {
          setIsDeviceBlocked(true);
          if (data?.status === 'revoked') {
            localStorage.removeItem('device_id');
            localStorage.removeItem('device_token');
            localStorage.removeItem('device_name');
            setDeviceAuth(null);
          }
        } else {
          setIsDeviceBlocked(false);
        }
      } catch (err) {
        console.error("Error during device heartbeat:", err);
      }
    };

    checkDeviceHeartbeat();
    const interval = setInterval(checkDeviceHeartbeat, 20000);
    return () => clearInterval(interval);
  }, [deviceAuth?.deviceId]);

  // Live Digital Clock Effect
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Network Status Effect
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch data from Supabase only when deviceAuth is active
  // Fetch data from Supabase only when deviceAuth or store changes
  useEffect(() => {
    if (!deviceAuth && !store) {
      setIsCheckingStore(false);
      return;
    }
    fetchPOSCatalogData();
  }, [deviceAuth, store?.id, fetchPOSCatalogData]);

  // Heartbeat/ping for active cashier session to keep device status online
  useEffect(() => {
    const activeSessionId = activeCashierSession?.id || localStorage.getItem('cashier_session_id');
    if (!activeSessionId) return;
    const deviceId = deviceAuth?.deviceId || localStorage.getItem('device_id');
    if (!deviceId) return;

    const sendHeartbeat = async () => {
      try {
        await supabase.rpc('touch_pos_device', { device_uuid: deviceId });
      } catch (err) {
        console.error("Heartbeat error:", err);
      }
    };

    // Send immediately on start
    sendHeartbeat();

    // Set interval every 25 seconds
    const interval = setInterval(sendHeartbeat, 25000);

    return () => clearInterval(interval);
  }, [activeCashierSession, deviceAuth?.deviceId]);

  // Real-time subscription to orders table
  useEffect(() => {
    if (!deviceAuth || !store) return;

    const ordersSubscription = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `store_id=eq.${store.id}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            console.log('New order received in real-time:', payload.new);
            // Alert cashier if it's a delivery order or status is new
            if (payload.new.order_type === 'delivery' || payload.new.status === 'new') {
              showNotification(`📦 طلب توصيل جديد بقيمة ${parseFloat(payload.new.total_amount).toFixed(2)} EUR`, "info");
            }
          } else if (payload.eventType === 'UPDATE') {
            console.log('Order updated in real-time:', payload.new);

            // Check if this matches our active stripe terminal transaction and payment has completed
            if (
              payload.new.status === 'completed' &&
              payload.new.id === activePaymentOrderIdRef.current &&
              !activeSplit
            ) {
              enqueueAutoReceiptPrint(payload.new);

              if (localStorage.getItem('order_complete_sound_enabled') === 'true') {
                playChime();
              }
              setCart([]);
              setShowStripeModal(false);
              activePaymentRequestIdRef.current = null;
              terminalAttemptRef.current = { paymentRequestId: null, generation: terminalAttemptRef.current.generation + 1 };
              setActivePaymentOrderId(null);
              setActivePaymentRequestId(null);
              setPendingTerminalOrder(null);
              setTerminalRecovery(null);
              activePaymentOrderRef.current = null;
              showNotification(isArabic ? "تم إكمال دفع Stripe بنجاح! 🚀" : "Stripe payment successfully completed! 🚀");

              // Update cashier session totals in local state for card orders
              const orderTotal = parseFloat(payload.new.total_amount || 0);
              setActiveCashierSession(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  totalSales: Number(prev.totalSales || 0) + orderTotal
                };
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ordersSubscription);
    };
  }, [deviceAuth, store, activeSplit, isArabic, enqueueAutoReceiptPrint]);

  useEffect(() => {
    if (!activePaymentRequestId) return;
    const paymentRequestId = activePaymentRequestId;
    if (terminalAttemptRef.current.paymentRequestId !== paymentRequestId) {
      terminalAttemptRef.current = {
        paymentRequestId,
        generation: terminalAttemptRef.current.generation + 1,
      };
    }
    activePaymentRequestIdRef.current = paymentRequestId;
    activePaymentUnknownNoticeRef.current = false;
    let poll = null;
    let channel = null;
    let pollInFlight = false;

    const clearPolling = () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };
    const removeRealtime = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
    const isCurrentAttempt = (requestId) => (
      activePaymentRequestIdRef.current === requestId
      && terminalAttemptRef.current.paymentRequestId === requestId
    );
    const verifySplitCompletion = async (request, orderId) => {
      if (!activeSplit) return true;
      if (!activeSplit.card_part_id || activeSplit.card_payment_request_id !== request.id || activeSplit.split_id == null) return false;
      const [requestRead, partRead, splitRead, orderRead] = await Promise.all([
        supabase.from('payment_requests').select('id,order_id,split_part_id,stripe_payment_intent_id,status').eq('id', request.id).maybeSingle(),
        supabase.from('payment_split_parts').select('id,split_id,order_id,method,amount_cents,status,payment_id,provider_reference').eq('id', activeSplit.card_part_id).maybeSingle(),
        supabase.from('payment_splits').select('id,order_id,status').eq('id', activeSplit.split_id).maybeSingle(),
        supabase.from('orders').select('id,status').eq('id', orderId).maybeSingle(),
      ]);
      if (requestRead.error || partRead.error || splitRead.error || orderRead.error) return false;
      const currentRequest = requestRead.data;
      const cardPart = partRead.data;
      const split = splitRead.data;
      const order = orderRead.data;
      return Boolean(
        currentRequest?.id === request.id &&
        currentRequest.order_id === orderId &&
        currentRequest.split_part_id === activeSplit.card_part_id &&
        currentRequest.status === 'succeeded' &&
        currentRequest.stripe_payment_intent_id &&
        cardPart?.split_id === activeSplit.split_id &&
        cardPart.order_id === orderId &&
        cardPart.method === 'card' &&
        cardPart.status === 'succeeded' &&
        cardPart.payment_id &&
        cardPart.provider_reference === currentRequest.stripe_payment_intent_id &&
        split?.id === activeSplit.split_id &&
        split.order_id === orderId &&
        split.status === 'succeeded' &&
        order?.status === 'completed'
      );
    };
    const finalizeTerminalAttempt = createTerminalAttemptFinalizer({
      paymentRequestId,
      isCurrentAttempt,
      clearPolling,
      removeRealtime,
      resetState: ({ finalStatus, outcome, orderId, receiptOrder, message }) => {
        const recoveryOrder = receiptOrder || activePaymentOrderRef.current || (orderId ? { id: orderId } : null);
        activePaymentRequestIdRef.current = null;
        activePaymentOrderIdRef.current = null;
        setActivePaymentRequestId(null);
        setActivePaymentOrderId(null);
        setIsCancellingPayment(false);
        checkoutInFlightRef.current = false;
        setIsSubmittingSplit(false);
        setStripeStatus(finalStatus);

        if (outcome === 'success') {
          if (recoveryOrder) enqueueAutoReceiptPrint({ ...recoveryOrder, status: 'completed' });
          if (localStorage.getItem('order_complete_sound_enabled') === 'true') playChime();
          setCart([]);
          setPendingTerminalOrder(null);
          setTerminalRecovery(null);
          setShowStripeModal(false);
          setActiveSplit(null);
          activePaymentOrderRef.current = null;
          return;
        }

        if (activeSplit) {
          // The split recovery surface owns its own actions and keeps the
          // partially-paid order available for retry or cash completion.
          setShowStripeModal(false);
          return;
        }

        if (recoveryOrder?.id) {
          setPendingTerminalOrder(previous => previous || {
            orderId: recoveryOrder.id,
            order: recoveryOrder,
            cartFingerprint: terminalCartFingerprint(cart),
          });
          setTerminalRecovery({
            paymentRequestId,
            orderId: recoveryOrder.id,
            order: recoveryOrder,
            provider: activePaymentProvider,
            status: finalStatus,
            message: message || (finalStatus === 'cancelled' ? 'Payment cancelled' : 'Card payment could not be confirmed'),
          });
          activePaymentOrderRef.current = recoveryOrder;
        }
        setShowStripeModal(true);
      },
      showResult: ({ outcome, message, finalStatus }) => {
        if (outcome === 'success') {
          showNotification('Stripe payment successfully completed!');
        } else {
          showNotification(message || (finalStatus === 'cancelled' ? 'Payment cancelled' : 'Card payment could not be confirmed'), 'error');
        }
      },
    });

    const handlePaymentRequestUpdate = async (request) => {
      if (!request || !isCurrentAttempt(paymentRequestId)) return;
      const status = normalizeTerminalStatus(request.status);
      setStripeStatus(status);
      if (status === 'succeeded') {
        const orderId = activePaymentOrderIdRef.current || request.order_id;
        if (!orderId) return;
        if (activeSplit) {
          setStripeStatus('verifying_card');
          const verifiedSplit = await verifySplitCompletion(request, orderId);
          if (!isCurrentAttempt(paymentRequestId)) return;
          if (!verifiedSplit) {
            setShowStripeModal(true);
            showNotification('Verifying card payment with Stripe...', 'info');
            return;
          }
        }
        const requestSaysOrderCompleted = request.order_status === 'completed';
        const { data: completedOrder, error } = await supabase
          .from('orders')
          .select('*')
          .eq('id', orderId)
          .maybeSingle();
        if (error && !requestSaysOrderCompleted) {
          showNotification(error.message || 'Card payment completed, but order status could not be loaded.', 'info');
          return;
        }
        if (completedOrder?.status !== 'completed' && !requestSaysOrderCompleted) {
          showNotification('Payment confirmed, waiting for the server to complete the order.', 'info');
          return;
        }
        finalizeTerminalAttempt({
          finalStatus: 'succeeded',
          outcome: 'success',
          orderId,
          receiptOrder: completedOrder || activePaymentOrderRef.current,
        });
        return;
      }
      if (status === 'unknown') {
        setShowStripeModal(true);
        if (!activePaymentUnknownNoticeRef.current) {
          activePaymentUnknownNoticeRef.current = true;
          showNotification('Payment is still being checked with Stripe. Do not charge the customer again yet.', 'info');
        }
        return;
      }
      if (isFinalTerminalStatus(status)) {
        finalizeTerminalAttempt({
          finalStatus: status,
          orderId: activePaymentOrderIdRef.current || request.order_id,
          message: request.failure_message || (status === 'cancelled' ? 'Payment cancelled' : 'Card payment could not be confirmed'),
        });
      }
    };

    channel = supabase.channel(`terminal-payment-${paymentRequestId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payment_requests', filter: `id=eq.${paymentRequestId}` }, ({ new: request }) => {
        handlePaymentRequestUpdate(request);
      }).subscribe();

    const pollPaymentResult = async () => {
      if (pollInFlight || !isCurrentAttempt(paymentRequestId)) return;
      pollInFlight = true;
      try {
        const posDeviceId = deviceAuth?.deviceId || localStorage.getItem('device_id') || null;
        const { data, error } = await supabase.rpc('terminal_payment_result_for_pos', {
          p_payment_request_id: paymentRequestId,
          p_pos_device_id: posDeviceId
        });
        if (activePaymentProvider === 'stripe_server_driven' && isCurrentAttempt(paymentRequestId)) {
          const { data: serverStatus, error: serverStatusError } = await supabase.functions.invoke('retrieve-terminal-payment-status', {
            body: { payment_request_id: paymentRequestId, ...terminalDeviceCredentials() },
          });
          if (!serverStatusError && serverStatus) {
            await handlePaymentRequestUpdate({
              id: paymentRequestId,
              status: serverStatus.status === 'succeeded' ? 'succeeded' : serverStatus.status === 'requires_payment_method' ? 'failed' : serverStatus.status,
              order_id: activePaymentOrderIdRef.current,
              failure_code: serverStatus.failure_code,
              failure_message: serverStatus.failure_message,
            });
          }
        }
        const result = Array.isArray(data) ? data[0] : data;
        if (!error && result) {
          await handlePaymentRequestUpdate({
            id: result.payment_request_id,
            status: result.request_status,
            order_id: result.order_id,
            order_status: result.order_status,
            failure_code: result.failure_code,
            failure_message: result.failure_message
          });
        }
      } finally {
        pollInFlight = false;
      }
    };
    pollPaymentResult();
    poll = setInterval(pollPaymentResult, 2500);
    return () => {
      clearPolling();
      removeRealtime();
    };
  }, [activePaymentRequestId, activePaymentProvider, activeSplit, deviceAuth?.deviceId, enqueueAutoReceiptPrint, isArabic, showNotification, cart]);


  // Filtered Products
  const filteredProducts = selectedCategoryId
    ? products.filter(p => p.category_id === selectedCategoryId)
    : products;

  // Add Product flow
  const handleProductClick = (product) => {
    const productMods = modifiers.filter(m => m.product_id === product.id);
    if (productMods.length > 0) {
      setActiveProduct(product);
      setSelectedModifiers([]);
    } else {
      addToCart(product, []);
    }
  };

  // Add to cart helper
  const addToCart = (product, selectedMods) => {
    if (beepEnabled) playBeep();
    const modIds = selectedMods.map(m => m.id).sort().join(',');

    const existingIndex = cart.findIndex(item => {
      const itemModIds = item.selectedModifiers.map(m => m.id).sort().join(',');
      return item.product.id === product.id && itemModIds === modIds;
    });

    if (existingIndex > -1) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += 1;
      setCart(newCart);
    } else {
      setCart([...cart, {
        id: `${product.id}-${Date.now()}`,
        product,
        quantity: 1,
        selectedModifiers: selectedMods
      }]);
    }
    showNotification(`تمت إضافة ${product.name} إلى السلة`);
  };

  const handleConfirmModifiers = () => {
    if (activeProduct) {
      const selectedModsObjects = modifiers.filter(m => selectedModifiers.includes(m.id));
      addToCart(activeProduct, selectedModsObjects);
      setActiveProduct(null);
      setSelectedModifiers([]);
    }
  };

  const handleToggleModifier = (modId) => {
    if (selectedModifiers.includes(modId)) {
      setSelectedModifiers(selectedModifiers.filter(id => id !== modId));
    } else {
      setSelectedModifiers([...selectedModifiers, modId]);
    }
  };

  const updateQuantity = (cartItemId, amount) => {
    const item = cart.find(i => i.id === cartItemId);
    if (!item) return;

    const newQty = item.quantity + amount;
    if (newQty <= 0) {
      setCart(cart.filter(i => i.id !== cartItemId));
      showNotification(`تمت إزالة ${item.product.name}`);
    } else {
      setCart(cart.map(i => i.id === cartItemId ? { ...i, quantity: newQty } : i));
    }
  };

  // Auto-remove applied coupon if cart is emptied
  useEffect(() => {
    if (cart.length === 0) {
      setAppliedCoupon(null);
      setCouponSuccessMessage(null);
      setCouponError(null);
      setCouponCodeInput('');
    }
  }, [cart.length]);

  // Apply Promo Code (Coupon)
  const handleApplyCoupon = async () => {
    if (cart.length === 0) {
      setCouponError(isArabic ? "السلة فارغة" : "Cart is empty");
      setCouponSuccessMessage(null);
      return;
    }
    if (!couponCodeInput || !couponCodeInput.trim()) {
      setCouponError(isArabic ? "الرجاء إدخال كود الخصم" : "Please enter a promo code");
      setCouponSuccessMessage(null);
      return;
    }
    if (!store?.id) {
      setCouponError(isArabic ? "لم يتم العثور على المتجر" : "Store not found");
      setCouponSuccessMessage(null);
      return;
    }

    setIsValidatingCoupon(true);
    setCouponError(null);
    setCouponSuccessMessage(null);

    try {
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .eq('store_id', store.id)
        .eq('code', couponCodeInput.trim())
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error("Error fetching coupon:", error);
        throw error;
      }

      if (!data) {
        setCouponError(isArabic ? "كود الخصم غير صالح أو منتهي الصلاحية" : "Invalid or expired promo code");
        setAppliedCoupon(null);
      } else {
        setAppliedCoupon(data);
        const val = parseFloat(data.discount_value);
        if (data.discount_type === 'percentage') {
          setCouponSuccessMessage(
            isArabic
              ? `تم تطبيق خصم بقيمة ${val}%`
              : `Applied ${val}% discount successfully`
          );
        } else {
          setCouponSuccessMessage(
            isArabic
              ? `تم تطبيق خصم بقيمة ${val.toFixed(2)} €`
              : `Applied ${val.toFixed(2)} € discount successfully`
          );
        }
      }
    } catch (err) {
      console.error("Failed to apply coupon:", err);
      setCouponError(isArabic ? "فشل التحقق من كود الخصم" : "Failed to validate promo code");
      setAppliedCoupon(null);
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCodeInput('');
    setCouponError(null);
    setCouponSuccessMessage(null);
  };

  // Cart Calculations
  const cartSubtotal = cart.reduce((sum, item) => {
    const modsCost = item.selectedModifiers.reduce((s, m) => s + parseFloat(m.price_adjustment), 0);
    return sum + (parseFloat(item.product.price) + modsCost) * item.quantity;
  }, 0);

  const discountAmount = appliedCoupon
    ? (appliedCoupon.discount_type === 'percentage'
      ? cartSubtotal * (parseFloat(appliedCoupon.discount_value) / 100)
      : Math.min(parseFloat(appliedCoupon.discount_value), cartSubtotal))
    : 0;

  // A sellable combo is expanded only for accounting preview. The server repeats
  // the same expansion from product_bundle_components before persisting the order.
  const cartWithResolvedTax = cart.flatMap(item => {
    const components = bundleComponents.filter(component => component.bundle_product_id === item.product?.id);
    if (!components.length) return [{ ...item, product: { ...item.product, resolved_vat_rate: resolvedTaxRates[item.product?.id] } }];
    const componentProducts = components.map(component => ({ component, product: products.find(product => product.id === component.component_product_id) })).filter(entry => entry.product);
    const totalWeight = componentProducts.reduce((sum, entry) => sum + Number(entry.component.allocation_weight) * Number(entry.product.price), 0);
    if (!totalWeight) return [{ ...item, product: { ...item.product, resolved_vat_rate: resolvedTaxRates[item.product?.id] } }];
    return componentProducts.map(({ component, product }) => ({
      ...item,
      id: `${item.id}-${component.component_product_id}`,
      quantity: item.quantity * Number(component.quantity),
      selectedModifiers: [],
      product: { ...product, price: Number(item.product.price) * (Number(component.allocation_weight) * Number(product.price)) / totalWeight, resolved_vat_rate: resolvedTaxRates[product.id] }
    }));
  });
  let taxConfigurationError = null;
  let accountingBeforeDiscount;
  let accounting;
  try {
    accountingBeforeDiscount = calculateOrderAccounting(cartWithResolvedTax, 0, orderType);
    accounting = calculateOrderAccounting(cartWithResolvedTax, discountAmount, orderType);
  } catch (error) {
    taxConfigurationError = error;
    accountingBeforeDiscount = { lines: [], totals: { net: 0, vat: 0, gross: 0, discount: 0 } };
    accounting = { lines: [], totals: { net: 0, vat: 0, gross: 0, discount: 0 } };
  }
  const totalAmount = accounting.totals.gross;
  const vatAmount = accounting.totals.vat;
  const netDiscountAmount = accountingBeforeDiscount.totals.net - accounting.totals.net;
  const taxBreakdown = accounting.lines.reduce((groups, line) => {
    const key = Number(line.vatRate || 0).toFixed(2);
    const current = groups[key] || { net: 0, vat: 0, gross: 0 };
    current.net += line.netAmount;
    current.vat += line.vatAmount;
    current.gross += line.grossAmount;
    groups[key] = current;
    return groups;
  }, {});

  // Checkout and Insert into Supabase
  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (taxConfigurationError) {
      showNotification(taxConfigurationError.message, 'error');
      return;
    }
    if (terminalRecovery) {
      if (paymentMethod === 'cash') {
        await handlePayPendingOrderInCash();
      } else {
        setShowStripeModal(true);
        showNotification('This cart already has a pending order. Retry the existing card payment or choose cash.', 'info');
      }
      return;
    }
    if (checkoutInFlightRef.current || activePaymentRequestId) {
      showNotification(isArabic ? 'A card payment is already in progress.' : 'A card payment is already in progress.', 'info');
      return;
    }
    checkoutInFlightRef.current = true;
    console.log("[CASH-TRACE] checkout-enter");
    console.log(`[CASH-TRACE] selected-payment-method: ${paymentMethod}`);

    let isOrderCreated = false;
    let paymentRequestCreated = false;
    let createdOrderId = null;
    try {
      showNotification(isArabic ? "جاري إرسال الطلب..." : "Submitting order...", "info");

      const activeStoreId = store?.id || deviceAuth?.storeId || localStorage.getItem('store_id');
      const activeSessionId = activeCashierSession?.id || localStorage.getItem('cashier_session_id');

      if (paymentMethod === 'card') {
        const { data: availability, error: availabilityError } = await supabase.rpc('terminal_payment_availability', {
          p_store_id: activeStoreId,
          p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
        });
        if (availabilityError) throw availabilityError;
        if (availability?.active_payment) {
          resumeActiveTerminalPayment(availability);
          throw new Error('A card payment is already awaiting the customer on the WisePOS E reader.');
        }
      }

      const cartItems = cart.map(item => ({
        name: item.product?.name || 'Product',
        price: parseFloat(item.product?.price || 0),
        quantity: item.quantity,
        modifiers: (item.selectedModifiers || []).map(m => ({
          name: m.name,
          price_adjustment: parseFloat(m.price_adjustment || 0)
        }))
      }));

      // Creates the receipt, immutable item snapshots, and payment atomically.
      const rawPayload = {
        order_type: orderType,
        coupon_code: appliedCoupon ? appliedCoupon.code : null,
        discount_amount: accounting.totals.discount,
        cashier_session_id: activeSessionId,
        cart_items: cartItems,
        timestamp: new Date().toISOString()
      };

      console.log("[CASH-TRACE] order-create-start");
      const { data: orderData, error: orderErr } = await supabase.rpc('create_accounting_order', {
        p_store_id: activeStoreId,
        p_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id'),
        p_cashier_session_id: activeSessionId,
        p_status: paymentMethod === 'card' ? 'pending' : 'completed',
        p_payment_method: paymentMethod,
        p_order_type: orderType,
        p_currency: store?.currency || 'EUR',
        p_discount_amount: accounting.totals.discount,
        p_subtotal_excl_vat: accounting.totals.net,
        p_vat_amount: accounting.totals.vat,
        p_total_amount: accounting.totals.gross,
        p_raw_payload: rawPayload,
        p_lines: accounting.lines
      });
      if (orderErr) throw orderErr;
      const createdOrder = Array.isArray(orderData) ? orderData[0] : orderData;
      if (!createdOrder?.id) throw new Error('The order was not returned by the accounting checkout.');

      isOrderCreated = true;
      createdOrderId = createdOrder.id;
      console.log("[CASH-TRACE] order-create-result Order ID:", createdOrder.id);
      console.log("[CASH-TRACE] created-order-shape", createdOrder);

      const printableOrder = {
        ...createdOrder,
        raw_payload: {
          ...(createdOrder.raw_payload || {}),
          cart_items: cartItems
        }
      };
      console.log("[CASH-TRACE] printable-order-shape", printableOrder);

      // Update active cashier session totals in local React state
      const orderTotal = parseFloat(createdOrder.total_amount || 0);
      setActiveCashierSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          totalSales: Number(prev.totalSales || 0) + orderTotal,
          cashBalance: paymentMethod === 'cash' ? Number(prev.cashBalance || 0) + orderTotal : Number(prev.cashBalance || 0)
        };
      });

      // Complete checkout directly or initiate Stripe BBPOS WisePad 3 connection
      if (paymentMethod === 'card') {
        if (terminalAvailability.checked && !terminalAvailability.available) {
          showNotification(
            terminalAvailability.activePayment
              ? (isArabic ? "يوجد دفع بطاقة نشط بالفعل. ألغِ الدفع من تطبيق الجسر أولاً." : "A card payment is already active. Cancel it from the bridge app first.")
              : (isArabic ? "سنحاول إرسال الدفع للـ Terminal. تأكد أن WisePad 3 متصل في تطبيق الجسر." : "Trying the terminal anyway. Make sure the WisePad 3 is connected in the bridge app."),
            "info"
          );
        }
        const { data: paymentRequest, error: paymentRequestError } = await supabase.rpc('request_terminal_card_payment', {
          p_order_id: createdOrder.id,
          p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
        });
        if (paymentRequestError) throw paymentRequestError;
        if (!paymentRequest?.id) throw new Error('Card payment bridge did not accept the payment request.');
        paymentRequestCreated = true;
        const providerType = paymentRequest.provider_type || terminalAvailability.providerType || 'stripe_android_bridge';
        activePaymentOrderRef.current = printableOrder;
        setPendingTerminalOrder({
          orderId: createdOrder.id,
          order: printableOrder,
          cartFingerprint: terminalCartFingerprint(cart),
        });
        activateTerminalAttempt({
          requestId: paymentRequest.id,
          orderId: createdOrder.id,
          provider: providerType,
          status: paymentRequest.status || 'pending',
          order: printableOrder,
        });

        if (providerType === 'stripe_server_driven') {
          const { error: startError } = await supabase.functions.invoke('start-server-driven-terminal-payment', { body: { payment_request_id: paymentRequest.id, ...terminalDeviceCredentials() } });
          if (startError) throw startError;
        }

        if (orderCompleteSoundEnabled) playChime();
        showNotification(isArabic ? "جاري إرسال الطلب لجهاز البطاقة... 💳" : "Payment request sent to terminal... 💳");
      } else {
        // Cash / Direct payment completed
        if (orderCompleteSoundEnabled) playChime();
        showNotification(isArabic ? "تم إكمال الطلب وحفظه بنجاح! 🚀" : "Order completed and logged successfully! 🚀");

        try {
          console.log("[CASH-TRACE] enqueue-before Order ID:", printableOrder.id);
          enqueueAutoReceiptPrint(printableOrder);
        } catch (printErr) {
          console.error("Auto receipt printing error:", printErr);
          showNotification(isArabic ? "تم حفظ الطلب بنجاح، لكن فشلت طباعة الإيصال ⚠️" : "Order saved successfully, but printing receipt failed ⚠️", "warning");
        }
      }
    } catch (err) {
      if (isOrderCreated) {
        if (paymentMethod === 'card' && paymentRequestCreated) {
          setStripeStatus('failed');
          setShowStripeModal(true);
        }
        if (paymentMethod === 'card' && !paymentRequestCreated) {
          try {
            const { error: cleanupError } = await supabase.rpc('cancel_accounting_card_payment', {
              p_order_id: createdOrderId,
              p_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
            });
            if (cleanupError) console.error('PENDING CARD ORDER CLEANUP ERROR:', cleanupError);
          } catch (cleanupError) {
            console.error('PENDING CARD ORDER CLEANUP ERROR:', cleanupError);
          }
        }
        console.error("POST-CHECKOUT STEP WARNING:", err);
        const postCheckoutMessage = err?.message || err?.details || 'The payment or printing step failed.';
        showNotification(
          isArabic
            ? `تم حفظ الطلب، لكن فشلت الخطوة التالية: ${postCheckoutMessage}`
            : `Order saved, but the next step failed: ${postCheckoutMessage}`,
          "warning"
        );
      } else {
        console.error("DETAILED CHECKOUT ERROR:", err.message, err.details, err.hint, err);
        const errorCode = `${err?.message || ''} ${err?.details || ''}`;
        if (errorCode.includes('TAX_CONFIGURATION_MISSING')) {
          showNotification(
            isArabic
              ? "لا يمكن إتمام الطلب: مجموعة الحساب أو إعداد الضريبة لهذا المنتج غير مكتمل."
              : "Checkout is blocked because a product's accounting group or tax configuration is incomplete.",
            "error"
          );
        } else if (paymentMethod === 'card' && errorCode.trim()) {
          showNotification(errorCode.slice(0, 180), "error");
        } else if (errorCode.includes('COUPON_INVALID')) {
          showNotification(isArabic ? "كود الخصم غير صالح أو غير مفعّل." : "The coupon is invalid or inactive.", "error");
        } else {
          showNotification(isArabic ? "خطأ أثناء إرسال الطلب" : "Error occurred during checkout process", "error");
        }
      }
    } finally {
      checkoutInFlightRef.current = false;
    }
  };

  // Split Payment Action Handlers
  const handleConfirmSplitPayment = async () => {
    if (cart.length === 0) return;
    if (taxConfigurationError) {
      showNotification(taxConfigurationError.message, 'error');
      return;
    }
    const val = validateSplitAmounts(totalAmount, splitCashInput, splitCardInput, isArabic);
    if (!val.valid) {
      showNotification(val.error, 'error');
      return;
    }
    if (!terminalAvailability.checked || terminalAvailability.providerType !== 'stripe_server_driven') {
      showNotification(
        isArabic
          ? 'الدفع بالتجزئة يحتاج إلى إعداد WisePOS E فعال.'
          : 'Split payment requires an active WisePOS E terminal.',
        'error'
      );
      return;
    }
    if (!terminalAvailability.available) {
      showNotification(
        terminalAvailability.activePayment
          ? (isArabic ? 'يوجد دفع بطاقة نشط بالفعل. ألغِه أولاً.' : 'Another card payment is already active. Cancel it first.')
          : (isArabic ? 'قارئ WisePOS E غير متاح حاليًا.' : 'The WisePOS E reader is not available right now.'),
        'error'
      );
      return;
    }
    if (checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;
    setIsSubmittingSplit(true);

    let createdOrderId = null;
    let splitCreated = false;
    try {
      showNotification(isArabic ? "جاري إنشاء وتجهيز الدفع المجزأ..." : "Creating split payment...", "info");

      const activeStoreId = store?.id || deviceAuth?.storeId || localStorage.getItem('store_id');
      const activeSessionId = activeCashierSession?.id || localStorage.getItem('cashier_session_id');

      const rawPayload = {
        order_type: orderType,
        coupon_code: appliedCoupon ? appliedCoupon.code : null,
        discount_amount: accounting.totals.discount,
        cashier_session_id: activeSessionId,
        payment_splits: {
          cash_amount: val.cashCents / 100.0,
          card_amount: val.cardCents / 100.0,
          total_paid: totalAmount
        },
        timestamp: new Date().toISOString()
      };

      // 1. Create order in pending state
      const { data: orderData, error: orderErr } = await supabase.rpc('create_accounting_order', {
        p_store_id: activeStoreId,
        p_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id'),
        p_cashier_session_id: activeSessionId,
        p_status: 'pending',
        p_payment_method: 'split',
        p_order_type: orderType,
        p_currency: store?.currency || 'EUR',
        p_discount_amount: accounting.totals.discount,
        p_subtotal_excl_vat: accounting.totals.net,
        p_vat_amount: accounting.totals.vat,
        p_total_amount: accounting.totals.gross,
        p_raw_payload: rawPayload,
        p_lines: accounting.lines
      });
      if (orderErr) throw orderErr;
      const createdOrder = Array.isArray(orderData) ? orderData[0] : orderData;
      if (!createdOrder?.id) throw new Error('The order was not returned by checkout.');
      createdOrderId = createdOrder.id;

      // 2. Call create_split_payment RPC
      const idempotencyKey = `split-${createdOrder.id}-${Date.now()}`;
      const { data: splitData, error: splitErr } = await supabase.rpc('create_split_payment', {
        p_order_id: createdOrder.id,
        p_cash_amount_cents: val.cashCents,
        p_card_amount_cents: val.cardCents,
        p_idempotency_key: idempotencyKey,
        p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
      });
      if (splitErr) throw splitErr;

      const splitResult = Array.isArray(splitData) ? splitData[0] : splitData;
      splitCreated = Boolean(splitResult?.split_id && splitResult?.card_payment_request_id);
      if (!splitCreated) throw new Error('The split payment request was not returned by the server.');

      activePaymentOrderRef.current = createdOrder;
      setActiveSplit({
        split_id: splitResult.split_id,
        card_part_id: splitResult.card_part_id,
        card_payment_request_id: splitResult.card_payment_request_id,
        order_id: createdOrder.id,
        cash_amount_cents: val.cashCents,
        card_amount_cents: val.cardCents,
        status: splitResult.status
      });

      // Split checkout is gated above on the active WisePOS E configuration;
      // start the exact request returned by create_split_payment.
      const providerType = 'stripe_server_driven';
      activateTerminalAttempt({
        requestId: splitResult.card_payment_request_id,
        orderId: createdOrder.id,
        provider: providerType,
        status: 'pending',
        order: createdOrder,
      });
      setShowSplitModal(false);

      const { error: startError } = await supabase.functions.invoke('start-server-driven-terminal-payment', {
        body: { payment_request_id: splitResult.card_payment_request_id, ...terminalDeviceCredentials() }
      });
      if (startError) throw startError;

    } catch (err) {
      console.error("SPLIT CHECKOUT ERROR:", err);
      setStripeStatus('failed');
      setShowStripeModal(true);
      if (createdOrderId && !splitCreated) {
        try {
          await supabase.rpc('cancel_accounting_card_payment', {
            p_order_id: createdOrderId,
            p_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
          });
        } catch (cleanupError) {
          console.error('SPLIT ORDER CLEANUP ERROR:', cleanupError);
        }
      }
      showNotification(err.message || "Split payment creation failed", "error");
    } finally {
      checkoutInFlightRef.current = false;
      setIsSubmittingSplit(false);
    }
  };

  const getReusablePendingTerminalOrder = () => {
    const pending = pendingTerminalOrder || terminalRecovery;
    if (!pending?.orderId) return null;
    const fingerprint = pending.cartFingerprint || terminalCartFingerprint(cart);
    if (fingerprint !== terminalCartFingerprint(cart)) {
      showNotification('The cart changed after the card cancellation. Cancel the old order before starting a different cart.', 'error');
      return null;
    }
    return pending;
  };

  const handleRetryPendingCard = async () => {
    const pending = getReusablePendingTerminalOrder();
    if (!pending) return;
    try {
      checkoutInFlightRef.current = true;
      showNotification(isArabic ? 'Ø¬Ø§Ø±ÙŠ Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø© Ø§Ù„Ø¨Ø·Ø§Ù‚Ø©...' : 'Retrying card payment...', 'info');
      const { data, error } = await supabase.rpc('request_terminal_card_payment', {
        p_order_id: pending.orderId,
        p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null,
      });
      if (error) throw error;
      const nextRequest = Array.isArray(data) ? data[0] : data;
      if (!nextRequest?.id) throw new Error('Card payment retry was not accepted.');
      const provider = nextRequest.provider_type || pending.provider || activePaymentProvider;
      activateTerminalAttempt({
        requestId: nextRequest.id,
        orderId: pending.orderId,
        provider,
        status: nextRequest.status || 'pending',
        order: pending.order || activePaymentOrderRef.current,
      });
      if (provider === 'stripe_server_driven') {
        const { error: startError } = await supabase.functions.invoke('start-server-driven-terminal-payment', {
          body: { payment_request_id: nextRequest.id, ...terminalDeviceCredentials() },
        });
        if (startError) throw startError;
      }
    } catch (err) {
      showNotification(err.message || 'Retry card payment failed', 'error');
    } finally {
      checkoutInFlightRef.current = false;
    }
  };

  const handlePayPendingOrderInCash = async () => {
    const pending = getReusablePendingTerminalOrder();
    if (!pending) return;
    try {
      checkoutInFlightRef.current = true;
      showNotification(isArabic ? 'Ø¬Ø§Ø±ÙŠ ØªØ­ÙˆÙŠÙ„ Ø§Ù„Ø·Ù„Ø¨ Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯ Ø¥Ù„Ù‰ Ø§Ù„Ù†Ù‚Ø¯...' : 'Switching the existing order to cash...', 'info');
      const { data, error } = await supabase.rpc('complete_pending_order_in_cash', {
        p_order_id: pending.orderId,
        p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null,
      });
      if (error) throw error;
      const completedOrder = Array.isArray(data) ? data[0] : data;
      const printableOrder = { ...(pending.order || {}), ...(completedOrder || {}), status: 'completed' };
      enqueueAutoReceiptPrint(printableOrder);
      if (orderCompleteSoundEnabled) playChime();
      setActiveCashierSession(prev => prev ? {
        ...prev,
        cashBalance: Number(prev.cashBalance || 0) + Number(completedOrder?.total_amount || pending.order?.total_amount || 0),
      } : null);
      setCart([]);
      setTerminalRecovery(null);
      setPendingTerminalOrder(null);
      activePaymentRequestIdRef.current = null;
      activePaymentOrderIdRef.current = null;
      activePaymentOrderRef.current = null;
      setActivePaymentRequestId(null);
      setActivePaymentOrderId(null);
      setShowStripeModal(false);
      showNotification('Existing order completed in cash!');
    } catch (err) {
      showNotification(err.message || 'Switching to cash failed', 'error');
    } finally {
      checkoutInFlightRef.current = false;
    }
  };

  const handleCancelPendingOrder = async () => {
    const pending = getReusablePendingTerminalOrder();
    if (!pending) return;
    try {
      checkoutInFlightRef.current = true;
      const { error } = await supabase.rpc('cancel_accounting_card_payment', {
        p_order_id: pending.orderId,
        p_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null,
      });
      if (error) throw error;
      setCart([]);
      setTerminalRecovery(null);
      setPendingTerminalOrder(null);
      activePaymentRequestIdRef.current = null;
      activePaymentOrderIdRef.current = null;
      activePaymentOrderRef.current = null;
      setActivePaymentRequestId(null);
      setActivePaymentOrderId(null);
      setShowStripeModal(false);
      showNotification('Order cancelled. The POS is ready for the next customer.', 'info');
    } catch (err) {
      showNotification(err.message || 'Order cancellation failed', 'error');
    } finally {
      checkoutInFlightRef.current = false;
    }
  };

  const handleRetryCardPayment = async () => {
    if (!activeSplit?.split_id) return;
    try {
      showNotification(isArabic ? "جاري إرسال طلب جديد للبطاقة..." : "Retrying card payment...", "info");
      const { data, error } = await supabase.rpc('retry_split_card_payment', {
        p_split_id: activeSplit.split_id,
        p_idempotency_key: `retry-${activeSplit.split_id}-${Date.now()}`,
        p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
      });
      if (error) throw error;
      const res = Array.isArray(data) ? data[0] : data;
      if (!res?.card_payment_request_id || !res?.card_part_id) throw new Error('The retry request was not returned by the server.');
      setActiveSplit(previous => ({
        ...previous,
        card_part_id: res.card_part_id,
        card_payment_request_id: res.card_payment_request_id,
        status: 'awaiting_card',
      }));
      activateTerminalAttempt({
        requestId: res.card_payment_request_id,
        orderId: activePaymentOrderRef.current?.id || activeSplit.order_id,
        provider: activePaymentProvider,
        status: 'pending',
        order: activePaymentOrderRef.current,
      });
      const { error: retryError } = await supabase.functions.invoke('start-server-driven-terminal-payment', {
        body: { payment_request_id: res.card_payment_request_id, ...terminalDeviceCredentials() },
      });
      if (retryError) throw retryError;
    } catch (err) {
      showNotification(err.message || 'Retry card payment failed', 'error');
    }
  };

  const handlePayRemainingInCash = async () => {
    if (!activeSplit?.split_id) return;
    try {
      showNotification(isArabic ? "جاري تسجيل دفع المتبقي نقداً..." : "Paying remaining amount in cash...", "info");
      const { data, error } = await supabase.rpc('pay_remaining_split_in_cash', {
        p_split_id: activeSplit.split_id,
        p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
      });
      if (error) throw error;

      const orderToPrint = activePaymentOrderRef.current;
      if (orderToPrint) {
        enqueueAutoReceiptPrint({ ...orderToPrint, status: 'completed' });
      }

      if (orderCompleteSoundEnabled) playChime();
      setCart([]);
      setActiveSplit(null);
      setActivePaymentOrderId(null);
      setActivePaymentRequestId(null);
      activePaymentOrderRef.current = null;
      setShowStripeModal(false);
      showNotification(isArabic ? "تم استلام المتبقي نقداً بنجاح! 🚀" : "Remaining amount paid in cash! 🚀");
    } catch (err) {
      showNotification(err.message || 'Pay remaining in cash failed', 'error');
    }
  };

  const handleCancelSplitConfirmed = async () => {
    if (!activeSplit?.split_id) return;
    try {
      const { error } = await supabase.rpc('cancel_split_payment', {
        p_split_id: activeSplit.split_id,
        p_confirm_cash_returned: true,
        p_pos_device_id: deviceAuth?.deviceId || localStorage.getItem('device_id') || null
      });
      if (error) throw error;

      setConfirmCashReturnedModal(false);
      setActiveSplit(null);
      setActivePaymentOrderId(null);
      setActivePaymentRequestId(null);
      activePaymentOrderRef.current = null;
      setShowStripeModal(false);
      showNotification(isArabic ? "تم إلغاء الدفع المجزأ وإرجاع النقد للزبون." : "Split payment cancelled & cash returned.", "info");
    } catch (err) {
      showNotification(err.message || 'Cancel split failed', 'error');
    }
  };

  // Revoke device access (clear all states and localStorage)
  const handleRevokeLogout = () => {
    localStorage.removeItem('device_id');
    localStorage.removeItem('store_id');
    localStorage.removeItem('device_name');
    localStorage.removeItem('cashier_session_id');
    localStorage.removeItem('cashier_name');
    localStorage.removeItem('cashier_opening_balance');
    localStorage.removeItem('cashier_pin');

    setDeviceAuth(null);
    setActiveCashierSession(null);
    setCashierPin('');
    setStore(null);
    setCategories([]);
    setProducts([]);
    setModifiers([]);
    setSelectedCategoryId(null);
    setView('pos');
    setUserRole('cashier');
  };

  const handleRemoteRevokeLogout = async () => {
    const sessionId = activeCashierSession?.id || localStorage.getItem('cashier_session_id');
    if (sessionId) {
      try {
        const { data: currentSess } = await supabase
          .from('cashier_sessions')
          .select('*')
          .eq('id', sessionId)
          .maybeSingle();

        if (currentSess) {
          const currentMetadata = currentSess.metadata || {};
          const systemBalance = currentSess.cash_balance || 0;
          const updatedMetadata = {
            ...currentMetadata,
            closing_cash: systemBalance
          };

          await supabase
            .from('cashier_sessions')
            .update({
              status: 'closed',
              closed_at: new Date().toISOString(),
              metadata: updatedMetadata
            })
            .eq('id', sessionId);
        }
      } catch (err) {
        console.error("Error auto-closing cashier session on remote deactivation:", err);
      }
    }

    // Cleanly clear all terminal, cashier, and shift-related data from local storage
    const keysToRemove = [
      'device_id', 'current_device_id', 'store_id', 'device_name',
      'cashier_session_id', 'active_shift_id', 'cashier_name',
      'cashier_opening_balance', 'cashier_pin', 'pin',
      'lockout_stage', 'failed_attempts', 'lockout_until',
      'current_store_name', 'current_store_logo', 'pos_menu_items'
    ];
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Reset React States
    setDeviceAuth(null);
    setActiveCashierSession(null);
    setCashierPin('');
    setStore(null);
    setCategories([]);
    setProducts([]);
    setModifiers([]);
    setSelectedCategoryId(null);
    setView('pos');
    setUserRole('cashier');
  };

  // Manual logout and closing cashier session in database
  const handleDeviceLogout = async () => {
    const sessionId = localStorage.getItem('cashier_session_id');
    if (sessionId) {
      try {
        await supabase
          .from('cashier_sessions')
          .update({
            status: 'closed',
            closed_at: new Date().toISOString()
          })
          .eq('id', sessionId);
      } catch (err) {
        console.error("Error closing cashier session on logout:", err);
      }
    }
    handleRevokeLogout();
  };

  const handleHandoverSubmit = async (e) => {
    e.preventDefault();

    setHandoverLoading(true);
    const sessionId = activeCashierSession?.id || localStorage.getItem('cashier_session_id');
    try {
      if (sessionId) {
        const deviceId = deviceAuth?.deviceId || localStorage.getItem('device_id');
        const deviceToken = localStorage.getItem('device_token');
        const closingCash = Number(actualCashInput || 0);

        const { data: result, error } = await supabase.rpc('close_cashier_shift', {
          p_session_id: sessionId,
          p_device_id: deviceId,
          p_device_token: deviceToken || null,
          p_closing_cash_counted: Number.isFinite(closingCash) ? closingCash : 0,
          p_notes: null
        });

        if (error) throw error;
        if (!result?.success) {
          throw new Error(result?.error || 'Unable to close cashier shift');
        }
      }

      showNotification(isArabic ? "تم تسليم الوردية بنجاح!" : "Shift ended and session closed successfully!", "success");
      setLogoutConfirmOpen(false);
      setActualCashInput('');

      // Cleanly clear state and local storage
      handleRevokeLogout();
    } catch (err) {
      console.error("Handover error:", err);
      showNotification(isArabic ? "فشل تسليم الوردية" : "Failed to end shift session", "error");
    } finally {
      setHandoverLoading(false);
    }
  };

  const handleSetView = (newView) => {
    setView(newView);
    if (newView === 'pos') {
      setUserRole('cashier');
      fetchPOSCatalogData();
    }
  };

  // Backoffice PIN Verification & Setup Handlers
  const handleBackofficeClick = () => {
    if (import.meta.env.VITE_APP_MODE === 'pos') {
      showNotification(isArabic ? "الوصول مرفوض: تم تعطيل لوحة الإدارة في هذا النطاق" : "Access denied: Admin backoffice is disabled on this domain", "error");
      return;
    }
    const now = Date.now();
    const cooldown = localStorage.getItem('backoffice_cooldown');
    if (cooldown && now < parseInt(cooldown)) {
      const minutesLeft = Math.ceil((parseInt(cooldown) - now) / 60000);
      showNotification(isArabic ? `يرجى الانتظار ${minutesLeft} دقائق قبل المحاولة مرة أخرى` : `Please wait ${minutesLeft} minutes before trying again`, "error");
      return;
    }

    const savedPin = localStorage.getItem('backoffice_pin') || DEFAULT_PIN;
    setPinInput('');
    setConfirmInput('');
    setPinError('');
    setOtpInput('');
    setIsOtpRecovery(false);
    setIsOtpVerified(false);

    if (!savedPin) {
      setIsPinSetup(true);
      setIsPinModalOpen(true);
    } else {
      setIsPinSetup(false);
      setIsPinModalOpen(true);
    }
  };

  const handleVerifyPin = (input) => {
    const now = Date.now();
    const cooldown = localStorage.getItem('backoffice_cooldown');
    if (cooldown && now < parseInt(cooldown)) {
      const minutesLeft = Math.ceil((parseInt(cooldown) - now) / 60000);
      setPinError(isArabic ? `يرجى الانتظار ${minutesLeft} دقائق قبل المحاولة مرة أخرى` : `Please wait ${minutesLeft} minutes before trying again`);
      return;
    }

    const savedPin = localStorage.getItem('backoffice_pin') || DEFAULT_PIN;
    if (input === savedPin) {
      handleSetFailedAttempts(0);
      handleSetLockoutStage(0);
      setIsPinModalOpen(false);
      setView('admin');
      setUserRole('admin'); // elevate role to admin for the backoffice view
      showNotification(isArabic ? "تم التحقق من الرمز بنجاح! 🔑" : "PIN verified successfully! 🔑");
    } else {
      const newAttempts = failedAttempts + 1;
      handleSetFailedAttempts(newAttempts);
      setPinInput('');

      if (newAttempts >= 3) {
        const nextStage = lockoutStage + 1;
        handleSetLockoutStage(nextStage);

        let cooldownMs = 180000; // 3 mins (default/Stage 1)
        let cooldownMinutes = 3;

        if (nextStage === 2) {
          cooldownMs = 300000; // 5 mins
          cooldownMinutes = 5;
        } else if (nextStage >= 3) {
          cooldownMs = 600000; // 10 mins
          cooldownMinutes = 10;
        }

        const cooldownTime = Date.now() + cooldownMs;
        localStorage.setItem('backoffice_cooldown', cooldownTime.toString());
        handleSetFailedAttempts(0); // Reset attempts counter for the next lockout cycle

        setPinError(isArabic ? `يرجى الانتظار ${cooldownMinutes} دقائق قبل المحاولة مرة أخرى` : `Please wait ${cooldownMinutes} minutes before trying again`);
        setTimeout(() => {
          setIsPinModalOpen(false);
        }, 3000);
      } else {
        setPinError(isArabic ? `رمز PIN غير صحيح! المحاولات المتبقية: ${3 - newAttempts}` : `Incorrect PIN! Attempts left: ${3 - newAttempts}`);
      }
    }
  };

  const handleSaveSetupPin = () => {
    if (pinInput.length !== 4 || confirmInput.length !== 4) {
      setPinError(isArabic ? "يجب أن يتكون رمز PIN من 4 أرقام" : "PIN must be exactly 4 digits");
      return;
    }
    if (pinInput !== confirmInput) {
      setPinError(isArabic ? "الرمزان غير متطابقين! أعد المحاولة" : "PINs do not match! Try again");
      setConfirmInput('');
      return;
    }
    localStorage.setItem('backoffice_pin', pinInput);
    setIsPinModalOpen(false);
    setView('admin');
    showNotification(isArabic ? "تم إعداد رمز PIN وحفظه بنجاح! 🔒" : "PIN set and saved successfully! 🔒");
  };

  const handleForgotPassword = () => {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(otp);
    setIsOtpRecovery(true);
    setOtpInput('');
    setPinError('');

    const ownerEmail = session?.user?.email || "owner@belburger.com";
    showNotification(isArabic ? "تم إرسال رمز التحقق إلى إيميل المالك" : "Verification code sent to owner's email", "info");
    console.log(`[Backoffice Recovery OTP]: ${otp}`);
    // alert removed
  };

  const handleVerifyOtp = (input) => {
    if (input === generatedOtp) {
      setIsOtpVerified(true);
      setIsPinSetup(true);
      setPinInput('');
      setConfirmInput('');
      setPinError('');
      showNotification(isArabic ? "تم التحقق من الرمز! يرجى إدخال رمز PIN جديد" : "OTP verified! Please set a new PIN", "success");
    } else {
      setOtpInput('');
      setPinError(isArabic ? "رمز OTP غير صحيح! أعد المحاولة" : "Invalid OTP! Try again");
    }
  };

  const handleNumPadPress = (num) => {
    setPinError('');
    if (isOtpRecovery && !isOtpVerified) {
      if (otpInput.length < 6) {
        const newInput = otpInput + num;
        setOtpInput(newInput);
        if (newInput.length === 6) {
          handleVerifyOtp(newInput);
        }
      }
    } else if (isPinSetup) {
      if (pinInput.length < 4) {
        setPinInput(prev => prev + num);
      } else if (confirmInput.length < 4) {
        setConfirmInput(prev => prev + num);
      }
    } else {
      if (pinInput.length < 4) {
        const newInput = pinInput + num;
        setPinInput(newInput);
        if (newInput.length === 4) {
          handleVerifyPin(newInput);
        }
      }
    }
  };

  const handleNumPadDelete = () => {
    setPinError('');
    if (isOtpRecovery && !isOtpVerified) {
      setOtpInput(prev => prev.slice(0, -1));
    } else if (isPinSetup) {
      if (confirmInput.length > 0) {
        setConfirmInput(prev => prev.slice(0, -1));
      } else {
        setPinInput(prev => prev.slice(0, -1));
      }
    } else {
      setPinInput(prev => prev.slice(0, -1));
    }
  };

  const handleNumPadClear = () => {
    setPinError('');
    if (isOtpRecovery && !isOtpVerified) {
      setOtpInput('');
    } else if (isPinSetup) {
      setPinInput('');
      setConfirmInput('');
    } else {
      setPinInput('');
    }
  };

  const handleOpenCashierSession = async (e) => {
    e.preventDefault();
    if (!cashierNameInput.trim()) {
      setSetupError(isArabic ? 'الرجاء إدخال اسم الكاشير' : 'Please enter cashier name');
      return;
    }

    try {
      setSetupLoading(true);
      setSetupError('');

      const deviceId = deviceAuth?.deviceId || localStorage.getItem('device_id');
      const deviceToken = localStorage.getItem('device_token');

      const { data: res, error } = await supabase.rpc('open_cashier_shift', {
        p_device_id: deviceId,
        p_device_token: deviceToken || null,
        p_cashier_name: cashierNameInput.trim(),
        p_opening_balance: parseFloat(openingBalanceInput) || 0.00,
        p_cashier_user_id: session?.user?.id || null
      });

      if (error) throw error;
      if (!res?.success) {
        throw new Error(res?.error || (isArabic ? 'فشل فتح الوردية.' : 'Error opening cashier session.'));
      }

      // Save to localStorage
      localStorage.setItem('cashier_session_id', res.session_id);
      localStorage.setItem('cashier_name', cashierNameInput.trim());
      localStorage.setItem('cashier_opening_balance', parseFloat(openingBalanceInput || 0).toFixed(2));
      localStorage.setItem('cashier_pin', '0000');

      // Set state
      setActiveCashierSession({
        id: res.session_id,
        cashierName: cashierNameInput.trim(),
        openingBalance: parseFloat(openingBalanceInput || 0)
      });
      setCashierPin('0000');
      showNotification(isArabic ? "تم فتح وردية الكاشير بنجاح! 🟢" : "Cashier shift opened successfully! 🟢");
    } catch (err) {
      console.error("Error opening cashier session:", err);
      setSetupError(err.message || (isArabic ? 'خطأ في فتح الوردية.' : 'Error opening cashier session.'));
    } finally {
      setSetupLoading(false);
    }
  };

  const renderCashierSessionSetup = () => {
    return (
      <div dir={isArabic ? "rtl" : "ltr"} className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 px-4 font-sans select-none relative">
        {/* Language Toggle */}
        <div className={`absolute top-6 ${isArabic ? 'left-6' : 'right-6'}`}>
          <button
            type="button"
            onClick={() => setIsArabic(!isArabic)}
            className="text-xs font-extrabold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <span>{isArabic ? "English (LTR)" : "العربية (RTL)"}</span>
          </button>
        </div>

        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-8 space-y-6">

          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center px-6 py-2 rounded-2xl bg-amber-500 text-white font-extrabold tracking-wider text-lg font-sans shadow-lg shadow-amber-500/25">
              {store?.name || 'Belburger'}
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {isArabic ? "بدء وردية جديدة" : "Open New Shift"}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isArabic ? "يرجى تعبئة بيانات الكاشير لبدء العمل على الكاونتر" : "Please fill in cashier details to start selling"}
            </p>
          </div>

          {/* Error Alert */}
          {setupError && (
            <div className="bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-450 px-4 py-3 rounded-xl border border-rose-100 dark:border-rose-900/50 text-sm font-semibold text-center flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{setupError}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleOpenCashierSession} className="space-y-4">

            <div className="space-y-1.5 text-right">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mr-1">
                {isArabic ? "اسم الكاشير" : "Cashier Name"}
              </label>
              <input
                type="text"
                value={cashierNameInput}
                onChange={(e) => setCashierNameInput(e.target.value)}
                placeholder={isArabic ? "أدخل اسمك" : "Enter your name"}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:border-amber-500 transition-all font-semibold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500"
                required
                disabled={setupLoading}
              />
            </div>

            <div className="space-y-1.5 text-right">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase block mr-1">
                {isArabic ? "نسبة الزحمة في المحل" : "Store Busy Level"}
              </label>
              <select
                value={busyLevelInput}
                onChange={(e) => setBusyLevelInput(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:border-amber-500 transition-all font-semibold text-slate-900 dark:text-white"
                required
                disabled={setupLoading}
              >
                <option value="low">{isArabic ? "هادئ" : "Low"}</option>
                <option value="medium">{isArabic ? "متوسط" : "Medium"}</option>
                <option value="high">{isArabic ? "مزدحم جداً" : "High"}</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={setupLoading}
              className={`w-full py-3.5 rounded-xl font-bold text-base text-white transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer ${setupLoading
                ? 'bg-slate-350 dark:bg-slate-800 shadow-none cursor-wait'
                : 'bg-amber-500 hover:bg-amber-600 active:scale-[0.99] shadow-amber-500/20'
                }`}
            >
              {setupLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                isArabic ? 'فتح الوردية وبدء البيع' : 'Open Shift & Start POS'
              )}
            </button>

          </form>

          {/* Revoke/Logout button */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={handleRevokeLogout}
              className="text-xs font-bold text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-450 transition-colors"
            >
              {isArabic ? "إلغاء تنشيط هذا الجهاز" : "Deactivate this device"}
            </button>
          </div>

        </div>
      </div>
    );
  };

  // Render Remote Blocking Overlay if cashier device is disabled or revoked by management
  if (isDeviceBlocked) {
    return (
      <div dir={isArabic ? "rtl" : "ltr"} className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center select-none fixed inset-0 z-[99999]">
        <div className="p-5 bg-rose-500/20 rounded-2xl border border-rose-500/40 mb-6 animate-pulse">
          <Lock className="w-14 h-14 text-rose-500 mx-auto" />
        </div>
        <h1 className="text-2xl font-black mb-3 text-rose-400">
          {isArabic ? "تم إيقاف جهاز الكاشير من الإدارة" : "This cashier device has been disabled by management"}
        </h1>
        <p className="text-sm text-slate-300 max-w-md leading-relaxed font-medium">
          {isArabic
            ? "تم تعليق هذا الجهاز مؤقتاً بواسطة مدير النظام. يرجى التواصل مع الإدارة لإعادة تفعيل الجهاز."
            : "This device has been temporarily suspended by system management. Please contact administration to restore access."
          }
        </p>
      </div>
    );
  }

  // Render Maintenance Screen if enabled and user is not admin
  if (isUnderMaintenance) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-center p-6 text-slate-100 font-sans select-none">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center shadow-xl animate-pulse mb-6">
          <Shield className="w-8 h-8" />
        </div>
        <h2 className="text-3xl font-black tracking-tight mb-2">
          {isArabic ? "النظام قيد الصيانة" : "System Under Maintenance"}
        </h2>
        <p className="text-slate-400 text-sm max-w-sm mb-6">
          {isArabic
            ? "يخضع النظام لعملية صيانة مجدولة لتحسين الأداء والأمان. يرجى معاودة المحاولة لاحقاً."
            : "The system is currently undergoing scheduled maintenance to improve performance and security. Please check back later."}
        </p>
        <div className="text-xs text-slate-500 border-t border-slate-800 pt-4 w-full max-w-xs font-mono uppercase tracking-wider">
          Cashmint POS Platform
        </div>
      </div>
    );
  }

  // Master or Store Mode Conditional Return
  if (isMasterHost || isStoreMode) {
    if (loadingSession || isCheckingStore) {
      return (
        <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 font-sans">
          <div className="text-center space-y-4">
            <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto" />
            <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
              {isArabic ? "جاري التحقق من الهوية..." : "Verifying identity..."}
            </p>
          </div>
        </div>
      );
    }

    if (!session) {
      if (isMasterHost && !showMasterLogin) {
        return (
          <React.Suspense fallback={
            <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
            </div>
          }>
            <LandingPage onLoginClick={() => setShowMasterLogin(true)} />
          </React.Suspense>
        );
      }
      return <BackOfficeLogin onBackToLanding={() => setShowMasterLogin(false)} />;
    }

    // Force onboarding if the store is unconfigured or null (unless it's the master host)
    if (!isMasterHost && !isStoreOnboarded(store)) {
      return (
        <React.Suspense fallback={
          <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
          </div>
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
              setUserRole('admin');
              if (updatedStore) {
                localStorage.setItem('store_id', updatedStore.id);
                localStorage.setItem('current_store_name', updatedStore.name || '');
                localStorage.setItem('current_store_logo', updatedStore.logo_url || '');
              }
              fetchPOSCatalogData(updatedStore);
            }}
          />
        </React.Suspense>
      );
    }

    if (isMasterHost) {
      return (
        <React.Suspense fallback={
          <div className="min-h-screen bg-slate-955 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        }>
          <SuperAdminDashboard session={session} setView={setView} />
        </React.Suspense>
      );
    }
    return (
      <StoreThemeProvider store={store}><AdminDashboard
        store={store}
        setStore={setStore}
        session={session}
        setView={handleSetView}
        showNotification={showNotification}
        isArabic={isArabic}
        setIsArabic={setIsArabic}
        theme={theme}
        setTheme={setTheme}
      /></StoreThemeProvider>
    );
  }

  // Render Loading Screen
  if (loadingSession) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 font-sans">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
            {isArabic ? "جاري التحقق من الهوية..." : "Verifying identity..."}
          </p>
        </div>
      </div>
    );
  }

  // Render Login Screen if device is not authenticated
  if (!deviceAuth) {
    return (
      <Login
        isArabic={isArabic}
        setIsArabic={setIsArabic}
        onLoginSuccess={(devId, stId) => {
          // Force a completely fresh start by clearing cashier and shift-related data
          const keysToClear = [
            'cashier_session_id', 'active_shift_id', 'cashier_name',
            'cashier_opening_balance', 'cashier_pin', 'pin',
            'lockout_stage', 'failed_attempts', 'lockout_until'
          ];
          keysToClear.forEach(k => localStorage.removeItem(k));
          setActiveCashierSession(null);
          setCashierPin('');
          setDeviceAuth({ deviceId: devId, storeId: stId });
        }}
      />
    );
  }



  // Render Loading Screen while checking store mapping (to prevent flickering)
  if (isCheckingStore) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-955 font-sans">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
            {isArabic ? "جاري تحميل بيانات المتجر..." : "Loading store profile..."}
          </p>
        </div>
      </div>
    );
  }



  // Render Onboarding Wizard if store profile is incomplete (strictly blocking POS access)
  if (!isStoreOnboarded(store)) {
    return (
      <React.Suspense fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
        </div>
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
            setUserRole('admin');
            if (updatedStore) {
              localStorage.setItem('store_id', updatedStore.id);
              localStorage.setItem('current_store_name', updatedStore.name || '');
              localStorage.setItem('current_store_logo', updatedStore.logo_url || '');
            }
            fetchPOSCatalogData(updatedStore);
          }}
        />
      </React.Suspense>
    );
  }

  // Render Cashier Session Setup if device is active but no cashier session is open
  if (!activeCashierSession) {
    return renderCashierSessionSetup();
  }

  // Render Admin Dashboard if view is admin and user is authorized (completely disabled in POS mode)
  if (import.meta.env.VITE_APP_MODE !== 'pos' && view === 'admin' && userRole === 'admin') {
    return (
      <StoreThemeProvider store={store}><AdminDashboard
        store={store}
        setStore={setStore}
        session={session || { user: { email: localStorage.getItem('device_name') || 'device-pos@cashmint.net' } }}
        setView={handleSetView}
        showNotification={showNotification}
        isArabic={isArabic}
        setIsArabic={setIsArabic}
        theme={theme}
        setTheme={setTheme}
      /></StoreThemeProvider>
    );
  }

  // Find active category name for icon lookup
  const activeCategoryName = categories.find(c => c.id === selectedCategoryId)?.name || '';

  // Render POS Interface when authenticated
  return (
    <div dir={isArabic ? "rtl" : "ltr"} className="flex flex-col h-screen bg-slate-50 dark:bg-slate-955 text-slate-800 dark:text-slate-100 antialiased font-sans select-none pos-pwa-container pos-touch-nohighlight">

      {/* iPad PWA Installation Banner */}
      {isPosMode && <IpadInstallGuide />}

      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-xl transition-all duration-300 flex items-center gap-2 text-white font-medium ${notification.type === 'error' ? 'bg-rose-500' : notification.type === 'info' ? 'bg-blue-500' : 'bg-emerald-500'
          }`}>
          <span>{notification.message}</span>
        </div>
      )}

      {/* POS Top Header */}
      <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">

        {/* Left Side: Brand Logo and Title */}
        <div className="flex items-center gap-3">
          {store?.logo_url || localStorage.getItem("current_store_logo") ? (
            <img
              src={store?.logo_url || localStorage.getItem("current_store_logo")}
              alt={store ? store.name : 'Store Logo'}
              className="w-10 h-10 rounded-xl object-contain shadow-md shrink-0 border border-slate-150 dark:border-slate-700 bg-white"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-650 flex items-center justify-center text-white font-black text-xl shadow-md shrink-0">
              {store?.name ? store.name.trim().charAt(0).toUpperCase() : '?'}
            </div>
          )}

          {/* Sleek Gear Icon button directly next to logo */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750 transition-all duration-150 active:scale-95 flex items-center justify-center cursor-pointer shrink-0"
            title={isArabic ? "إعدادات الكاشير" : "Cashier Settings"}
          >
            <Settings className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight leading-none">
              {store?.name || 'POS System'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                {store ? (store.business_type === 'restaurant' ? t('beef_burgers') : store.business_type) : t('main_branch')}
              </span>
              <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
              <div className="flex items-center gap-1 text-[10px] font-bold">
                <Wifi className={`w-3.5 h-3.5 ${isOnline ? 'text-emerald-500' : 'text-rose-500'}`} />
                <span className="text-slate-500 dark:text-slate-400">{isOnline ? t('connected') : t('disconnected')}</span>
                {isOnline && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Cashier, Real-time clock, Logout */}
        <div className="flex items-center gap-5">
          {/* Digital Clock */}
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 bg-slate-550/10 dark:bg-slate-900 px-3.5 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 font-bold text-xs">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{currentTime}</span>
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Static Staff Profile Widget */}
          <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 px-3.5 py-1.5 rounded-xl select-none shrink-0">
            <User className="w-4 h-4 text-slate-450 dark:text-slate-400" />
            <div className="text-right">
              <p className="text-xs font-black text-slate-800 dark:text-slate-200 leading-none">
                {activeCashierSession?.cashierName || t('active_cashier')}
              </p>
              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-1">
                {isArabic ? "كاشير" : "Cashier"}
              </p>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Language Toggle Button */}
          <button
            onClick={() => setIsArabic(!isArabic)}
            className="px-3 py-1.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750 transition-all duration-150 active:scale-95 flex items-center gap-1.5 font-bold text-xs shrink-0"
            title={isArabic ? "Switch to English" : "التحويل للغة العربية"}
          >
            <Globe className="w-4 h-4 text-slate-500" />
            <span>{isArabic ? 'EN' : 'عربي'}</span>
          </button>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Theme Toggle Button */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="p-2 rounded-xl text-slate-555 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-750 transition-all duration-150 active:scale-95 flex items-center justify-center"
            title={theme === 'light' ? "تفعيل الوضع الداكن" : "تفعيل الوضع المضيء"}
          >
            {theme === 'light' ? <Moon className="w-5 h-5 text-slate-500" /> : <Sun className="w-5 h-5 text-amber-400" />}
          </button>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Backoffice Button (completely disabled in POS mode) */}
          {import.meta.env.VITE_APP_MODE !== 'pos' && (
            <button
              onClick={handleBackofficeClick}
              className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 px-3 py-2 rounded-xl hover:bg-amber-50/50 dark:hover:bg-slate-750/50 transition-all duration-150 active:scale-95 flex items-center gap-1.5"
            >
              <Sliders className="w-4 h-4" />
              <span>{t('backoffice')}</span>
            </button>
          )}

          {import.meta.env.VITE_APP_MODE !== 'pos' && <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />}

          {/* Handover / End Shift Button (Ghost Button Style) */}
          <button
            onClick={() => setLogoutConfirmOpen(true)}
            className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 px-3 py-2 rounded-xl hover:bg-amber-50 dark:hover:bg-slate-750 transition-all duration-150 active:scale-95 flex items-center gap-1.5 cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            <span>{isArabic ? "تسليم الوردية" : "End Shift"}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden">

        {/* Products and Categories Area (75%) */}
        <section className="w-[75%] flex flex-row overflow-hidden border-l border-slate-100 dark:border-slate-800">

          {/* Vertical Categories Sidebar (Right in RTL) */}
          <aside className="w-52 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700 flex flex-col shrink-0 overflow-y-auto no-scrollbar">
            {/* Categories Title */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-550/50 dark:bg-slate-900/30 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('categories')}</h3>
              <span className="text-[10px] font-black bg-slate-100 dark:bg-slate-900 text-slate-500 px-2 py-0.5 rounded-full">
                {categories.length}
              </span>
            </div>
            <div className="p-3 flex flex-col gap-2 shrink-0">
              {loadingData ? (
                [1, 2, 3, 4, 5, 6].map(n => (
                  <div key={n} className="h-14 rounded-xl bg-slate-50 dark:bg-slate-900 animate-pulse border border-slate-100 dark:border-slate-700" />
                ))
              ) : (
                categories.map(cat => {
                  const isActive = selectedCategoryId === cat.id;
                  const hasAr = Boolean(cat.name_ar && cat.name_ar.trim());
                  const displayName = isArabic ? (hasAr ? cat.name_ar.trim() : cat.name) : cat.name;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={`w-full min-h-[56px] px-4 py-3 rounded-xl font-bold text-base transition-all duration-150 flex items-center gap-3 text-right select-none active:scale-[0.98] border ${isActive
                        ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/15 font-extrabold'
                        : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-transparent hover:bg-slate-200 dark:hover:bg-slate-750/80'
                        }`}
                    >
                      <span className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                        {getCategoryIcon(cat.name)}
                      </span>
                      <span className="truncate flex-1 font-bold text-right text-sm leading-tight">
                        {displayName}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Product Grid Area (Center in RTL) */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Products Grid */}
            <div className="flex-1 overflow-y-auto p-5 bg-slate-50/50 dark:bg-slate-900 no-scrollbar">
              {loadingData ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                    <div key={n} className="bg-white dark:bg-slate-800 rounded-xl p-4 h-32 border border-slate-100 dark:border-slate-700 flex flex-col justify-between shadow-sm animate-pulse">
                      <div className="h-4 w-2/3 bg-slate-100 dark:bg-slate-700 rounded mx-auto" />
                      <div className="h-4 w-1/3 bg-slate-100 dark:bg-slate-700 rounded mx-auto" />
                    </div>
                  ))}
                </div>
              ) : (categories.length === 0 && products.length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-white dark:bg-slate-800 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 m-5">
                  <div className="p-4 bg-amber-50 dark:bg-amber-955/20 rounded-full text-amber-500 mb-4 animate-bounce shrink-0">
                    <ShoppingBag className="w-12 h-12" />
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-850 dark:text-white mb-2 leading-none">
                    {isArabic
                      ? "لا توجد أقسام أو منتجات في هذا المتجر بعد"
                      : "No categories or products in this store yet"}
                  </h3>
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 max-w-sm mb-6 leading-relaxed">
                    {isArabic
                      ? "لا توجد أقسام أو منتجات في هذا المتجر بعد. اذهب إلى لوحة التحكم لإضافة منتجاتك الأولى!"
                      : "There are no categories or products in this store yet. Go to the dashboard to add your first products!"}
                  </p>
                  {userRole === 'admin' && import.meta.env.VITE_APP_MODE !== 'pos' && (
                    <button
                      onClick={() => setView('admin')}
                      className="px-5 py-3 bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white rounded-xl font-bold text-xs shadow-md shadow-amber-500/10 transition-all flex items-center gap-2 cursor-pointer"
                    >
                      <Sliders className="w-4 h-4" />
                      <span>{isArabic ? "الذهاب إلى لوحة التحكم" : "Go to Dashboard"}</span>
                    </button>
                  )}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <Utensils className="w-12 h-12 mb-2 text-slate-300 dark:text-slate-655" />
                  <p className="text-sm font-bold">{t('no_products')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredProducts.map(product => {
                    const hasMods = modifiers.some(m => m.product_id === product.id);
                    const productCategoryName = activeCategoryName || categories.find(c => c.id === product.category_id)?.name || '';
                    const catStyles = getProductCategoryStyles(productCategoryName);

                    const isCompact = productCardSize === 'compact';
                    const hasArabic = Boolean(product.name_ar && product.name_ar.trim());

                    const mainTitle = (isArabic && hasArabic) ? product.name_ar.trim() : product.name;
                    const subTitle = (isArabic && hasArabic) ? product.name : (hasArabic ? product.name_ar.trim() : null);

                    return (
                      <button
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        className={`border rounded-2xl cursor-pointer active:scale-[0.97] transition-all flex flex-col items-center justify-center text-center relative select-none ${isCompact ? 'h-24 p-2.5' : 'h-32 p-4'
                          } ${catStyles.border} ${catStyles.bg}`}
                      >
                        <span className={`text-slate-850 dark:text-white leading-snug line-clamp-1 px-1 ${isCompact ? 'text-xs md:text-sm font-bold' : 'font-extrabold text-base md:text-lg'
                          }`}>
                          {mainTitle}
                        </span>
                        {subTitle && (
                          <span className={`text-amber-600 dark:text-amber-400 font-semibold line-clamp-1 opacity-90 px-1 ${isCompact ? 'text-[10px]' : 'text-xs mt-0.5'
                            }`}>
                            {subTitle}
                          </span>
                        )}
                        <span className={`font-black ${catStyles.accent} ${isCompact ? 'text-sm mt-0.5' : 'text-base mt-1'
                          }`}>
                          {parseFloat(product.price).toFixed(2)} €
                        </span>
                        {hasMods && (
                          <span className="absolute top-3 left-3 w-2.5 h-2.5 rounded-full bg-amber-500" title={t('contains_extras')} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </section>

        {/* Sidebar Cart Area (25%) */}
        <section className="w-[25%] bg-white dark:bg-slate-800 flex flex-col overflow-hidden border-r border-slate-100 dark:border-slate-700">

          {/* Cart Header */}
          <div className="h-16 border-b border-slate-100 dark:border-slate-700 px-5 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
            <h2 className="font-bold text-slate-800 dark:text-slate-200 text-sm flex items-center gap-2 leading-none">
              <span>{t('cart_details')}</span>
              <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 text-xs px-2 py-0.5 rounded-full font-bold">
                {cart.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            </h2>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-rose-500 font-bold hover:underline"
              >
                {t('clear_all')}
              </button>
            )}
          </div>

          {/* Order type determines the configured tax profile. */}
          <div className="p-3 border-b border-slate-100 dark:border-slate-700 shrink-0 bg-slate-550/10 dark:bg-slate-900/40">
            <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl flex gap-1">
              <button
                onClick={() => setOrderType('dine_in')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${orderType === 'dine_in'
                  ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-250'
                  }`}
              >
                <Home className="w-3.5 h-3.5" />
                <span>{t('dine_in')}</span>
              </button>
              <button
                onClick={() => setOrderType('takeaway')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${orderType === 'takeaway'
                  ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-250'
                  }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>{t('takeaway')}</span>
              </button>
            </div>
          </div>

          {/* Cart items list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-center p-4">
                <ShoppingBag className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-xs font-bold">{t('empty_cart')}</p>
              </div>
            ) : (
              cart.map((item, index) => {
                const modsCost = item.selectedModifiers.reduce((s, m) => s + parseFloat(m.price_adjustment), 0);
                const itemTotal = (parseFloat(item.product.price) + modsCost) * item.quantity;
                const componentRates = bundleComponents.filter(component => component.bundle_product_id === item.product.id)
                  .map(component => resolvedTaxRates[component.component_product_id]).filter(rate => rate !== undefined);
                const taxRates = componentRates.length ? [...new Set(componentRates)] : [accounting.lines[index]?.vatRate || 0];

                return (
                  <div
                    key={item.id}
                    className="bg-slate-50/60 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800/80 p-3.5 rounded-2xl flex flex-col gap-2.5 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5 flex-1 text-right">
                        <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-200">
                          {item.product.name}
                        </h4>
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          {parseFloat(item.product.price).toFixed(2)} €
                        </span>
                        <span className="ms-2 text-[10px] font-black text-amber-600 dark:text-amber-400">
                          {isArabic ? `ضريبة ${taxRates.map(rate => `${Number(rate).toFixed(0)}%`).join(' + ')}` : `VAT ${taxRates.map(rate => `${Number(rate).toFixed(0)}%`).join(' + ')}`}
                        </span>
                      </div>
                      <span className="text-xs font-black text-slate-750 dark:text-slate-250">
                        {itemTotal.toFixed(2)} €
                      </span>
                    </div>

                    {/* Render Selected Modifiers List */}
                    {item.selectedModifiers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.selectedModifiers.map(mod => (
                          <span
                            key={mod.id}
                            className="text-[9px] font-black text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/60 px-2 py-0.5 rounded border border-transparent dark:border-slate-800"
                          >
                            + {mod.name}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-slate-100/60 dark:border-slate-800/60 pt-2.5">
                      <button
                        onClick={() => setCart(cart.filter(i => i.id !== item.id))}
                        className="text-[10px] text-rose-500 font-bold hover:underline flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{t('remove')}</span>
                      </button>

                      {/* Quantity Controls */}
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => updateQuantity(item.id, -1)}
                          className="w-6.5 h-6.5 rounded-lg bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-750 active:scale-90"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-black text-slate-800 dark:text-slate-100 min-w-4 text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, 1)}
                          className="w-6.5 h-6.5 rounded-lg bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-750 active:scale-90"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Receipt Summary and Actions */}
          <div className="p-4 bg-slate-50/70 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800 space-y-3">
            {/* Promo Code (Coupon) Section */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3 mb-2 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={isArabic ? "كود الخصم" : "Promo Code"}
                  value={couponCodeInput}
                  onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                  disabled={cart.length === 0 || isValidatingCoupon || !!appliedCoupon}
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {appliedCoupon ? (
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
                    className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition-all duration-150 active:scale-[0.98]"
                  >
                    {isArabic ? "إزالة" : "Remove"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleApplyCoupon}
                    disabled={cart.length === 0 || isValidatingCoupon || !couponCodeInput.trim()}
                    className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.98]"
                  >
                    {isValidatingCoupon ? (isArabic ? "جاري..." : "Verifying...") : (isArabic ? "تطبيق" : "Apply")}
                  </button>
                )}
              </div>

              {couponError && (
                <p className="text-[11px] font-bold text-rose-500 text-right px-1">
                  {couponError}
                </p>
              )}
              {couponSuccessMessage && (
                <p className="text-[11px] font-bold text-emerald-500 text-right px-1">
                  {couponSuccessMessage}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-bold text-slate-500 dark:text-slate-400">{isArabic ? 'سعر الأكل قبل الضريبة' : 'Food price before tax'}</span>
                <span className="font-extrabold text-slate-700 dark:text-slate-355">{accountingBeforeDiscount.totals.net.toFixed(2)} €</span>
              </div>
              {appliedCoupon && (
                <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                  <span>{isArabic ? `الخصم (${appliedCoupon.code})` : `Discount (${appliedCoupon.code})`}</span>
                  <span>-{netDiscountAmount.toFixed(2)} €</span>
                </div>
              )}
              {Object.entries(taxBreakdown).map(([rate, values]) => (
                <div className="flex justify-between text-xs" key={rate}>
                  <span className="font-bold text-slate-500 dark:text-slate-400">{isArabic ? `ضريبة ${Number(rate).toFixed(0)}%` : `VAT ${Number(rate).toFixed(0)}%`}</span>
                  <span className="font-extrabold text-slate-700 dark:text-slate-355">{values.vat.toFixed(2)} €</span>
                </div>
              ))}
              <div className="flex justify-between text-sm border-t border-slate-200/50 dark:border-slate-800/80 pt-2 font-black">
                <span className="text-slate-800 dark:text-slate-200">{t('total')}</span>
                <span className="text-slate-950 dark:text-white text-base">{totalAmount.toFixed(2)} €</span>
              </div>
            </div>

            {/* Payment Selector */}
            <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl flex gap-1 mb-2">
              <button
                onClick={() => setPaymentMethod('cash')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${paymentMethod === 'cash'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-slate-555 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-250'
                  }`}
              >
                {t('dine_in') === 'صالة' ? 'نقداً' : 'Cash'}
              </button>
              <button
                onClick={() => setPaymentMethod('card')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${paymentMethod === 'card'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-slate-555 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-250'} ${terminalAvailability.checked && !terminalAvailability.available ? 'opacity-70'
                    : ''
                  }`}
              >
                {t('dine_in') === 'صالة' ? 'بطاقة / فيزا' : 'Card / Visa'}
              </button>
              {store?.split_payment_enabled && (
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('split');
                    const fifty = calculateFiftyFiftySplit(totalAmount);
                    setSplitCashInput(fifty.cashAmount);
                    setSplitCardInput(fifty.cardAmount);
                    setShowSplitModal(true);
                  }}
                  className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${paymentMethod === 'split'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-slate-555 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-250'
                    }`}
                >
                  {isArabic ? 'دفع مجزأ' : 'Split Payment'}
                </button>
              )}
            </div>

            {/* Primary Checkout Button */}
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className={`w-full py-3.5 rounded-xl font-bold text-xs transition-all shadow-md flex items-center justify-center gap-2 ${cart.length > 0
                ? 'bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-650 dark:hover:bg-emerald-700 active:scale-[0.99] text-white shadow-emerald-500/10'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-655 cursor-not-allowed shadow-none'
                }`}
            >
              <span>{paymentMethod === 'cash' ? t('pay_cash') : t('pay_card')}</span>
            </button>
          </div>

        </section>
      </main>

      {/* Modifiers Modal */}
      {activeProduct && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-750 flex flex-col max-h-[80vh]">

            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
              <div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-200">{t('edit_meal')}</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{activeProduct.name}</p>
              </div>
              <button
                onClick={() => setActiveProduct(null)}
                className="w-7 h-7 rounded-full bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 text-xs hover:bg-slate-100 dark:hover:bg-slate-750 active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-wide uppercase">{t('available_extras')}</p>
              <div className="space-y-2">
                {modifiers
                  .filter(m => m.product_id === activeProduct.id)
                  .map(mod => {
                    const isSelected = selectedModifiers.includes(mod.id);
                    return (
                      <div
                        key={mod.id}
                        onClick={() => handleToggleModifier(mod.id)}
                        className={`p-3 border rounded-xl cursor-pointer flex items-center justify-between transition-all duration-150 ${isSelected
                          ? 'border-amber-400 bg-amber-50/20 dark:border-amber-500 dark:bg-amber-955/25'
                          : 'border-slate-150 dark:border-slate-700/60 hover:border-slate-350 dark:hover:border-slate-600'
                          }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isSelected
                            ? 'border-amber-500 bg-amber-500 text-white'
                            : 'border-slate-300 dark:border-slate-650 bg-white dark:bg-slate-900'
                            }`}>
                            {isSelected && <Check className="w-2.5 h-2.5" />}
                          </div>
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{mod.name}</span>
                        </div>
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                          + {parseFloat(mod.price_adjustment).toFixed(2)} €
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex gap-3 shrink-0">
              <button
                onClick={handleConfirmModifiers}
                className="flex-1 bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white py-2.5 rounded-xl font-bold text-xs shadow-sm transition-all"
              >
                {t('add_to_cart')}
              </button>
              <button
                onClick={() => setActiveProduct(null)}
                className="px-5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-355 py-2.5 rounded-xl font-bold text-xs active:scale-[0.99] transition-all"
              >
                {t('cancel')}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Provider-neutral card terminal modal */}
      {showStripeModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 border border-slate-100 dark:border-slate-700 space-y-6 text-center">
            <div className="flex justify-center">
              <div className={`p-3 rounded-2xl ${terminalRecovery ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-500' : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 animate-pulse'}`}>
                <CreditCard className="w-8 h-8" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-extrabold text-lg text-slate-800 dark:text-white">
                {terminalRecovery?.status === 'cancelled'
                  ? 'Payment cancelled'
                    : terminalRecovery
                      ? 'Card payment failed'
                      : stripeStatus === 'verifying_card'
                        ? 'Verifying card payment...'
                      : stripeStatus === 'succeeded'
                      ? 'Payment Confirmed'
                      : stripeStatus === 'failed'
                        ? 'Payment Failed'
                        : activePaymentProvider === 'stripe_server_driven' ? 'Waiting for customer' : 'Connecting to Card Reader...'}
              </h3>
              <p className="text-xs text-slate-400 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                {terminalRecovery
                  ? (terminalRecovery.message || (terminalRecovery.status === 'cancelled' ? 'The customer cancelled the card payment. The unpaid order is still available.' : 'The card payment did not complete.'))
                  : stripeStatus === 'succeeded'
                    ? 'Closing the payment window now.'
                    : stripeStatus === 'verifying_card'
                      ? 'WisePOS E reported a result. Confirming the exact Stripe PaymentIntent and split records before completing the order.'
                    : stripeStatus === 'failed'
                      ? 'You can retry the card or close this payment.'
                      : activePaymentProvider === 'stripe_server_driven'
                        ? 'Present card on the WisePOS E reader.'
                        : 'Stripe Terminal: Please tap, insert or swipe card on the BBPOS WisePad 3 reader.'}
              </p>
            </div>

            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-500">
              {(terminalRecovery?.status || stripeStatus).replaceAll('_', ' ')}
            </p>

            {terminalRecovery ? (
              <div className="flex flex-col gap-2.5 pt-2">
                <button
                  onClick={handleRetryPendingCard}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-xs cursor-pointer"
                >Retry card</button>
                <button
                  onClick={handlePayPendingOrderInCash}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs cursor-pointer"
                >Choose cash</button>
                <button
                  onClick={() => setShowStripeModal(false)}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-xl font-bold text-xs cursor-pointer"
                >Return to cart</button>
                <button
                  onClick={handleCancelPendingOrder}
                  className="w-full py-2.5 bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 rounded-xl font-bold text-xs cursor-pointer"
                >Cancel order</button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 pt-2">
                {stripeStatus === 'failed' && pendingTerminalOrder && (
                  <button
                    onClick={handleRetryPendingCard}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-xs cursor-pointer"
                  >Retry card</button>
                )}
                <button
                  onClick={async () => {
                    if (isCancellingPayment || !activePaymentRequestId) return;
                    setIsCancellingPayment(true);
                    try {
                      const { data, error } = await supabase.functions.invoke('cancel-terminal-payment', { body: { payment_request_id: activePaymentRequestId, ...terminalDeviceCredentials() } });
                      if (error) throw error;
                      showNotification(data?.status === 'cancelled' ? 'Payment cancellation confirmed.' : 'Card payment cancellation requested', 'info');
                    } catch (e) {
                      showNotification(e.message || 'Card payment cancellation failed', 'error');
                    } finally {
                      setIsCancellingPayment(false);
                    }
                  }}
                  aria-label={stripeStatus === 'failed' ? 'Close failed payment' : 'Cancel payment'}
                  disabled={isCancellingPayment || !activePaymentRequestId}
                  className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 disabled:opacity-60 dark:bg-slate-600 dark:hover:bg-slate-500 text-slate-900 dark:text-white rounded-xl font-bold text-xs active:scale-[0.99] transition-all cursor-pointer"
                >
                  {isCancellingPayment ? 'Cancelling payment...' : stripeStatus === 'failed' ? 'Close / Cancel Payment' : 'Cancel Payment'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/45 z-55 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col">

            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h3 
                  onClick={() => {
                    const next = secretTapCount + 1;
                    if (next >= 7) {
                      setDiagnosticsOpen(true);
                      setSecretTapCount(0);
                    } else {
                      setSecretTapCount(next);
                    }
                  }}
                  className="font-extrabold text-base text-slate-800 dark:text-white cursor-pointer select-none"
                  title="Tap 7 times to open Printing Diagnostics"
                >
                  {isArabic ? "إعدادات الكاشير" : "Cashier POS Settings"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-400 dark:text-slate-300 text-xs hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all cursor-pointer font-sans"
              >
                ✕
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-2 gap-1.5 shrink-0" dir={isArabic ? "rtl" : "ltr"}>
              <button
                type="button"
                onClick={() => {
                  setActiveSettingsTab('printer');
                  const next = secretTapCount + 1;
                  if (next >= 7) {
                    setDiagnosticsOpen(true);
                    setSecretTapCount(0);
                  } else {
                    setSecretTapCount(next);
                  }
                }}
                className={`flex-1 py-2 text-center text-xs font-bold rounded-xl transition-all cursor-pointer ${activeSettingsTab === 'printer'
                  ? 'bg-amber-500 text-white shadow-sm font-extrabold'
                  : 'text-slate-555 dark:text-slate-455 hover:bg-slate-100 dark:hover:bg-slate-750'
                  }`}
              >
                {isArabic ? "الطابعة" : "Printer"}
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('audio')}
                className={`flex-1 py-2 text-center text-xs font-bold rounded-xl transition-all cursor-pointer ${activeSettingsTab === 'audio'
                  ? 'bg-amber-500 text-white shadow-sm font-extrabold'
                  : 'text-slate-555 dark:text-slate-455 hover:bg-slate-100 dark:hover:bg-slate-750'
                  }`}
              >
                {isArabic ? "الأصوات والتنبيهات" : "Sound & Alerts"}
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('display')}
                className={`flex-1 py-2 text-center text-xs font-bold rounded-xl transition-all cursor-pointer ${activeSettingsTab === 'display'
                  ? 'bg-amber-500 text-white shadow-sm font-extrabold'
                  : 'text-slate-555 dark:text-slate-455 hover:bg-slate-100 dark:hover:bg-slate-750'
                  }`}
              >
                {isArabic ? "الشاشة والعرض" : "Display Settings"}
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-[220px]">
              {activeSettingsTab === 'printer' && (
                <div className="space-y-4">
                  {/* Master Auto Print Toggle */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-750">
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{isArabic ? "طباعة الفاتورة تلقائياً" : "Auto-Print Receipt"}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{isArabic ? "طباعة تذكرة الطلب بمجرد إكمال عملية الدفع" : "Send order to printer automatically on checkout"}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoPrintEnabled}
                        onChange={(e) => {
                          setAutoPrintEnabled(e.target.checked);
                          localStorage.setItem('auto_print_enabled', e.target.checked);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-500"></div>
                    </label>
                  </div>

                  {/* Auto Printing Outputs Checkboxes */}
                  {autoPrintEnabled && (
                    <div className="p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-750 space-y-2 text-right">
                      <p className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                        {isArabic ? "مخرجات الطباعة التلقائية (Auto Printing Outputs)" : "Auto Printing Outputs"}
                      </p>

                      <label className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "إيصال الكاشير" : "Auto print Cashier Receipt"}</span>
                        <input
                          type="checkbox"
                          checked={autoPrintCashier}
                          onChange={(e) => {
                            setAutoPrintCashier(e.target.checked);
                            localStorage.setItem('auto_print_cashier', e.target.checked);
                          }}
                          className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
                        />
                      </label>

                      <label className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "إيصال العميل" : "Auto print Customer Receipt"}</span>
                        <input
                          type="checkbox"
                          checked={autoPrintCustomer}
                          onChange={(e) => {
                            setAutoPrintCustomer(e.target.checked);
                            localStorage.setItem('auto_print_customer', e.target.checked);
                          }}
                          className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
                        />
                      </label>

                      <label className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{isArabic ? "تذكرة المطبخ" : "Auto print Kitchen Ticket"}</span>
                        <input
                          type="checkbox"
                          checked={autoPrintKitchen}
                          onChange={(e) => {
                            setAutoPrintKitchen(e.target.checked);
                            localStorage.setItem('auto_print_kitchen', e.target.checked);
                          }}
                          className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
                        />
                      </label>
                    </div>
                  )}

                  {/* Printer IP Input */}
                  <div className="flex flex-col gap-2 p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-750 text-right">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{t('local_printer_ip')}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        {isArabic ? "عنوان IP لطابعة Epson على شبكتك المحلية" : "Epson printer IP address on your local network"}
                      </p>
                    </div>
                    <input
                      type="text"
                      value={printerIP}
                      onChange={(e) => setPrinterIP(e.target.value)}
                      placeholder="e.g. 192.168.0.182"
                      dir="ltr"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-amber-500 text-left"
                    />
                  </div>
                </div>
              )}

              {activeSettingsTab === 'audio' && (
                <div className="space-y-4">
                  {/* Beep sound on item selection */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-750">
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{isArabic ? "صوت طنين عند النقر" : "Beep on Selection"}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-505 mt-0.5">{isArabic ? "إصدار تنبيه صوتي خفيف عند إضافة منتج للسلة" : "Play a quick sound when adding items to cart"}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={beepEnabled}
                        onChange={(e) => {
                          setBeepEnabled(e.target.checked);
                          localStorage.setItem('beep_enabled', e.target.checked);
                          if (e.target.checked) playBeep();
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-500"></div>
                    </label>
                  </div>

                  {/* Order completion sound */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-750">
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{isArabic ? "صوت عند إكمال الطلب" : "Chime on Completion"}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-505 mt-0.5">{isArabic ? "تشغيل صوت تنبيه عند نجاح إرسال وتسجيل الطلب" : "Play a sound when an order is completed successfully"}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={orderCompleteSoundEnabled}
                        onChange={(e) => {
                          setOrderCompleteSoundEnabled(e.target.checked);
                          localStorage.setItem('order_complete_sound_enabled', e.target.checked);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-amber-500"></div>
                    </label>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'display' && (
                <div className="space-y-4">
                  {/* Fullscreen Toggle */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-750">
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{isArabic ? "وضع ملء الشاشة" : "Fullscreen Mode"}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-555 mt-0.5">
                        {(isIosOrIpad() || isStandalone())
                          ? (isArabic ? "على iPad يتم ملء الشاشة تلقائياً عبر وضع PWA" : "Automatic fullscreen enabled on iPad via PWA mode")
                          : (isArabic ? "تكبير واجهة المبيعات لتغطي كامل الشاشة" : "Expand POS view to cover the entire screen")
                        }
                      </p>
                    </div>
                    {!(isIosOrIpad() || isStandalone()) ? (
                      <button
                        type="button"
                        onClick={() => {
                          const nextVal = !isFullscreen;
                          setIsFullscreen(nextVal);
                          if (nextVal) {
                            document.documentElement.requestFullscreen?.().catch(e => console.warn(e));
                          } else {
                            document.exitFullscreen?.().catch(e => console.warn(e));
                          }
                        }}
                        className="px-3.5 py-2 text-xs font-extrabold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
                      >
                        {isFullscreen
                          ? (isArabic ? "إلغاء ملء الشاشة" : "Exit Fullscreen")
                          : (isArabic ? "ملء الشاشة" : "Go Fullscreen")
                        }
                      </button>
                    ) : (
                      <span className="px-3 py-1.5 text-[11px] font-extrabold rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        {isStandalone() ? (isArabic ? "تطبيق مُثبّت ✓" : "Installed PWA ✓") : (isArabic ? "وضع iPad" : "iPad Mode")}
                      </span>
                    )}
                  </div>

                  {/* Product card size toggle */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-100 dark:border-slate-750">
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{isArabic ? "حجم كروت المنتجات" : "Product Card Size"}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-505 mt-0.5">{isArabic ? "تبديل المظهر بين الحجم المضغوط أو المريح" : "Toggle grid items density to compact or spacious"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const newSize = productCardSize === 'compact' ? 'spacious' : 'compact';
                        setProductCardSize(newSize);
                        localStorage.setItem('product_card_size', newSize);
                      }}
                      className="px-3.5 py-2 text-xs font-extrabold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all cursor-pointer"
                    >
                      {productCardSize === 'compact'
                        ? (isArabic ? "مريح / Spacious" : "Spacious")
                        : (isArabic ? "مضغوط / Compact" : "Compact")
                      }
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex gap-3 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  localStorage.setItem('local_printer_ip', printerIP);
                  setSettingsOpen(false);
                  showNotification(isArabic ? "تم حفظ الإعدادات بنجاح" : "Settings saved successfully");
                }}
                className="flex-1 bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white py-2.5 rounded-xl font-extrabold text-xs shadow-sm transition-all cursor-pointer"
              >
                {isArabic ? "حفظ وإغلاق" : "Save & Close"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Printing Diagnostics Engine Modal */}
      <PrintingDiagnosticsModal
        isOpen={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        onRetryPrint={(printableOrder) => {
          setDiagnosticsOpen(false);
          enqueueAutoReceiptPrint(printableOrder);
        }}
        isArabic={isArabic}
        store={store}
      />

      {/* Handover Confirmation Modal */}
      {logoutConfirmOpen && (
        <div className="fixed inset-0 bg-black/45 z-55 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col">

            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-500" />
                <span>{isArabic ? "تسليم الوردية وإغلاق الصندوق" : "End Cashier Shift"}</span>
              </h3>
              <button
                onClick={() => setLogoutConfirmOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-755 border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-400 dark:text-slate-300 text-xs hover:bg-slate-200 dark:hover:bg-slate-650 active:scale-95 transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <form onSubmit={handleHandoverSubmit} className="p-5 space-y-4">
              <div className="text-right space-y-1">
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold block">
                  {isArabic ? "الكاشير الحالي" : "Current Cashier"}
                </p>
                <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                  {activeCashierSession?.cashierName || 'Ahmed'}
                </p>
              </div>

              <div className="text-right py-2">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-350">
                  {isArabic
                    ? "هل أنت متأكد من رغبتك في تسليم الوردية وإغلاق الصندوق؟"
                    : "Are you sure you want to end this shift and close the cash drawer?"}
                </p>
              </div>

              {/* Modal Actions */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex gap-3">
                <button
                  type="submit"
                  disabled={handoverLoading}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white py-2.5 rounded-xl font-extrabold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  {handoverLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    isArabic ? "تأكيد وإغلاق" : "Confirm & End"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setLogoutConfirmOpen(false)}
                  className="flex-1 py-2.5 rounded-xl font-extrabold text-xs border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-650 active:scale-[0.99] transition-all cursor-pointer"
                >
                  {isArabic ? "إلغاء" : "Cancel"}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* Backoffice PIN Gate Modal */}
      {isPinModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-750 flex flex-col p-6 space-y-6">

            {/* Title / Header */}
            <div className="text-center space-y-1">
              <h3 className="font-extrabold text-xl text-slate-850 dark:text-white">
                {isOtpRecovery && !isOtpVerified
                  ? (isArabic ? "استعادة رمز PIN لوحة التحكم" : "Recover Backoffice PIN")
                  : isPinSetup
                    ? (isArabic ? "إعداد رمز PIN لوحة التحكم" : "Setup Backoffice PIN")
                    : (isArabic ? "بوابة دخول لوحة التحكم" : "Backoffice Access Gate")
                }
              </h3>
              <p className="text-xs text-slate-450 dark:text-slate-400">
                {isOtpRecovery && !isOtpVerified
                  ? (isArabic ? "أدخل الرمز المكون من 6 أرقام المرسل لبريدك" : "Enter the 6-digit OTP sent to your email")
                  : isPinSetup
                    ? (pinInput.length < 4
                      ? (isArabic ? "أدخل رمز PIN جديد (4 أرقام)" : "Enter new PIN (4 digits)")
                      : (isArabic ? "تأكيد رمز PIN الجديد (4 أرقام)" : "Confirm new PIN (4 digits)")
                    )
                    : (isArabic ? "يرجى إدخال رمز PIN المكون من 4 أرقام للمتابعة" : "Please enter the 4-digit PIN to continue")
                }
              </p>
            </div>

            {/* Error Message */}
            {pinError && (
              <div className="text-xs font-black text-rose-500 bg-rose-50 dark:bg-rose-950/20 py-2.5 px-4 rounded-xl text-center animate-shake">
                {pinError}
              </div>
            )}

            {/* Visual Dots Indicators */}
            <div className="flex justify-center gap-2.5 py-2">
              {isOtpRecovery && !isOtpVerified ? (
                // 6 dots for OTP
                Array.from({ length: 6 }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${otpInput.length > i
                      ? 'bg-amber-500 scale-110 shadow-sm shadow-amber-500/30'
                      : 'bg-slate-200 dark:bg-slate-700'
                      }`}
                  />
                ))
              ) : isPinSetup ? (
                // 4 dots for PIN setup
                pinInput.length < 4 ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${pinInput.length > i
                        ? 'bg-amber-500 scale-110 shadow-sm shadow-amber-500/30'
                        : 'bg-slate-200 dark:bg-slate-700'
                        }`}
                    />
                  ))
                ) : (
                  Array.from({ length: 4 }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${confirmInput.length > i
                        ? 'bg-emerald-500 scale-110 shadow-sm shadow-emerald-500/30'
                        : 'bg-slate-200 dark:bg-slate-700'
                        }`}
                    />
                  ))
                )
              ) : (
                // 4 dots for standard PIN entry
                Array.from({ length: 4 }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${pinInput.length > i
                      ? 'bg-amber-500 scale-110 shadow-sm shadow-amber-500/30'
                      : 'bg-slate-200 dark:bg-slate-700'
                      }`}
                  />
                ))
              )}
            </div>

            {/* Custom NumPad Touch Screen Layout */}
            <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto w-full">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  onClick={() => handleNumPadPress(num.toString())}
                  className="h-14 rounded-2xl bg-slate-550/10 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-100 font-extrabold text-xl hover:bg-slate-100 dark:hover:bg-slate-750 active:scale-90 transition-all select-none"
                >
                  {num}
                </button>
              ))}

              {/* Clear (C) */}
              <button
                onClick={handleNumPadClear}
                className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-150 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold text-base hover:bg-slate-200 active:scale-90 transition-all select-none"
              >
                {isArabic ? "مسح" : "Clear"}
              </button>

              {/* Zero (0) */}
              <button
                onClick={() => handleNumPadPress('0')}
                className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-100 font-extrabold text-xl hover:bg-slate-100 dark:hover:bg-slate-750 active:scale-90 transition-all select-none"
              >
                0
              </button>

              {/* Delete (⌫) */}
              <button
                onClick={handleNumPadDelete}
                className="h-14 rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-150 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold text-base hover:bg-slate-200 active:scale-90 transition-all select-none"
              >
                ⌫
              </button>
            </div>

            {/* Bottom Actions and Links */}
            <div className="flex flex-col items-center gap-4 pt-2">
              {/* Save Setup PIN Button if PIN setup input is ready */}
              {isPinSetup && pinInput.length === 4 && confirmInput.length === 4 && (
                <button
                  onClick={handleSaveSetupPin}
                  className="w-full py-3 bg-emerald-650 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl shadow-md transition-all active:scale-[0.99]"
                >
                  {isArabic ? "حفظ رمز PIN والمتابعة 🔒" : "Save PIN & Proceed 🔒"}
                </button>
              )}

              {/* Forgot PIN Recovery Link (Only shown in Verify Mode) */}
              {!isPinSetup && !isOtpRecovery && (
                <button
                  onClick={handleForgotPassword}
                  className="text-xs font-bold text-amber-550 dark:text-amber-400 hover:underline"
                >
                  {isArabic ? "نسيت الـ PIN؟" : "Forgot PIN?"}
                </button>
              )}

              {/* Cancel Access Gate Button */}
              <button
                onClick={() => setIsPinModalOpen(false)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {isArabic ? "إلغاء الدخول" : "Cancel Access"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Split Payment Setup Modal */}
      {showSplitModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-700 flex flex-col p-6 space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="font-extrabold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                <span>💳💵</span>
                <span>{isArabic ? "دفع مجزأ (نقد + بطاقة)" : "Split Payment (Cash + Card)"}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Order Total Display */}
            <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{isArabic ? "إجمالي الطلب:" : "Order Total:"}</span>
              <span className="text-xl font-black text-amber-500">{totalAmount.toFixed(2)} €</span>
            </div>

            {/* Split Inputs */}
            <div className="space-y-4">
              {/* Cash Part Input */}
              <div className="space-y-1 text-right">
                <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>{isArabic ? "المبلغ نقداً (Cash):" : "Cash Portion:"}</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={splitCashInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSplitCashInput(val);
                      const cashCents = toCents(val);
                      const totalCents = toCents(totalAmount);
                      const cardCents = Math.max(0, totalCents - cashCents);
                      setSplitCardInput(fromCents(cardCents));
                    }}
                    placeholder="0.00"
                    dir="ltr"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-black text-slate-800 dark:text-slate-100 focus:outline-none focus:border-amber-500 text-left"
                  />
                </div>
              </div>

              {/* Card Part Input */}
              <div className="space-y-1 text-right">
                <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>{isArabic ? "المبلغ بالبطاقة (Card):" : "Card Portion:"}</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={splitCardInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSplitCardInput(val);
                      const cardCents = toCents(val);
                      const totalCents = toCents(totalAmount);
                      const cashCents = Math.max(0, totalCents - cardCents);
                      setSplitCashInput(fromCents(cashCents));
                    }}
                    placeholder="0.00"
                    dir="ltr"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-black text-slate-800 dark:text-slate-100 focus:outline-none focus:border-amber-500 text-left"
                  />
                </div>
              </div>

              {/* Quick Action: 50 / 50 */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const fifty = calculateFiftyFiftySplit(totalAmount);
                    setSplitCashInput(fifty.cashAmount);
                    setSplitCardInput(fifty.cardAmount);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 text-xs font-bold hover:bg-amber-100 transition-all cursor-pointer"
                >
                  {isArabic ? "تقسيم بالتساوي 50 / 50" : "Split 50 / 50"}
                </button>
              </div>

              {/* Validation Message */}
              {(() => {
                const val = validateSplitAmounts(totalAmount, splitCashInput, splitCardInput, isArabic);
                if (!val.valid) {
                  return (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-300 text-center">
                      {val.error}
                    </div>
                  );
                }
                return (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300 text-center">
                    {isArabic ? "المبالغ متطابقة وجاهزة للتأكيد ✓" : "Amounts match order total exactly ✓"}
                  </div>
                );
              })()}
            </div>

            {/* Modal Actions */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex gap-3">
              <button
                type="button"
                disabled={isSubmittingSplit || !validateSplitAmounts(totalAmount, splitCashInput, splitCardInput, isArabic).valid}
                onClick={handleConfirmSplitPayment}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition-all shadow-md active:scale-[0.99] flex justify-center items-center gap-2 cursor-pointer"
              >
                {isSubmittingSplit ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  isArabic ? "تأكيد الدفع المجزأ" : "Confirm Split Payment"
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                className="px-4 py-3 rounded-xl font-extrabold text-xs border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-200 cursor-pointer"
              >
                {isArabic ? "إلغاء" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card Failure & Split Recovery Modal */}
      {activeSplit && activeSplit.status !== 'succeeded' && activeSplit.status !== 'cancelled' && ['failed', 'cancelled'].includes(stripeStatus) && (
        <div className="fixed inset-0 bg-black/60 z-55 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-700 flex flex-col p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-500 flex items-center justify-center mx-auto text-xl font-bold">
                ⚠️
              </div>
              <h3 className="font-extrabold text-lg text-slate-800 dark:text-white">
                {stripeStatus === 'cancelled'
                  ? (isArabic ? "تم إلغاء الدفع" : "Payment cancelled")
                  : (isArabic ? "فشل دفع البطاقة" : "Card Payment Failed")}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {stripeStatus === 'cancelled'
                  ? (isArabic ? "تم إلغاء البطاقة. المبلغ النقدي ما زال محفوظاً." : "The customer cancelled the card. The cash portion remains available.")
                  : (isArabic ? "تم استلام المبلغ النقدي بنجاح. البطاقة لم تكتمل." : "Cash portion confirmed. Card payment could not be processed.")}
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between font-bold text-emerald-600 dark:text-emerald-400">
                <span>{isArabic ? "النقدي المستلم:" : "Cash received:"}</span>
                <span>{fromCents(activeSplit.cash_amount_cents || 0)} €</span>
              </div>
              <div className="flex justify-between font-bold text-rose-500">
                <span>{isArabic ? "البطاقة الفاشلة:" : "Card failed:"}</span>
                <span>{fromCents(activeSplit.card_amount_cents || 0)} €</span>
              </div>
              <div className="flex justify-between font-black text-amber-500 border-t border-slate-200 dark:border-slate-700 pt-2 text-sm">
                <span>{isArabic ? "المبلغ المتبقي:" : "Remaining amount:"}</span>
                <span>{fromCents(activeSplit.card_amount_cents || 0)} €</span>
              </div>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleRetryCardPayment}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {isArabic ? "إعادة محاولة البطاقة" : "Retry Card Payment"}
              </button>

              <button
                type="button"
                onClick={handlePayRemainingInCash}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {isArabic ? "دفع المتبقي نقداً" : "Pay Remaining in Cash"}
              </button>

              <button
                type="button"
                onClick={() => setConfirmCashReturnedModal(true)}
                className="w-full py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-extrabold text-xs rounded-xl transition-all cursor-pointer"
              >
                {isArabic ? "إلغاء الدفع المجزأ" : "Cancel Split"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Cash Returned Modal */}
      {confirmCashReturnedModal && (
        <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" dir={isArabic ? "rtl" : "ltr"}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-700 flex flex-col p-6 space-y-4">
            <h3 className="font-extrabold text-base text-slate-800 dark:text-white text-center">
              {isArabic ? "تأكيد إعادة النقد للزبون" : "Confirm Cash Returned"}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              {isArabic
                ? `تم تحصيل ${fromCents(activeSplit?.cash_amount_cents || 0)} € نقداً. تأكد من إرجاع المبلغ للزبون قبل إلغاء العملية.`
                : `€${fromCents(activeSplit?.cash_amount_cents || 0)} was received in cash. Confirm cash was returned to customer before cancelling.`}
            </p>

            <div className="pt-3 flex gap-3">
              <button
                type="button"
                onClick={handleCancelSplitConfirmed}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-sm cursor-pointer"
              >
                {isArabic ? "تم إرجاع النقد وإلغاء الطلب" : "Cash Returned & Cancel"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCashReturnedModal(false)}
                className="px-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold text-xs rounded-xl cursor-pointer"
              >
                {isArabic ? "تراجع" : "Go Back"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function BackOfficeLogin({ onBackToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isDeletedError = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('error') === 'deleted');
  const isAr = localStorage.getItem('app_language') === 'ar';

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    if (isMasterHost && email.trim() !== 'superadmin@cashmint.online') {
      setErrorMsg('Access Denied: Unauthorized administrator email.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });
      if (error) throw error;

      // If logging into master dashboard, verify if user is actually a superadmin/master admin
      if (isMasterHost) {
        if (!data?.user || data.user.email !== 'superadmin@cashmint.online') {
          await supabase.auth.signOut();
          throw new Error('Access Denied: Unauthorized administrator email.');
        }
      }
    } catch (err) {
      console.error('BackOffice Login Error:', err);
      setErrorMsg(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center bg-gradient-to-br px-4 font-sans select-none text-slate-100 ${isMasterHost
      ? 'from-slate-955 via-slate-900 to-slate-955'
      : 'from-slate-900 via-slate-800 to-slate-955'
      }`}>
      <div className={`max-w-md w-full backdrop-blur-2xl rounded-3xl border shadow-2xl p-8 space-y-8 relative overflow-hidden ${isMasterHost
        ? 'bg-slate-900/40 border-slate-800/80'
        : 'bg-slate-900/60 border-slate-800'
        }`}>

        {/* Decorative background glows for master theme */}
        {isMasterHost && (
          <>
            <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-blue-600/10 blur-3xl pointer-events-none" />
          </>
        )}

        {/* Branding header */}
        <div className="text-center space-y-4 flex flex-col items-center">
          <CashmintLogo size="md" badgeBg={true} />
          <div className={`inline-flex items-center justify-center px-6 py-2 rounded-2xl font-black tracking-wider text-xs shadow-lg uppercase border ${isMasterHost
            ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-cyan-500/15 border-cyan-500/20'
            : 'bg-amber-500 text-white shadow-amber-500/20 border-amber-400/20'
            }`}>
            {isMasterHost ? "CASHMINT MASTER CENTRAL" : "CASHMINT BACKOFFICE"}
          </div>

          <div className="flex flex-col items-center gap-2 mt-2">
            <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shadow-inner relative ${isMasterHost
              ? 'bg-slate-800/80 border-slate-700/50 text-cyan-400'
              : 'bg-slate-800/60 border-slate-700/40 text-amber-500'
              }`}>
              {/* Subtle pulse ring effect */}
              <span className={`absolute inset-0 rounded-2xl border animate-ping opacity-75 ${isMasterHost ? 'border-cyan-500/30' : 'border-amber-500/30'
                }`} />
              <Shield className="w-6 h-6" />
            </div>

            <h2 className="text-2xl font-black text-white tracking-tight mt-1 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-200">
              {isMasterHost ? "Master Control Login" : "System Sign In"}
            </h2>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {isMasterHost ? "Authorized Master Super Admin Access Only" : "Please enter your administrator credentials to manage the store"}
            </p>
          </div>
        </div>

        {isDeletedError && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/25 rounded-2xl text-red-400 text-sm font-bold text-center justify-center">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>
              {isAr
                ? "لقد تم إيقاف أو حذف الحساب من قبل الشركة، برجاء التواصل مع الدعم."
                : "This account has been suspended or deleted by the company. Please contact support."}
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/25 rounded-2xl text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block px-1">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
                <User className="w-5 h-5" />
              </span>
              <input
                type="email"
                required
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full pl-11 pr-4 py-3.5 bg-slate-950/50 border border-slate-800 rounded-2xl text-white placeholder-slate-600 outline-none transition-all text-sm font-medium ${isMasterHost
                  ? 'focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50'
                  : 'focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50'
                  }`}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block px-1">
              Password
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-5 h-5" />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full pl-11 pr-12 py-3.5 bg-slate-950/50 border border-slate-800 rounded-2xl text-white placeholder-slate-600 outline-none transition-all text-sm font-medium ${isMasterHost
                  ? 'focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50'
                  : 'focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50'
                  }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-300 font-semibold text-xs transition-colors"
              >
                {showPassword ? "HIDE" : "SHOW"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-4 text-white font-extrabold text-sm rounded-2xl shadow-xl transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer border ${isMasterHost
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-cyan-600/50 disabled:to-blue-600/50 shadow-cyan-500/10 border-cyan-500/10'
              : 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 shadow-amber-500/10 border-amber-500/10'
              }`}
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            ) : (
              isMasterHost ? 'Secure Master Authentication' : 'Sign In to BackOffice'
            )}
          </button>
        </form>

        <div className="text-center space-y-3">
          {onBackToLanding && (
            <button
              type="button"
              onClick={onBackToLanding}
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white transition-colors cursor-pointer bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 px-4 py-2.5 rounded-xl shadow-xs"
            >
              <ArrowRight className="w-4 h-4 text-cyan-400" />
              <span>العودة إلى الصفحة الرئيسية</span>
            </button>
          )}
          <p className="text-xs text-slate-600">
            Secured by Supabase Auth
          </p>
        </div>
      </div>
    </div>
  );
}
