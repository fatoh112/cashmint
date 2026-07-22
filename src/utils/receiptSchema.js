/**
 * Receipt Schema, Belgian Compliance Rules, and Multilingual Dictionary
 * Supporting English, Arabic, French, and Dutch for Cashier, Customer, and Kitchen print outputs.
 */

export const BELGIUM_LOCKED_FIELDS = [
  'header.show_legal_name',
  'header.show_address',
  'header.show_vat_number',
  'meta.show_receipt_number',
  'meta.show_timestamp',
  'tax_breakdown.show_detailed_rates'
];

export const RECEIPT_LANGUAGES = ['en', 'ar', 'fr', 'nl'];

// Legacy templates used `pos_language`, which incorrectly followed the global UI language.
export function normalizeReceiptLanguage(language = 'en') {
  return RECEIPT_LANGUAGES.includes(language) ? language : 'en';
}

/**
 * Default Cashier Receipt Configuration (Full Receipt)
 */
export const DEFAULT_CASHIER_CONFIG = {
  paper_width: 80,
  language_mode: 'en',
  styles: {
    font_size: 'normal',
    divider_style: 'single',
    line_spacing: 'normal'
  },
  sections_order: ['header', 'meta', 'items', 'subtotals', 'tax_breakdown', 'payments', 'footer'],
  header: {
    show_logo: true,
    logo_url: '',
    logo_align: 'center',
    show_store_name: true,
    custom_store_name: '',
    show_legal_name: true, // LOCKED
    show_address: true, // LOCKED
    show_vat_number: true, // LOCKED
    show_phone: true,
    custom_phone: '',
    custom_lines: ['Welcome to Cashmint POS!']
  },
  meta: {
    show_receipt_number: true, // LOCKED
    show_order_id: true,
    show_timestamp: true, // LOCKED
    show_order_type: true,
    show_cashier_name: true,
    show_customer_info: false,
    show_table_number: true
  },
  items: {
    show_modifiers: true,
    show_discounts: true,
    show_prices: true,
    show_sku: false
  },
  tax_breakdown: {
    show_detailed_rates: true // LOCKED
  },
  payments: {
    show_payment_method: true,
    show_change_due: true
  },
  footer: {
    show_footer_message: true,
    custom_lines: ['Thank you for your visit! / Merci de votre visite!']
  }
};

/**
 * Default Customer Receipt Configuration (Simplified Customer Record)
 */
export const DEFAULT_CUSTOMER_CONFIG = {
  ...DEFAULT_CASHIER_CONFIG,
  sections_order: ['header', 'meta', 'items', 'subtotals', 'payments', 'footer'],
  header: {
    ...DEFAULT_CASHIER_CONFIG.header,
    custom_lines: ['Customer Copy / Ticket Client']
  },
  tax_breakdown: {
    show_detailed_rates: true
  },
  payments: {
    show_payment_method: true,
    show_change_due: false
  },
  footer: {
    show_footer_message: true,
    custom_lines: ['Thank you for dining with us!']
  }
};

/**
 * Default Kitchen Ticket Configuration (Product & Order Preparation Ticket)
 */
export const DEFAULT_KITCHEN_CONFIG = {
  paper_width: 80,
  language_mode: 'en',
  styles: {
    font_size: 'large',
    divider_style: 'double',
    line_spacing: 'relaxed'
  },
  sections_order: ['meta', 'items', 'footer'],
  header: {
    show_logo: false,
    logo_url: '',
    logo_align: 'center',
    show_store_name: false,
    custom_store_name: '',
    show_legal_name: false,
    show_address: false,
    show_vat_number: false,
    show_phone: false,
    custom_phone: '',
    custom_lines: []
  },
  meta: {
    show_receipt_number: true,
    show_order_id: true,
    show_timestamp: true,
    show_order_type: true,
    show_cashier_name: true,
    show_customer_info: false,
    show_table_number: true
  },
  items: {
    show_modifiers: true,
    show_discounts: false,
    show_prices: false,
    show_sku: false
  },
  tax_breakdown: {
    show_detailed_rates: false
  },
  payments: {
    show_payment_method: false,
    show_change_due: false
  },
  footer: {
    show_footer_message: true,
    custom_lines: ['=== KITCHEN TICKET ===']
  }
};

export const DEFAULT_RECEIPT_CONFIG = DEFAULT_CASHIER_CONFIG;

/**
 * Get default config for a specific template type.
 */
export function getDefaultConfigForType(templateType = 'pos_receipt') {
  switch (templateType) {
    case 'kitchen_ticket':
      return DEFAULT_KITCHEN_CONFIG;
    case 'customer_receipt':
      return DEFAULT_CUSTOMER_CONFIG;
    case 'pos_receipt':
    case 'cashier_receipt':
    default:
      return DEFAULT_CASHIER_CONFIG;
  }
}

export const RECEIPT_TRANSLATIONS = {
  en: {
    receipt_title: 'RECEIPT',
    order_num: 'Order #',
    receipt_num: 'Receipt #',
    date: 'Date',
    cashier: 'Cashier',
    type: 'Order Type',
    dine_in: 'DINE-IN',
    takeaway: 'TAKEAWAY',
    delivery: 'DELIVERY',
    table: 'Table',
    customer: 'Customer',
    item: 'Item',
    qty: 'Qty',
    price: 'Price',
    subtotal: 'Subtotal (excl. VAT)',
    vat: 'VAT',
    vat_breakdown: 'VAT Breakdown',
    vat_rate: 'Rate',
    vat_net: 'Net',
    vat_tax: 'Tax',
    total: 'TOTAL',
    payment: 'Payment Method',
    cash: 'Cash',
    card: 'Card',
    paid: 'Amount Paid',
    change: 'Change',
    discount: 'Discount',
    thank_you: 'Thank you for your visit!',
    kitchen_ticket: '=== KITCHEN TICKET ==='
  },
  ar: {
    receipt_title: 'فاتورة مبيعات',
    order_num: 'رقم الطلب',
    receipt_num: 'رقم الفاتورة',
    date: 'التاريخ',
    cashier: 'الكاشير',
    type: 'نوع الطلب',
    dine_in: 'صالة / محلي',
    takeaway: 'سفري',
    delivery: 'توصيل',
    table: 'الطاولة',
    customer: 'العميل',
    item: 'الصنف',
    qty: 'الكمية',
    price: 'السعر',
    subtotal: 'المجموع (بدون الضريبة)',
    vat: 'ضريبة القيمة المضافة',
    vat_breakdown: 'تفاصيل الضريبة',
    vat_rate: 'النسبة',
    vat_net: 'الصافي',
    vat_tax: 'الضريبة',
    total: 'المجموع الكلي',
    payment: 'طريقة الدفع',
    cash: 'نقداً',
    card: 'بطاقة',
    paid: 'المبلغ المدفوع',
    change: 'الباقي',
    discount: 'خصم',
    thank_you: 'شكراً لزيارتكم!',
    kitchen_ticket: '=== تذكرة المطبخ ==='
  },
  fr: {
    receipt_title: 'TICKET DE CAISSE',
    order_num: 'Commande n°',
    receipt_num: 'Ticket n°',
    date: 'Date',
    cashier: 'Caissier',
    type: 'Type de commande',
    dine_in: 'SUR PLACE',
    takeaway: 'À EMPORTER',
    delivery: 'LIVRAISON',
    table: 'Table',
    customer: 'Client',
    item: 'Article',
    qty: 'Qté',
    price: 'Prix',
    subtotal: 'Sous-total HT',
    vat: 'TVA',
    vat_breakdown: 'Détail TVA',
    vat_rate: 'Taux',
    vat_net: 'Base HT',
    vat_tax: 'Montant TVA',
    total: 'TOTAL TTC',
    payment: 'Mode de paiement',
    cash: 'Espèces',
    card: 'Carte bancaire',
    paid: 'Montant payé',
    change: 'Rendu',
    discount: 'Remise',
    thank_you: 'Merci de votre visite !',
    kitchen_ticket: '=== BON DE CUISINE ==='
  },
  nl: {
    receipt_title: 'KASSABON',
    order_num: 'Bestelling nr.',
    receipt_num: 'Kassabon nr.',
    date: 'Datum',
    cashier: 'Kassier',
    type: 'Besteltype',
    dine_in: 'TER PLAATSE',
    takeaway: 'MEENEMEN',
    delivery: 'LEVERING',
    table: 'Tafel',
    customer: 'Klant',
    item: 'Artikel',
    qty: 'Aantal',
    price: 'Prijs',
    subtotal: 'Subtotaal excl. btw',
    vat: 'BTW',
    vat_breakdown: 'BTW-overzicht',
    vat_rate: 'Tarief',
    vat_net: 'Netto',
    vat_tax: 'BTW-bedrag',
    total: 'TOTAAL',
    payment: 'Betaalmethode',
    cash: 'Contant',
    card: 'Betaalkaart',
    paid: 'Betaald',
    change: 'Wisselgeld',
    discount: 'Korting',
    thank_you: 'Bedankt voor uw bezoek!',
    kitchen_ticket: '=== KEUKEN BON ==='
  }
};

// Keep receipt labels as real Unicode text (the legacy entries above were
// stored with mojibake and could leak mixed-language output to printers).
Object.assign(RECEIPT_TRANSLATIONS.ar, {
  receipt_title: 'فاتورة مبيعات', order_num: 'رقم الطلب', receipt_num: 'رقم الفاتورة', date: 'التاريخ',
  cashier: 'الكاشير', type: 'نوع الطلب', dine_in: 'محلي', takeaway: 'سفري', delivery: 'توصيل',
  table: 'الطاولة', customer: 'العميل', item: 'الصنف', qty: 'الكمية', price: 'السعر',
  subtotal: 'المجموع (بدون الضريبة)', vat: 'ضريبة القيمة المضافة', vat_breakdown: 'تفاصيل الضريبة',
  vat_rate: 'النسبة', vat_net: 'الصافي', vat_tax: 'الضريبة', total: 'المجموع الكلي',
  payment: 'طريقة الدفع', cash: 'نقدًا', card: 'بطاقة', paid: 'المبلغ المدفوع', change: 'الباقي',
  discount: 'خصم', thank_you: 'شكرًا لزيارتكم!', kitchen_ticket: '=== تذكرة المطبخ ==='
});
Object.assign(RECEIPT_TRANSLATIONS.fr, {
  order_num: 'Commande n°', receipt_num: 'Ticket n°', qty: 'Qté', takeaway: 'À EMPORTER',
  subtotal: 'Sous-total HT', vat_breakdown: 'Détail TVA', vat_net: 'Base HT',
  vat_tax: 'Montant TVA', cash: 'Espèces', thank_you: 'Merci de votre visite !'
});

/**
 * Get translation for a receipt label key and language code.
 */
export function getReceiptTranslation(key, lang = 'en') {
  const selectedLang = RECEIPT_TRANSLATIONS[lang] ? lang : 'en';
  return RECEIPT_TRANSLATIONS[selectedLang]?.[key] || RECEIPT_TRANSLATIONS['en']?.[key] || key;
}

const containsArabic = (value) => /[\u0600-\u06FF]/.test(String(value || ''));
const containsLatin = (value) => /[A-Za-zÀ-ÿ]/.test(String(value || ''));

/**
 * Resolve a catalog entity name for the selected receipt language.
 * Existing name_ar/name fields are supported, as are future name_* and
 * translations/localized_name objects returned by the catalog payload.
 */
export function getLocalizedReceiptText(entity = {}, language = 'en', options = {}) {
  const lang = normalizeReceiptLanguage(language);
  const translations = entity.translations || entity.localized_name || entity.localized_names || {};
  const valueFor = (code) => entity[`name_${code}`] || translations[code] || translations[`${code}-BE`];
  const base = entity.name || entity.product_name || entity.label || '';
  const sku = entity.sku || entity.SKU || '';
  const missing = {
    ar: 'منتج بدون اسم',
    en: 'Unnamed item',
    fr: 'Article sans nom',
    nl: 'Naamloos artikel'
  }[lang];

  if (lang === 'ar') {
    return valueFor('ar') || (containsArabic(base) ? base : '') || sku || missing;
  }

  return valueFor(lang)
    || (lang !== 'en' ? valueFor('en') : '')
    || (containsLatin(base) ? base : '')
    || sku
    || options.fallback
    || missing;
}

export function getLocalizedReceiptPayment(value, language = 'en') {
  const text = String(value || '').toLowerCase();
  if (text.includes('cash') || text.includes('نقد')) return getReceiptTranslation('cash', language);
  if (text.includes('card') || text.includes('bancontact') || text.includes('stripe') || text.includes('بطاق')) {
    return getReceiptTranslation('card', language);
  }
  return value || getReceiptTranslation('cash', language);
}

/**
 * Merges a custom template configuration with default settings based on type and enforces Belgium compliance locks.
 */
export function mergeAndEnforceReceiptConfig(customConfig = {}, templateType = 'pos_receipt') {
  const defaultConfig = getDefaultConfigForType(templateType);
  const merged = {
    ...defaultConfig,
    ...customConfig,
    styles: { ...defaultConfig.styles, ...(customConfig.styles || {}) },
    header: { ...defaultConfig.header, ...(customConfig.header || {}) },
    meta: { ...defaultConfig.meta, ...(customConfig.meta || {}) },
    items: { ...defaultConfig.items, ...(customConfig.items || {}) },
    tax_breakdown: { ...defaultConfig.tax_breakdown, ...(customConfig.tax_breakdown || {}) },
    payments: { ...defaultConfig.payments, ...(customConfig.payments || {}) },
    footer: { ...defaultConfig.footer, ...(customConfig.footer || {}) },
    sections_order: customConfig.sections_order || defaultConfig.sections_order
  };
  merged.language_mode = normalizeReceiptLanguage(merged.language_mode);

  // Enforce Belgium legal locks only for Cashier / POS Receipts and Customer Receipts
  if (templateType !== 'kitchen_ticket') {
    merged.header.show_legal_name = true;
    merged.header.show_address = true;
    merged.header.show_vat_number = true;
    merged.meta.show_receipt_number = true;
    merged.meta.show_timestamp = true;
    merged.tax_breakdown.show_detailed_rates = true;
  }

  return merged;
}
