import React, { useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { printReceipt } from '../../utils/printerService';
import { mergeAndEnforceReceiptConfig, getReceiptTranslation, normalizeReceiptLanguage } from '../../utils/receiptSchema';

export default function ReceiptPreview({ config: inputConfig, store, isArabic, templateType = 'pos_receipt' }) {
  const [printing, setPrinting] = useState(false);
  const config = mergeAndEnforceReceiptConfig(inputConfig || {}, templateType);
  const isKitchen = templateType === 'kitchen_ticket';

  const is58mm = config.paper_width === 58;
  const lang = normalizeReceiptLanguage(config.language_mode);
  const t = (key) => getReceiptTranslation(key, lang);
  const isRtl = lang === 'ar';

  const storeLogo = config.header?.logo_url || store?.logo_url;
  const storeName = config.header?.custom_store_name || store?.name || 'Cashmint Store';
  const storeLegalName = store?.legal_name || store?.name || 'Cashmint Belgium SRL';
  const storeAddress = store?.address || 'Rue Royale 100, 1000 Bruxelles';
  const storeVat = store?.vat_number || 'BE 0789.123.456';
  const storePhone = config.header?.custom_phone || store?.phone || '+32 2 555 0199';

  // Dummy order data for real-time preview
  const dummyOrder = {
    id: 'a1b2c3d4-5678-90ef-1234-567890abcdef',
    receipt_number: 'REC-2026-0842',
    total_amount: 18.50,
    vat_amount: 1.98,
    subtotal_excl_vat: 16.52,
    payment_method: 'Card / Stripe',
    raw_payload: {
      timestamp: new Date().toISOString(),
      order_type: 'takeaway',
      cashier_name: 'Alex M.',
      table_number: 'Table 4',
      customer_name: 'Jean Dupont',
      coupon_code: 'WELCOME10',
      payment_label: 'Card / Bancontact',
      change_due: 0.00,
      cart_items: [
        {
          name: isArabic ? 'برجر كلاسيك' : 'Classic Cheese Burger',
          price: 12.50,
          quantity: 1,
          modifiers: [
            { name: isArabic ? 'جبنة إضافية' : 'Extra Cheddar Cheese', price_adjustment: 1.50 }
          ]
        },
        {
          name: isArabic ? 'بطاطس مقلية كبيرة' : 'Large French Fries',
          price: 4.50,
          quantity: 1,
          modifiers: []
        }
      ]
    }
  };

  const handleTestPrint = async () => {
    try {
      setPrinting(true);
      const printerIP = store?.printer_ip || localStorage.getItem('local_printer_ip') || '';
      const res = await printReceipt(dummyOrder, printerIP, store, {
        templateConfig: config,
        outputType: templateType,
        isArabic,
        skipFallback: false
      });
      if (res.success) {
        console.log("Test print triggered successfully.");
      }
    } catch (err) {
      console.error("Test print error:", err);
    } finally {
      setPrinting(false);
    }
  };

  const sepChar = config.styles?.divider_style === 'double' ? '=' : '-';
  const maxChars = is58mm ? 30 : 40;
  const separator = sepChar.repeat(maxChars);

  const sectionsOrder = config.sections_order || ['header', 'meta', 'items', 'subtotals', 'tax_breakdown', 'payments', 'footer'];

  return (
    <div className="flex flex-col items-center space-y-4 font-sans select-none">
      
      {/* Test Print Action Bar */}
      <div className="w-full max-w-sm flex items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {is58mm ? '58mm Format' : '80mm Standard Format'}
          </span>
        </div>

        <button
          onClick={handleTestPrint}
          disabled={printing}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {printing ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Printer className="w-3.5 h-3.5" />
          )}
          <span>{isArabic ? 'طباعة تجريبية' : 'Test Print'}</span>
        </button>
      </div>

      {/* Thermal Receipt Visualizer Container */}
      <div className={`w-full ${is58mm ? 'max-w-[270px]' : 'max-w-[340px]'} transition-all duration-300`}>
        <div className="bg-amber-50/40 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-t-2xl shadow-xl overflow-hidden text-slate-900 dark:text-slate-100 font-mono text-[11px] leading-relaxed p-4 border-b-0 relative">
          
          <div dir={isRtl ? 'rtl' : 'ltr'}>
            {sectionsOrder.map((sectionKey) => {
              switch (sectionKey) {
                case 'header':
                  return (
                    <div key="header" className="space-y-1 mb-2">
                      <div className={`text-${config.header?.logo_align || 'center'}`}>
                        {config.header?.show_logo && storeLogo && (
                          <img 
                            src={storeLogo} 
                            alt="Logo" 
                            className={`w-14 h-14 object-contain mb-1.5 filter grayscale ${
                              config.header?.logo_align === 'left'
                                ? 'mr-auto ml-0'
                                : config.header?.logo_align === 'right'
                                ? 'ml-auto mr-0'
                                : 'mx-auto'
                            }`}
                          />
                        )}
                        {config.header?.show_store_name && (
                          <div className="font-bold text-xs uppercase">{storeName}</div>
                        )}
                        {config.header?.show_legal_name && (
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">{storeLegalName}</div>
                        )}
                        {config.header?.show_address && (
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">{storeAddress}</div>
                        )}
                        {config.header?.show_vat_number && (
                          <div className="text-[10px] font-semibold">{storeVat}</div>
                        )}
                        {config.header?.show_phone && storePhone && (
                          <div className="text-[10px]">Tel: {storePhone}</div>
                        )}
                        {config.header?.custom_lines && Array.isArray(config.header.custom_lines) && (
                          config.header.custom_lines.map((line, i) => (
                            line && line.trim() && <div key={i} className="text-[10px] text-slate-600 dark:text-slate-300">{line.trim()}</div>
                          ))
                        )}
                      </div>
                      {(config.header?.show_store_name || config.header?.show_legal_name || (config.header?.custom_lines && config.header.custom_lines.length > 0)) && (
                        <div className="text-center text-slate-400 font-bold overflow-hidden whitespace-nowrap">{separator}</div>
                      )}
                    </div>
                  );

                case 'meta':
                  return (
                    <div key="meta" className="space-y-0.5 text-left mb-2" dir={isRtl ? 'rtl' : 'ltr'}>
                      {isKitchen && (
                        <div className="text-center mb-2 pb-1 border-b-2 border-slate-400">
                          <div className="text-sm font-black uppercase text-amber-600 dark:text-amber-400">{t('takeaway')}</div>
                          <div className="text-xs font-bold">{t('table')}: Table 4</div>
                        </div>
                      )}
                      {config.meta?.show_receipt_number && (
                        <div>{t('receipt_num')}: {dummyOrder.receipt_number}</div>
                      )}
                      {config.meta?.show_order_id && (
                        <div>{t('order_num')}: {dummyOrder.id.substring(0, 8)}</div>
                      )}
                      {config.meta?.show_timestamp && (
                        <div>{t('date')}: {new Date().toLocaleString(isRtl ? 'ar-BE' : 'en-BE')}</div>
                      )}
                      {!isKitchen && config.meta?.show_order_type && (
                        <div>{t('type')}: {t('takeaway')}</div>
                      )}
                      {config.meta?.show_cashier_name && (
                        <div>{t('cashier')}: Alex M.</div>
                      )}
                      {!isKitchen && config.meta?.show_table_number && (
                        <div>{t('table')}: Table 4</div>
                      )}
                      {config.meta?.show_customer_info && (
                        <div>{t('customer')}: Jean Dupont</div>
                      )}
                      <div className="text-center text-slate-400 font-bold overflow-hidden whitespace-nowrap mt-1">{separator}</div>
                    </div>
                  );

                case 'items':
                  const showPrices = config.items?.show_prices !== false;
                  return (
                    <div key="items" className="space-y-1 mb-2">
                      <div className="flex justify-between font-bold border-b border-dashed border-slate-300 dark:border-slate-700 pb-1">
                        <span>{t('item')}</span>
                        {showPrices && <span>{t('price')}</span>}
                      </div>
                      {dummyOrder.raw_payload.cart_items.map((item, idx) => (
                        <div key={idx} className="space-y-0.5">
                          <div className="flex justify-between">
                            <span className={`font-semibold ${isKitchen ? 'text-xs font-extrabold' : ''}`}>{item.quantity}x {item.name}</span>
                            {showPrices && <span>{(item.price * item.quantity).toFixed(2)} €</span>}
                          </div>
                          {config.items?.show_modifiers && item.modifiers?.map((mod, mIdx) => (
                            <div key={mIdx} className="flex justify-between text-[10px] text-slate-600 dark:text-slate-300 pl-2 font-bold">
                              <span>+ {mod.name}</span>
                              {showPrices && mod.price_adjustment && <span>+{mod.price_adjustment.toFixed(2)} €</span>}
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="text-center text-slate-400 font-bold overflow-hidden whitespace-nowrap mt-1">{separator}</div>
                    </div>
                  );

                case 'subtotals':
                  return !isKitchen ? (
                    <div key="subtotals" className="space-y-0.5 mb-2">
                      <div className="flex justify-between">
                        <span>{t('subtotal')}:</span>
                        <span>{dummyOrder.subtotal_excl_vat.toFixed(2)} €</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t('vat')}:</span>
                        <span>{dummyOrder.vat_amount.toFixed(2)} €</span>
                      </div>
                      <div className="flex justify-between font-extrabold text-xs pt-1 border-t border-slate-300 dark:border-slate-700">
                        <span>{t('total')}:</span>
                        <span>{dummyOrder.total_amount.toFixed(2)} €</span>
                      </div>
                      <div className="text-center text-slate-400 font-bold overflow-hidden whitespace-nowrap mt-1">{separator}</div>
                    </div>
                  ) : null;

                case 'tax_breakdown':
                  return (!isKitchen && config.tax_breakdown?.show_detailed_rates) ? (
                    <div key="tax_breakdown" className="space-y-1 mb-2 text-[10px]">
                      <div className="font-bold">{t('vat_breakdown')}</div>
                      <div className="flex justify-between text-slate-600 dark:text-slate-400 border-b border-dashed border-slate-300 dark:border-slate-700 pb-0.5">
                        <span>{t('vat_rate')} | {t('vat_net')}</span>
                        <span>{t('vat_tax')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>6% | {dummyOrder.subtotal_excl_vat.toFixed(2)} €</span>
                        <span>{dummyOrder.vat_amount.toFixed(2)} €</span>
                      </div>
                      <div className="text-center text-slate-400 font-bold overflow-hidden whitespace-nowrap mt-1">{separator}</div>
                    </div>
                  ) : null;

                case 'payments':
                  return !isKitchen ? (
                    <div key="payments" className="space-y-0.5 mb-2">
                      {config.payments?.show_payment_method && (
                        <div className="flex justify-between">
                          <span>{t('payment')}:</span>
                          <span className="font-semibold">{dummyOrder.raw_payload.payment_label}</span>
                        </div>
                      )}
                      {config.payments?.show_change_due && (
                        <div className="flex justify-between text-slate-600 dark:text-slate-400">
                          <span>{t('change')}:</span>
                          <span>0.00 €</span>
                        </div>
                      )}
                      <div className="text-center text-slate-400 font-bold overflow-hidden whitespace-nowrap mt-1">{separator}</div>
                    </div>
                  ) : null;

                case 'footer':
                  return (
                    <div key="footer" className="text-center space-y-1 mt-2">
                      {config.footer?.custom_lines && Array.isArray(config.footer.custom_lines) ? (
                        config.footer.custom_lines.map((line, i) => (
                          line && line.trim() && <div key={i} className={`text-[10px] ${isKitchen ? 'font-extrabold text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>{line.trim()}</div>
                        ))
                      ) : (
                        <div className="text-[10px]">{t('thank_you')}</div>
                      )}
                    </div>
                  );

                default:
                  return null;
              }
            })}
          </div>

        </div>

        {/* Paper Tear Jagged Edge Effect */}
        <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 [clip-path:polygon(0%_0%,_5%_100%,_10%_0%,_15%_100%,_20%_0%,_25%_100%,_30%_0%,_35%_100%,_40%_0%,_45%_100%,_50%_0%,_55%_100%,_60%_0%,_65%_100%,_70%_0%,_75%_100%,_80%_0%,_85%_100%,_90%_0%,_95%_100%,_100%_0%)]" />
      </div>

    </div>
  );
}
