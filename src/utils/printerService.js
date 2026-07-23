/**
 * Printer Service for Epson TM-T20IV & Dual Pipeline Printing Engine.
 * Sends raw XML print commands to the local printer IP using ePOS-Print XML API
 * or renders responsive thermal receipts in a silent iframe fallback.
 * Supports Cashier Receipts, Customer Receipts, and Kitchen Tickets with Header Branding Customizations.
 */

import { mergeAndEnforceReceiptConfig, getReceiptTranslation, normalizeReceiptLanguage, getLocalizedReceiptText, getLocalizedReceiptPayment } from './receiptSchema';
import { addDiagnosticLog } from './diagnosticLogger';

/**
 * Format string line with left and right aligned parts to fit printer paper width.
 */
function formatLine(left, right, width = 40) {
  const leftStr = String(left || '');
  const rightStr = String(right || '');
  const spaceNeeded = width - (leftStr.length + rightStr.length);
  if (spaceNeeded > 0) {
    return leftStr + ' '.repeat(spaceNeeded) + rightStr;
  }
  return leftStr.substring(0, Math.max(1, width - rightStr.length - 1)) + ' ' + rightStr;
}

/**
 * Safe XML escaper for user-provided texts.
 */
function escapeXML(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>'"]/g, (match) => {
    switch (match) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return match;
    }
  });
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[match]));
}

/**
 * Normalizes store input object or string into a structured store info object, taking template header overrides into account.
 */
function normalizeStoreInfo(storeInput, config = {}) {
  const baseStore = typeof storeInput === 'string'
    ? { name: storeInput, legal_name: storeInput, address: '', vat_number: '', phone: '', logo_url: '' }
    : {
      name: storeInput?.name || 'Cashmint Store',
      legal_name: storeInput?.legal_name || storeInput?.name || 'Cashmint POS SRL',
      address: storeInput?.address || storeInput?.street_address || '',
      vat_number: storeInput?.vat_number || storeInput?.tax_id || '',
      phone: storeInput?.phone || '',
      logo_url: storeInput?.logo_url || storeInput?.logoUrl || ''
    };

  return {
    ...baseStore,
    name: config.header?.custom_store_name || baseStore.name,
    phone: config.header?.custom_phone || baseStore.phone,
    logo_url: config.header?.logo_url || baseStore.logo_url
  };
}

/**
 * Converts a store logo URL into 1-bit monochrome raster image XML for Epson TM-T20IV.
 * Epson ePOS XML image syntax requires the raster bytes as base64Binary:
 * <image width="256" height="128" align="center" color="color_1">BASE64_RASTER_DATA</image>
 */
export async function convertLogoToEpsonXML(logoUrl, align = 'center', maxTargetWidth = 256) {
  console.log(`[LOGO-TRACE] normalized-logo-url: ${logoUrl || '(none)'}`);
  if (!logoUrl) return '';

  let objectUrlToRevoke = null;
  try {
    let srcToLoad = logoUrl;

    if (typeof fetch !== 'undefined' && logoUrl.startsWith('http')) {
      try {
        console.log(`[LOGO-TRACE] fetch-status: fetching blob for logoUrl...`);
        const res = await fetch(logoUrl);
        console.log(`[LOGO-TRACE] fetch-status: ${res.status}`);
        const contentType = res.headers.get('content-type') || '';
        console.log(`[LOGO-TRACE] response-content-type: ${contentType}`);
        if (res.ok) {
          const blob = await res.blob();
          console.log(`[LOGO-TRACE] blob-size: ${blob.size}`);
          if (blob.size > 0) {
            objectUrlToRevoke = URL.createObjectURL(blob);
            srcToLoad = objectUrlToRevoke;
          }
        }
      } catch (fetchErr) {
        console.warn(`[LOGO-TRACE] fetch failed, fallback to direct src: ${fetchErr.message}`);
      }
    }

    const img = new Image();
    if (!objectUrlToRevoke && !logoUrl.startsWith('data:')) {
      img.crossOrigin = 'Anonymous';
    }

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = (e) => reject(new Error('Failed to load logo image for thermal rasterization'));
      img.src = srcToLoad;
    });

    console.log(`[LOGO-TRACE] image-natural-size: ${img.naturalWidth || img.width}x${img.naturalHeight || img.height}`);

    // Ensure target width is a multiple of 8 (Epson requirement)
    let width = Math.min(img.width || 256, maxTargetWidth);
    width = Math.floor(width / 8) * 8;
    if (width < 8) width = 8;

    const scale = width / (img.width || width);
    const height = Math.max(1, Math.round((img.height || width) * scale));

    console.log(`[LOGO-TRACE] canvas-size: ${width}x${height}`);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill white background for transparent PNGs
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Draw scaled image onto canvas
    ctx.drawImage(img, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const pixels = imgData.data;
    console.log(`[LOGO-TRACE] canvas-read-success: true, pixelCount: ${pixels.length / 4}`);

    // Convert pixels to 1-bit monochrome raster data (1 = black, 0 = white, MSB first)
    const bytesPerRow = width / 8;
    const rasterBytes = new Uint8Array(bytesPerRow * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const a = pixels[offset + 3];

        // Alpha transparent pixels treated as white (255)
        const luminance = a < 128 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
        const isBlack = luminance < 128;

        if (isBlack) {
          const byteIdx = y * bytesPerRow + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          rasterBytes[byteIdx] |= (1 << bitIdx);
        }
      }
    }

    // Epson ePOS XML expects image content as base64Binary, not hexadecimal text.
    // Build the binary string in chunks to avoid call-stack limits on large logos.
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < rasterBytes.length; i += chunkSize) {
      binary += String.fromCharCode(...rasterBytes.subarray(i, i + chunkSize));
    }
    const base64String = btoa(binary);

    console.log(`[LOGO-TRACE] raster-byte-count: ${rasterBytes.length}`);
    console.log(`[LOGO-TRACE] raster-base64-length: ${base64String.length}`);

    const logoXmlTag = `<image width="${width}" height="${height}" align="${align}" color="color_1">${base64String}</image>&#10;`;
    console.log(`[LOGO-TRACE] xml-image-tag-present: true`);
    console.log(`[LOGO-TRACE] xml-image-data-length: ${logoXmlTag.length}`);

    return logoXmlTag;
  } catch (err) {
    console.warn("[LOGO-TRACE] failure-reason:", err.message);
    return '';
  } finally {
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}

/**
 * Generates the Epson ePOS XML command string driven by JSON template config.
 */
export async function buildReceiptXML(order, storeInput = 'Cashmint', options = {}) {
  const outputType = options.outputType || options.templateType || 'pos_receipt';
  const config = mergeAndEnforceReceiptConfig(options.templateConfig || {}, outputType);
  const store = normalizeStoreInfo(storeInput, config);
  const isKitchen = outputType === 'kitchen_ticket';
  const includeLegacyPaymentSections = options.includeLegacyPaymentSections === true;

  console.log(`[LOGO-TRACE] template-type: ${outputType}`);
  console.log(`[LOGO-TRACE] show-logo: ${Boolean(config.header?.show_logo)}`);
  console.log(`[LOGO-TRACE] normalized-logo-url: ${store.logo_url || '(none)'}`);

  const width = config.paper_width === 58 ? 30 : 40;
  const sepChar = config.styles?.divider_style === 'double' ? '=' : '-';
  const separator = sepChar.repeat(width);
  const doubleSeparator = '='.repeat(width);

  // Determine active language
  const lang = normalizeReceiptLanguage(config.language_mode);

  const t = (key) => getReceiptTranslation(key, lang);
  let xml = '';

  const raw = order.raw_payload || {};
  const items = raw.cart_items || [];
  const subtotal = Number(order.total_amount || 0);
  const subtotalWithoutVat = Number(order.subtotal_excl_vat ?? subtotal);
  const vatAmount = Number(order.vat_amount ?? Math.max(0, subtotal - subtotalWithoutVat));
  const receiptVatRate = raw.vat_rate ?? raw.vatRate ?? order.vat_rate ?? order.vatRate ?? raw.cart_items?.find((item) => item.vat_rate != null || item.vatRate != null)?.vat_rate ?? null;

  // Render sections in configured order
  const sectionsOrder = config.sections_order || ['header', 'meta', 'items', 'subtotals', 'tax_breakdown', 'payments', 'footer'];

  for (const sectionKey of sectionsOrder) {
    switch (sectionKey) {
      case 'header': {
        const align = config.header?.logo_align || 'center';

        // Render Monochrome Thermal Logo for Epson TM-T20IV
        if (config.header?.show_logo && store.logo_url && !isKitchen) {
          const logoXml = await convertLogoToEpsonXML(store.logo_url, align, config.paper_width === 58 ? 256 : 384);
          if (logoXml) {
            xml += logoXml;
          }
        }

        if (config.header?.show_store_name && store.name) {
          xml += `<text align="${align}" font="font_a" em="true">${escapeXML(store.name)}&#10;</text>`;
        }

        if (config.header?.show_legal_name && store.legal_name && store.legal_name !== store.name) {
          xml += `<text align="${align}">${escapeXML(store.legal_name)}&#10;</text>`;
        }
        if (config.header?.show_address && store.address) {
          xml += `<text align="${align}">${escapeXML(store.address)}&#10;</text>`;
        }
        if (config.header?.show_vat_number && store.vat_number) {
          xml += `<text align="${align}">${escapeXML(store.vat_number)}&#10;</text>`;
        }
        if (config.header?.show_phone && store.phone) {
          xml += `<text align="${align}">Tel: ${escapeXML(store.phone)}&#10;</text>`;
        }

        if (config.header?.custom_lines && Array.isArray(config.header.custom_lines)) {
          config.header.custom_lines.forEach(line => {
            if (line && line.trim()) {
              xml += `<text align="${align}">${escapeXML(line.trim())}&#10;</text>`;
            }
          });
        }
        if (config.header?.show_store_name || config.header?.show_legal_name || (config.header?.custom_lines && config.header.custom_lines.length > 0)) {
          xml += `<text align="center">${separator}&#10;</text>`;
        }
        break;
      }

      case 'meta': {
        if (isKitchen) {
          // Large prominent order type & table header for kitchen
          const orderType = raw.order_type || 'takeaway';
          const typeLabel = orderType === 'takeaway' ? t('takeaway') : orderType === 'dine_in' ? t('dine_in') : t('delivery');
          xml += `<text align="center" font="font_a" em="true" dw="true" dh="true">${escapeXML(typeLabel)}&#10;</text>`;

          if (raw.table_number) {
            xml += `<text align="center" font="font_a" em="true">${escapeXML(t('table'))}: ${escapeXML(raw.table_number)}&#10;</text>`;
          }
          xml += `<text align="center">${doubleSeparator}&#10;</text>`;
        }

        const receiptNum = order.receipt_number || (order.id ? order.id.substring(0, 8) : 'NEW');
        if (config.meta?.show_receipt_number) {
          xml += `<text align="left">${escapeXML(t('receipt_num'))}: ${escapeXML(receiptNum)}&#10;</text>`;
        }
        if (config.meta?.show_order_id && order.id && order.id.substring(0, 8) !== receiptNum) {
          xml += `<text align="left">${escapeXML(t('order_num'))}: ${escapeXML(order.id.substring(0, 8))}&#10;</text>`;
        }

        if (config.meta?.show_timestamp) {
          const dateStr = raw.timestamp
            ? new Date(raw.timestamp).toLocaleString(lang === 'ar' ? 'ar-BE' : lang === 'fr' ? 'fr-BE' : lang === 'nl' ? 'nl-BE' : 'en-BE')
            : new Date().toLocaleString(lang === 'ar' ? 'ar-BE' : lang === 'fr' ? 'fr-BE' : lang === 'nl' ? 'nl-BE' : 'en-BE');
          xml += `<text align="left">${escapeXML(t('date'))}: ${escapeXML(dateStr)}&#10;</text>`;
        }

        if (!isKitchen && config.meta?.show_order_type) {
          const orderType = raw.order_type || 'takeaway';
          const typeLabel = orderType === 'takeaway' ? t('takeaway') : orderType === 'dine_in' ? t('dine_in') : t('delivery');
          xml += `<text align="left">${escapeXML(t('type'))}: ${escapeXML(typeLabel)}&#10;</text>`;
        }

        if (config.meta?.show_cashier_name && raw.cashier_name) {
          xml += `<text align="left">${escapeXML(t('cashier'))}: ${escapeXML(raw.cashier_name)}&#10;</text>`;
        }

        if (!isKitchen && config.meta?.show_table_number && raw.table_number) {
          xml += `<text align="left">${escapeXML(t('table'))}: ${escapeXML(raw.table_number)}&#10;</text>`;
        }

        if (config.meta?.show_customer_info && raw.customer_name) {
          xml += `<text align="left">${escapeXML(t('customer'))}: ${escapeXML(raw.customer_name)}&#10;</text>`;
        }

        xml += `<text align="left">${separator}&#10;</text>`;
        break;
      }

      case 'items': {
        const showPrices = config.items?.show_prices !== false;
        if (showPrices) {
          xml += `<text align="left" em="true">${escapeXML(formatLine(t('item'), t('price'), width))}&#10;</text>`;
        } else {
          xml += `<text align="left" em="true">${escapeXML(t('item'))}&#10;</text>`;
        }
        xml += `<text align="left">${separator}&#10;</text>`;

        items.forEach(item => {
          const leftPart = `${item.quantity}x ${getLocalizedReceiptText(item, lang)}`;
          if (showPrices) {
            const rightPart = `${parseFloat(item.price * item.quantity).toFixed(2)} EUR`;
            xml += `<text align="left" ${isKitchen ? 'em="true"' : ''}>${escapeXML(formatLine(leftPart, rightPart, width))}&#10;</text>`;
          } else {
            xml += `<text align="left" font="font_a" em="true">${escapeXML(leftPart)}&#10;</text>`;
          }
          if (item.description) {
            xml += `<text align="left">${escapeXML(`  ${item.description}`)}&#10;</text>`;
          }

          if (config.items?.show_modifiers && item.modifiers && item.modifiers.length > 0) {
            item.modifiers.forEach(mod => {
              const modLeft = `  + ${getLocalizedReceiptText(mod, lang)}`;
              if (showPrices && mod.price_adjustment) {
                const modRight = `+${parseFloat(mod.price_adjustment * item.quantity).toFixed(2)} EUR`;
                xml += `<text align="left">${escapeXML(formatLine(modLeft, modRight, width))}&#10;</text>`;
              } else {
                xml += `<text align="left" em="true">${escapeXML(modLeft)}&#10;</text>`;
              }
            });
          }
        });

        xml += `<text align="left">${separator}&#10;</text>`;
        break;
      }

      case 'subtotals': {
        if (!isKitchen) {
          xml += `<text align="left">${escapeXML(formatLine(t('subtotal') + ':', `${subtotalWithoutVat.toFixed(2)} EUR`, width))}&#10;</text>`;
          xml += `<text align="left">${escapeXML(formatLine(t('vat') + ':', `${vatAmount.toFixed(2)} EUR`, width))}&#10;</text>`;
          xml += `<text align="left" em="true">${escapeXML(formatLine(t('total') + ':', `${subtotal.toFixed(2)} EUR`, width))}&#10;</text>`;
          xml += `<text align="center">${separator}&#10;</text>`;
        }
        break;
      }

      case 'tax_breakdown': {
        if (!isKitchen && config.tax_breakdown?.show_detailed_rates) {
          xml += `<text align="left" em="true">${escapeXML(t('vat_breakdown'))}&#10;</text>`;
          xml += `<text align="left">${escapeXML(formatLine(`${t('vat_rate')} | ${t('vat_net')}`, t('vat_tax'), width))}&#10;</text>`;
          const rateLabel = receiptVatRate == null ? '—' : `${receiptVatRate}%`;
          xml += `<text align="left">${escapeXML(formatLine(`${rateLabel} | ${subtotalWithoutVat.toFixed(2)} EUR`, `${vatAmount.toFixed(2)} EUR`, width))}&#10;</text>`;
          xml += `<text align="center">${separator}&#10;</text>`;
        }
        break;
      }

      case 'payments': {
        if (!isKitchen && config.payments?.show_payment_method) {
          const payMethod = getLocalizedReceiptPayment(raw.payment_label || order.payment_method, lang);
          xml += `<text align="left">${escapeXML(formatLine(t('payment') + ':', payMethod, width))}&#10;</text>`;
        }
        if (!isKitchen && config.payments?.show_change_due && raw.change_due !== undefined) {
          xml += `<text align="left">${escapeXML(formatLine(t('change') + ':', `${parseFloat(raw.change_due || 0).toFixed(2)} EUR`, width))}&#10;</text>`;
        }
        if (!isKitchen) {
          xml += `<text align="center">${doubleSeparator}&#10;</text>`;
        }
        break;
      }

      case 'footer': {
        if (config.footer?.custom_lines && Array.isArray(config.footer.custom_lines)) {
          config.footer.custom_lines.forEach(line => {
            if (line && line.trim()) {
              xml += `<text align="center" ${isKitchen ? 'em="true"' : ''}>${escapeXML(line.trim())}&#10;</text>`;
            }
          });
        } else if (!isKitchen) {
          xml += `<text align="center">${escapeXML(t('thank_you'))}&#10;</text>`;
        }
        break;
      }

      default:
        break;
    }
  }
  // Payment Label/Method if present
  if (includeLegacyPaymentSections && order.raw_payload?.payment_splits) {
    xml += `<text align="left">طريقة الدفع / Payment: دفع مجزأ / Split Payment&#10;</text>`;
    xml += `<text align="left">${escapeXML(formatLine('  نقداً / Cash:', `${parseFloat(order.raw_payload.payment_splits.cash_amount || 0).toFixed(2)} EUR`, width))}&#10;</text>`;
    xml += `<text align="left">${escapeXML(formatLine('  بطاقة / Card:', `${parseFloat(order.raw_payload.payment_splits.card_amount || 0).toFixed(2)} EUR`, width))}&#10;</text>`;
    xml += `<text align="left">${escapeXML(formatLine('  إجمالي المدفوع / Total Paid:', `${subtotal.toFixed(2)} EUR`, width))}&#10;</text>`;
    xml += `<text align="left">${separator}&#10;</text>`;
  } else if (includeLegacyPaymentSections && order.raw_payload?.payment_label) {
    const escapedPaymentLabel = escapeXML(order.raw_payload.payment_label);
    xml += `<text align="left">طريقة الدفع / Payment: ${escapedPaymentLabel}&#10;</text>`;
    xml += `<text align="left">${separator}&#10;</text>`;
  }

  xml += `<feed line="3"/>`;
  xml += `<cut type="feed"/>`;

  return xml;
}

/**
 * Fallback silent receipt printing using a hidden iframe and browser print engine.
 * Renders structured layout matching the receipt configuration schema and header branding overrides.
 */
export function printViaIframeFallback(order, storeInput = 'Cashmint', options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const outputType = options.outputType || options.templateType || 'pos_receipt';
      const config = mergeAndEnforceReceiptConfig(options.templateConfig || {}, outputType);
      const store = normalizeStoreInfo(storeInput, config);
      const isKitchen = outputType === 'kitchen_ticket';
      const cssWidth = config.paper_width === 58 ? '54mm' : '72mm';

      const lang = normalizeReceiptLanguage(config.language_mode);

      const t = (key) => getReceiptTranslation(key, lang);
      const isRtl = lang === 'ar';

      // Create hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const raw = order.raw_payload || {};
      const items = raw.cart_items || [];
      const subtotal = Number(order.total_amount || 0);
      const subtotalWithoutVat = Number(order.subtotal_excl_vat ?? subtotal);
      const vatAmount = Number(order.vat_amount ?? Math.max(0, subtotal - subtotalWithoutVat));
      const receiptVatRate = raw.vat_rate ?? raw.vatRate ?? order.vat_rate ?? order.vatRate ?? raw.cart_items?.find((item) => item.vat_rate != null || item.vatRate != null)?.vat_rate ?? null;

      let bodyHtml = '';
      const sectionsOrder = config.sections_order || ['header', 'meta', 'items', 'subtotals', 'tax_breakdown', 'payments', 'footer'];

      sectionsOrder.forEach((sectionKey) => {
        switch (sectionKey) {
          case 'header': {
            const align = config.header?.logo_align || 'center';
            bodyHtml += `<div style="text-align: ${align};">`;
            if (config.header?.show_logo && store.logo_url) {
              bodyHtml += `<div style="text-align: ${align}; margin-bottom: 6px;">
                <img src="${store.logo_url}" style="max-width: 80px; max-height: 80px; filter: grayscale(100%); object-fit: contain;" />
              </div>`;
            }
            if (config.header?.show_store_name && store.name) {
              bodyHtml += `<div className="header-title" style="font-size: 15px; font-weight: bold;">${store.name}</div>`;
            }
            if (config.header?.show_legal_name && store.legal_name && store.legal_name !== store.name) {
              bodyHtml += `<div>${store.legal_name}</div>`;
            }
            if (config.header?.show_address && store.address) {
              bodyHtml += `<div>${store.address}</div>`;
            }
            if (config.header?.show_vat_number && store.vat_number) {
              bodyHtml += `<div>${store.vat_number}</div>`;
            }
            if (config.header?.show_phone && store.phone) {
              bodyHtml += `<div>Tel: ${store.phone}</div>`;
            }
            if (config.header?.custom_lines && Array.isArray(config.header.custom_lines)) {
              config.header.custom_lines.forEach(l => {
                if (l && l.trim()) bodyHtml += `<div>${l.trim()}</div>`;
              });
            }
            bodyHtml += `</div>`;
            if (config.header?.show_store_name || config.header?.show_legal_name || (config.header?.custom_lines && config.header.custom_lines.length > 0)) {
              bodyHtml += `<div class="divider"></div>`;
            }
            break;
          }

          case 'meta': {
            const receiptNum = order.receipt_number || (order.id ? order.id.substring(0, 8) : 'NEW');
            bodyHtml += `<div>`;

            if (isKitchen) {
              const orderType = raw.order_type || 'takeaway';
              const typeLabel = orderType === 'takeaway' ? t('takeaway') : orderType === 'dine_in' ? t('dine_in') : t('delivery');
              bodyHtml += `<div style="font-size: 18px; font-weight: 900; text-align: center; text-transform: uppercase;">${typeLabel}</div>`;
              if (raw.table_number) {
                bodyHtml += `<div style="font-size: 14px; font-weight: bold; text-align: center;">${t('table')}: ${raw.table_number}</div>`;
              }
              bodyHtml += `<div class="double-divider"></div>`;
            }

            if (config.meta?.show_receipt_number) {
              bodyHtml += `<div>${t('receipt_num')}: ${receiptNum}</div>`;
            }
            if (config.meta?.show_order_id && order.id && order.id.substring(0, 8) !== receiptNum) {
              bodyHtml += `<div>${t('order_num')}: ${order.id.substring(0, 8)}</div>`;
            }
            if (config.meta?.show_timestamp) {
              const dateStr = raw.timestamp
                ? new Date(raw.timestamp).toLocaleString(lang === 'ar' ? 'ar-BE' : lang === 'fr' ? 'fr-BE' : lang === 'nl' ? 'nl-BE' : 'en-BE')
                : new Date().toLocaleString(lang === 'ar' ? 'ar-BE' : lang === 'fr' ? 'fr-BE' : lang === 'nl' ? 'nl-BE' : 'en-BE');
              bodyHtml += `<div>${t('date')}: ${dateStr}</div>`;
            }
            if (!isKitchen && config.meta?.show_order_type) {
              const orderType = raw.order_type || 'takeaway';
              const typeLabel = orderType === 'takeaway' ? t('takeaway') : orderType === 'dine_in' ? t('dine_in') : t('delivery');
              bodyHtml += `<div>${t('type')}: ${typeLabel}</div>`;
            }
            if (config.meta?.show_cashier_name && raw.cashier_name) {
              bodyHtml += `<div>${t('cashier')}: ${raw.cashier_name}</div>`;
            }
            if (!isKitchen && config.meta?.show_table_number && raw.table_number) {
              bodyHtml += `<div>${t('table')}: ${raw.table_number}</div>`;
            }
            bodyHtml += `</div><div class="divider"></div>`;
            break;
          }

          case 'items': {
            const showPrices = config.items?.show_prices !== false;
            bodyHtml += `
              <div class="item-row" style="font-weight: bold;">
                <span class="item-name">${t('item')}</span>
                ${showPrices ? `<span class="item-price">${t('price')}</span>` : ''}
              </div>
              <div class="divider"></div>
            `;

            items.forEach(item => {
              const itemTotal = parseFloat(item.price * item.quantity).toFixed(2);
              bodyHtml += `
                <div class="item-row" style="${isKitchen ? 'font-size: 15px; font-weight: bold; margin-bottom: 2px;' : ''}">
                  <span class="item-name">${item.quantity}x ${getLocalizedReceiptText(item, lang)}</span>
                  ${showPrices ? `<span class="item-price">${itemTotal} EUR</span>` : ''}
                </div>
              `;
              if (item.description) {
                bodyHtml += `<div class="modifier-row">${escapeHTML(`  ${item.description}`)}</div>`;
              }

              if (config.items?.show_modifiers && item.modifiers && item.modifiers.length > 0) {
                item.modifiers.forEach(mod => {
                  const modAdjustment = parseFloat(mod.price_adjustment * item.quantity).toFixed(2);
                  bodyHtml += `
                    <div class="modifier-row" style="${isKitchen ? 'font-size: 12px; font-weight: bold; color: #000;' : ''}">
                      <span>  + ${getLocalizedReceiptText(mod, lang)}</span>
                      ${showPrices && mod.price_adjustment ? `<span>+${modAdjustment} EUR</span>` : ''}
                    </div>
                  `;
                });
              }
            });

            bodyHtml += `<div class="divider"></div>`;
            break;
          }

          case 'subtotals': {
            if (!isKitchen) {
              bodyHtml += `
                <div class="item-row">
                  <span>${t('subtotal')}:</span>
                  <span>${subtotalWithoutVat.toFixed(2)} EUR</span>
                </div>
                <div class="item-row">
                  <span>${t('vat')}:</span>
                  <span>${vatAmount.toFixed(2)} EUR</span>
                </div>
                <div class="total-row">
                  <span>${t('total')}:</span>
                  <span>${parseFloat(subtotal).toFixed(2)} EUR</span>
                </div>
                <div class="divider"></div>
              `;
            }
            break;
          }

          case 'tax_breakdown': {
            if (!isKitchen && config.tax_breakdown?.show_detailed_rates) {
              const rateLabel = receiptVatRate == null ? '—' : `${receiptVatRate}%`;
              bodyHtml += `
                <div style="font-weight: bold; margin-bottom: 3px;">${t('vat_breakdown')}</div>
                <div class="item-row" style="font-size: 11px;">
                  <span>${rateLabel} | ${subtotalWithoutVat.toFixed(2)} EUR</span>
                  <span>${vatAmount.toFixed(2)} EUR</span>
                </div>
                <div class="divider"></div>
              `;
            }
            break;
          }

          case 'payments': {
            if (!isKitchen && config.payments?.show_payment_method) {
              const payMethod = getLocalizedReceiptPayment(raw.payment_label || order.payment_method, lang);
              bodyHtml += `
                <div class="item-row">
                  <span>${t('payment')}:</span>
                  <span>${payMethod}</span>
                </div>
              `;
            }
            if (!isKitchen && config.payments?.show_change_due && raw.change_due !== undefined) {
              bodyHtml += `
                <div class="item-row">
                  <span>${t('change')}:</span>
                  <span>${parseFloat(raw.change_due || 0).toFixed(2)} EUR</span>
                </div>
              `;
            }
            if (!isKitchen) {
              bodyHtml += `<div class="double-divider"></div>`;
            }
            break;
          }

          case 'footer': {
            bodyHtml += `<div class="text-center" style="${isKitchen ? 'font-weight: bold;' : ''}">`;
            if (config.footer?.custom_lines && Array.isArray(config.footer.custom_lines)) {
              config.footer.custom_lines.forEach(l => {
                if (l && l.trim()) bodyHtml += `<div>${l.trim()}</div>`;
              });
            } else if (!isKitchen) {
              bodyHtml += `<div>${t('thank_you')}</div>`;
            }
            bodyHtml += `</div>`;
            break;
          }

          default:
            break;
        }
      });

      const fullHtml = `
<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><title>Receipt Print</title></head>
<body style="direction: ${isRtl ? 'rtl' : 'ltr'}; text-align: ${isRtl ? 'right' : 'left'};">
  ${bodyHtml}
</body>
</html>`;

      const legacyFullHtml = `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>Receipt Print</title>
  <style>
    @media print {
      body { margin: 0; padding: 0; }
    }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 1.4;
      width: ${cssWidth};
      margin: 0 auto;
      padding: 5px;
      color: #000;
      direction: ${isRtl ? 'rtl' : 'ltr'};
      text-align: ${isRtl ? 'right' : 'left'};
    }
    .text-center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .double-divider { border-top: 2px double #000; margin: 6px 0; }
    .item-row { display: flex; justify-content: space-between; }
    .item-name { flex: 1; }
    .item-price { min-width: 70px; text-align: ${isRtl ? 'left' : 'right'}; }
    .modifier-row { display: flex; justify-content: space-between; font-size: 10px; color: #444; }
    .total-row { display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; margin-top: 4px; }
  </style>
</head>
<body>
  ${bodyHtml}
  <div class="text-center header-title">${storeName}</div>
  <div class="text-center">نظام نقاط البيع / POS System</div>
  <div class="double-divider"></div>
  
  <div>رقم الطلب / Order: ${order.id ? order.id.substring(0, 8) : 'NEW'}</div>
  <div>التاريخ / Date: ${dateStr}</div>
  <div>نوع الطلب / Type: ${typeLabel}</div>
  <div class="divider"></div>
  
  <div class="item-row" style="font-weight: bold;">
    <span class="item-name">العنصر / Item</span>
    <span class="item-price">السعر / Price</span>
  </div>
  <div class="divider"></div>
`;

      items.forEach(item => {
        const itemTotal = parseFloat(item.price * item.quantity).toFixed(2);
        html += `
  <div class="item-row">
    <span class="item-name">${item.name} x${item.quantity}</span>
    <span class="item-price">${itemTotal} EUR</span>
  </div>
`;

        if (item.modifiers && item.modifiers.length > 0) {
          item.modifiers.forEach(mod => {
            const modAdjustment = parseFloat(mod.price_adjustment * item.quantity).toFixed(2);
            html += `
  <div class="modifier-row">
    <span>  + ${mod.name}</span>
    <span>+${modAdjustment} EUR</span>
  </div>
`;
          });
        }
      });

      let paymentHtml = '';
      if (order.raw_payload?.payment_splits) {
        paymentHtml = `
  <div class="item-row" style="font-weight: bold;">
    <span>طريقة الدفع / Payment:</span>
    <span>دفع مجزأ / Split Payment</span>
  </div>
  <div class="item-row" style="font-size: 11px;">
    <span>  - نقداً / Cash:</span>
    <span>${parseFloat(order.raw_payload.payment_splits.cash_amount || 0).toFixed(2)} EUR</span>
  </div>
  <div class="item-row" style="font-size: 11px;">
    <span>  - بطاقة / Card:</span>
    <span>${parseFloat(order.raw_payload.payment_splits.card_amount || 0).toFixed(2)} EUR</span>
  </div>
  <div class="divider"></div>
`;
      } else if (order.raw_payload?.payment_label) {
        paymentHtml = `
  <div class="item-row">
    <span>طريقة الدفع / Payment:</span>
    <span>${order.raw_payload.payment_label}</span>
  </div>
  <div class="divider"></div>
`;
      }

      html += `
  <div class="divider"></div>
  ${paymentHtml}
  <div class="item-row">
    <span>المجموع الفرعي / Subtotal:</span>
    <span>${subtotalWithoutVat.toFixed(2)} EUR</span>
  </div>
  <div class="item-row">
    <span>${t('vat')}:</span>
    <span>${vatAmount.toFixed(2)} EUR</span>
  </div>
  <div class="total-row">
    <span>المجموع الكلي / TOTAL:</span>
    <span>${parseFloat(subtotal).toFixed(2)} EUR</span>
  </div>
  <div class="double-divider"></div>
  <div class="text-center">شكراً لزيارتكم! / Thank you for your visit!</div>
  
  <script>
    window.onload = function() {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>
`;

      const doc = iframe.contentWindow.document;
      void legacyFullHtml;
      doc.open();
      doc.write(fullHtml);
      doc.close();

      setTimeout(() => {
        if (iframe && iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
        resolve({ success: true, fallback: true });
      }, 1500);

    } catch (err) {
      console.error("Fallback print error:", err);
      reject(err);
    }
  });
}

/**
 * Epson Error Code Translations.
 */
export const EPSON_ERROR_TRANSLATIONS = {
  'EX_BADPORT': { en: 'Bad interface port specified.', ar: 'منفذ الاتصال المحدد غير صالح.' },
  'EX_TIMEOUT': { en: 'Connection timeout. Check printer power and network.', ar: 'انتهت مهلة الاتصال. تحقق من تشغيل الطابعة وتوصيل الشبكة.' },
  'EPTR_AUTOCUTTER': { en: 'Autocutter error. Paper might be jammed.', ar: 'خطأ في القاطع التلقائي. قد يكون هناك انحشار للورق.' },
  'EPTR_COVER_OPEN': { en: 'Printer cover is open. Please close it.', ar: 'غطاء الطابعة مفتوح. يرجى إغلاقه.' },
  'EPTR_EMPTY': { en: 'Printer is offline or empty.', ar: 'الطابعة غير متصلة أو فارغة.' },
  'EPTR_REC_EMPTY': { en: 'Out of paper. Please load a new roll.', ar: 'ورق الطباعة فارغ. يرجى تركيب رول ورق جديد.' },
  'EXT_DEV_NOT_FOUND': { en: 'Local printer device not found.', ar: 'لم يتم العثور على الطابعة المحلية.' },
  'EPTR_UNRECOVERABLE': { en: 'Unrecoverable printer hardware error.', ar: 'حدث خطأ غير قابل للاسترداد في عتاد الطابعة.' }
};

export function getFriendlyEpsonError(code, isArabic = true) {
  const trans = EPSON_ERROR_TRANSLATIONS[code];
  if (trans) return isArabic ? trans.ar : trans.en;
  return isArabic ? `خطأ في الطابعة (${code})` : `Printer Error (${code})`;
}

/**
 * Main Print Receipt Entrypoint.
 */
export async function printReceipt(order, printerIP, storeInput = 'Cashmint', options = {}) {
  const cleanIP = printerIP ? printerIP.trim() : '';

  if (!cleanIP) {
    if (options.skipFallback) {
      return {
        success: false,
        transport: "epos",
        endpoint: "",
        error: options.isArabic !== false ? "عنوان IP للطابعة غير مهيأ" : "Printer IP not configured"
      };
    }
    console.warn("No printer IP configured. Triggering fallback browser printing.");
    try {
      const res = await printViaIframeFallback(order, storeInput, options);
      return res;
    } catch (err) {
      return { success: false, transport: "iframe", endpoint: "", error: err.message };
    }
  }

  const endpoint = `https://${cleanIP}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;

  let xmlContent = '';
  if (options.minimalTest) {
    xmlContent = `<text align="center">CASHMINT TEST&#10;</text>
<text>Printer connection is working.&#10;</text>
<feed line="3"/>
<cut type="feed"/>`;
  } else {
    xmlContent = await buildReceiptXML(order, storeInput, options);
  }

  console.log("[LOGO DEBUG] generated XML contains image tag or not:", xmlContent.includes('<image'));

  const soapPayload = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
      ${xmlContent}
    </epos-print>
  </s:Body>
</s:Envelope>`;

  console.log("🖨️ [PRINTER-SERVICE] OutputType:", options.outputType || 'pos_receipt', "| Target IP:", cleanIP);
  console.log("🖨️ [PRINTER-SERVICE] Generated XML Length:", xmlContent.length, "bytes | SOAP Payload Length:", soapPayload.length, "bytes");

  const isDebug = true; // Always output debug traces to diagnose printing
  if (isDebug) {
    console.log("🖨️ [PRINTER-SERVICE] ePOS Endpoint:", endpoint);
    console.log("🖨️ [PRINTER-SERVICE] ePOS SOAP Payload:\n", soapPayload);
  }

  let response;
  let responseText = '';

  try {
    addDiagnosticLog({
      type: '[EPSON-TRACE]',
      step: 'epos-send-start',
      success: true,
      metadata: { endpoint, payloadLength: soapPayload.length, outputType: options.outputType || 'pos_receipt' }
    });

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '""'
      },
      body: soapPayload
    });

    responseText = await response.text();
    console.log("[LOGO-TRACE] Epson-response:", responseText);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(responseText, "text/xml");
    const faultTag = xmlDoc.getElementsByTagName('Fault')[0] || xmlDoc.getElementsByTagName('detail')[0];
    if (faultTag) {
      const faultString = xmlDoc.getElementsByTagName('faultstring')[0]?.textContent || "SOAP Fault";
      throw new Error(faultString);
    }

    const responseTag = xmlDoc.getElementsByTagName('response')[0];
    if (!responseTag) {
      throw new Error("Invalid XML response format received from printer");
    }

    const successAttr = responseTag.getAttribute('success');
    const codeAttr = responseTag.getAttribute('code');

    if (successAttr === 'true' || successAttr === '1') {
      addDiagnosticLog({
        type: '[EPSON-TRACE]',
        step: 'epos-response-success',
        success: true,
        status: response.status,
        code: codeAttr || 'OK',
        transport: 'epos',
        metadata: { successAttr }
      });
      return {
        success: true,
        transport: "epos",
        endpoint: endpoint,
        status: response.status,
        response: responseText,
        code: codeAttr || undefined
      };
    } else {
      const errorMsg = getFriendlyEpsonError(codeAttr, options.isArabic !== false);
      const err = new Error(errorMsg);
      err.code = codeAttr;
      throw err;
    }
  } catch (error) {
    addDiagnosticLog({
      type: '[EPSON-TRACE]',
      step: 'epos-response-error',
      success: false,
      status: response ? response.status : null,
      code: error.code || 'FETCH_ERROR',
      transport: 'epos',
      error: error.message
    });

    if (isDebug) {
      console.error("ePOS Direct Connection Error:", error);
    }

    if (options.skipFallback) {
      return {
        success: false,
        transport: "epos",
        endpoint: endpoint,
        status: response ? response.status : undefined,
        response: responseText || undefined,
        code: error.code || undefined,
        error: error.message
      };
    }

    console.warn("Direct ePOS-Print failed. Falling back to browser iframe printing...", error);
    try {
      const fallbackRes = await printViaIframeFallback(order, storeInput, options);
      return fallbackRes;
    } catch (fallbackError) {
      return {
        success: false,
        transport: "epos",
        endpoint: endpoint,
        status: response ? response.status : undefined,
        response: responseText || undefined,
        error: `Direct connection failed (${error.message}) & Fallback print failed (${fallbackError.message})`
      };
    }
  }
}
