/**
 * Printer Service for Epson TM-T20IV
 * Sends raw XML print commands to the local printer IP using ePOS-Print XML API.
 */

/**
 * Format string line with left and right aligned parts to fit printer paper width.
 */
function formatLine(left, right, width = 40) {
  const leftStr = String(left);
  const rightStr = String(right);
  const spaceNeeded = width - (leftStr.length + rightStr.length);
  if (spaceNeeded > 0) {
    return leftStr + ' '.repeat(spaceNeeded) + rightStr;
  }
  return leftStr.substring(0, width - rightStr.length - 1) + ' ' + rightStr;
}

/**
 * Safe XML escaper for user-provided texts.
 * Only escapes standard entities (&, <, >, ", '), leaving other chars (like Arabic) intact.
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

/**
 * Generates the Epson ePOS XML command string.
 */
export function buildReceiptXML(order, storeName) {
  const width = 40; // TM-T20IV standard column width
  const separator = '-'.repeat(width);
  const doubleSeparator = '='.repeat(width);

  let xml = '';

  // 1. Center alignment for the Store Name (dynamic from the tenant session)
  const escapedStoreName = escapeXML(storeName || 'Cashmint');
  xml += `<text align="center">${escapedStoreName}&#10;</text>`;
  xml += `<text align="center">نظام نقاط البيع / POS System&#10;</text>`;
  xml += `<text align="center">${doubleSeparator}&#10;</text>`;

  // Order meta info
  const dateStr = order.raw_payload?.timestamp 
    ? new Date(order.raw_payload.timestamp).toLocaleString('ar-BE') 
    : new Date().toLocaleString('ar-BE');
  
  const escapedOrderId = escapeXML(order.id ? order.id.substring(0, 8) : 'NEW');
  const orderType = order.raw_payload?.order_type || 'takeaway';
  const typeLabel = orderType === 'takeaway' 
    ? 'سفري / Takeaway' 
    : orderType === 'dine_in' 
      ? 'محلي / Dine In' 
      : 'توصيل / Delivery';
  const escapedTypeLabel = escapeXML(typeLabel);

  xml += `<text align="left">رقم الطلب / Order: ${escapedOrderId}&#10;</text>`;
  xml += `<text align="left">التاريخ / Date: ${escapeXML(dateStr)}&#10;</text>`;
  xml += `<text align="left">نوع الطلب / Type: ${escapedTypeLabel}&#10;</text>`;

  // Cashier Name if present
  if (order.raw_payload?.cashier_name) {
    const escapedCashier = escapeXML(order.raw_payload.cashier_name);
    xml += `<text align="left">الكاشير / Cashier: ${escapedCashier}&#10;</text>`;
  }

  // Coupon Code if present
  if (order.raw_payload?.coupon_code) {
    const escapedCoupon = escapeXML(order.raw_payload.coupon_code);
    xml += `<text align="left">كود الخصم / Coupon: ${escapedCoupon}&#10;</text>`;
  }

  xml += `<text align="left">${separator}&#10;</text>`;

  // 2. Left alignment for order items (Item Name, Qty, Price)
  xml += `<text align="left">${escapeXML(formatLine('العنصر / Item', 'السعر / Price', width))}&#10;</text>`;
  xml += `<text align="left">${separator}&#10;</text>`;

  const items = order.raw_payload?.cart_items || [];
  items.forEach(item => {
    const leftPart = `${item.name} x${item.quantity}`;
    const rightPart = `${parseFloat(item.price * item.quantity).toFixed(2)} EUR`;
    xml += `<text align="left">${escapeXML(formatLine(leftPart, rightPart, width))}&#10;</text>`;

    // Modifiers if any
    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach(mod => {
        const modLeft = `  + ${mod.name}`;
        const modRight = `+${parseFloat(mod.price_adjustment * item.quantity).toFixed(2)} EUR`;
        xml += `<text align="left">${escapeXML(formatLine(modLeft, modRight, width))}&#10;</text>`;
      });
    }
  });

  xml += `<text align="left">${separator}&#10;</text>`;

  // 3. Separator lines, Subtotal, VAT, and Final Total
  const subtotal = Number(order.total_amount || 0);
  const vatAmount = Number(order.vat_amount ?? (subtotal * (0.12 / 1.12)));
  const subtotalWithoutVat = Number(order.subtotal_excl_vat ?? (subtotal - vatAmount));

  // Payment Label/Method if present
  if (order.raw_payload?.payment_splits) {
    xml += `<text align="left">طريقة الدفع / Payment: دفع مجزأ / Split Payment&#10;</text>`;
    xml += `<text align="left">${escapeXML(formatLine('  نقداً / Cash:', `${parseFloat(order.raw_payload.payment_splits.cash_amount || 0).toFixed(2)} EUR`, width))}&#10;</text>`;
    xml += `<text align="left">${escapeXML(formatLine('  بطاقة / Card:', `${parseFloat(order.raw_payload.payment_splits.card_amount || 0).toFixed(2)} EUR`, width))}&#10;</text>`;
    xml += `<text align="left">${escapeXML(formatLine('  إجمالي المدفوع / Total Paid:', `${subtotal.toFixed(2)} EUR`, width))}&#10;</text>`;
    xml += `<text align="left">${separator}&#10;</text>`;
  } else if (order.raw_payload?.payment_label) {
    const escapedPaymentLabel = escapeXML(order.raw_payload.payment_label);
    xml += `<text align="left">طريقة الدفع / Payment: ${escapedPaymentLabel}&#10;</text>`;
    xml += `<text align="left">${separator}&#10;</text>`;
  }

  xml += `<text align="left">${escapeXML(formatLine('المجموع الفرعي / Subtotal:', `${subtotalWithoutVat.toFixed(2)} EUR`, width))}&#10;</text>`;
  xml += `<text align="left">${escapeXML(formatLine('ضريبة القيمة المضافة / VAT (12%):', `${vatAmount.toFixed(2)} EUR`, width))}&#10;</text>`;
  
  // Total line uses double size formatting (temporarily using plain text with standard width)
  const totalText = formatLine('المجموع الكلي / TOTAL:', `${subtotal.toFixed(2)} EUR`, width);
  xml += `<text align="left">${escapeXML(totalText)}&#10;</text>`;
  
  xml += `<text align="center">${doubleSeparator}&#10;</text>`;
  xml += `<text align="center">شكراً لزيارتكم! / Thank you for your visit!&#10;</text>`;
  
  // Extra feed space
  xml += `<feed line="3"/>`;

  // 5. Paper cut command
  xml += `<cut type="feed"/>`;

  return xml;
}


/**
 * Fallback silent receipt printing using a hidden iframe and browser print engine.
 * Renders a clean 76mm receipt layout with full Arabic support.
 */
export function printViaIframeFallback(order, storeName = 'Cashmint') {
  return new Promise((resolve, reject) => {
    try {
      // Create hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const items = order.raw_payload?.cart_items || [];
      const subtotal = Number(order.total_amount || 0);
      const vatAmount = Number(order.vat_amount ?? (subtotal * (0.12 / 1.12)));
      const subtotalWithoutVat = Number(order.subtotal_excl_vat ?? (subtotal - vatAmount));

      const dateStr = order.raw_payload?.timestamp 
        ? new Date(order.raw_payload.timestamp).toLocaleString('ar-BE') 
        : new Date().toLocaleString('ar-BE');
        
      const orderType = order.raw_payload?.order_type || 'takeaway';
      const typeLabel = orderType === 'takeaway' 
        ? 'سفري / Takeaway' 
        : orderType === 'dine_in' 
          ? 'محلي / Dine In' 
          : 'توصيل / Delivery';

      let html = `
<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="UTF-8">
  <title>Receipt Print Fallback</title>
  <style>
    @media print {
      body {
        margin: 0;
        padding: 0;
      }
    }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 1.4;
      width: 72mm;
      margin: 0 auto;
      padding: 5px;
      color: #000;
      direction: rtl;
      text-align: right;
    }
    .text-center { text-align: center; }
    .text-left { text-align: left; }
    .text-right { text-align: right; }
    .divider {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .double-divider {
      border-top: 2px double #000;
      margin: 6px 0;
    }
    .item-row {
      display: flex;
      justify-content: space-between;
    }
    .item-name {
      flex: 1;
      text-align: right;
    }
    .item-price {
      text-align: left;
      min-width: 80px;
    }
    .modifier-row {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      padding-right: 12px;
      color: #555;
    }
    .header-title {
      font-size: 15px;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      font-weight: bold;
      margin-top: 5px;
    }
  </style>
</head>
<body>
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
    <span>ضريبة القيمة المضافة / VAT (12%):</span>
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
      doc.open();
      doc.write(html);
      doc.close();

      // Resolve successfully, cleaning up iframe after print dialog is triggered
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
 * Epson ePOS-Print API Error Codes and Translations.
 */
export const EPSON_ERROR_TRANSLATIONS = {
  'EX_BADPORT': {
    en: 'Bad interface port specified.',
    ar: 'منفذ الاتصال المحدد غير صالح.'
  },
  'EX_TIMEOUT': {
    en: 'Connection timeout. Check printer power and network.',
    ar: 'انتهت مهلة الاتصال. تحقق من تشغيل الطابعة وتوصيل الشبكة.'
  },
  'EPTR_AUTOCUTTER': {
    en: 'Autocutter error. Paper might be jammed.',
    ar: 'خطأ في القاطع التلقائي. قد يكون هناك انحشار للورق.'
  },
  'EPTR_COVER_OPEN': {
    en: 'Printer cover is open. Please close it.',
    ar: 'غطاء الطابعة مفتوح. يرجى إغلاقه.'
  },
  'EPTR_EMPTY': {
    en: 'Printer is offline or empty.',
    ar: 'الطابعة غير متصلة أو فارغة.'
  },
  'EPTR_REC_EMPTY': {
    en: 'Out of paper. Please load a new roll.',
    ar: 'ورق الطباعة فارغ. يرجى تركيب رول ورق جديد.'
  },
  'EXT_DEV_NOT_FOUND': {
    en: 'Local printer device not found.',
    ar: 'لم يتم العثور على الطابعة المحلية.'
  },
  'EPTR_UNRECOVERABLE': {
    en: 'Unrecoverable printer hardware error.',
    ar: 'حدث خطأ غير قابل للاسترداد في عتاد الطابعة.'
  }
};

/**
 * Translates Epson ePOS printer error code to a friendly message.
 */
export function getFriendlyEpsonError(code, isArabic = true) {
  const trans = EPSON_ERROR_TRANSLATIONS[code];
  if (trans) {
    return isArabic ? trans.ar : trans.en;
  }
  return isArabic ? `خطأ في الطابعة (${code})` : `Printer Error (${code})`;
}

/**
 * Sends a print request to the Epson TM-T20IV printer via ePOS-Print XML POST.
 * Auto-falls back to silent iframe printing if direct endpoint is blocked or unreachable.
 */
export async function printReceipt(order, printerIP, storeName = 'Cashmint', options = {}) {
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
      const res = await printViaIframeFallback(order, storeName);
      return res;
    } catch (err) {
      return { success: false, transport: "iframe", endpoint: "", error: err.message };
    }
  }

  // Final ePOS-Print HTTPS URL
  const endpoint = `https://${cleanIP}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
  
  let xmlContent = '';
  if (options.minimalTest) {
    xmlContent = `<text align="center">CASHMINT TEST&#10;</text>
<text>Printer connection is working.&#10;</text>
<feed line="3"/>
<cut type="feed"/>`;
  } else {
    xmlContent = buildReceiptXML(order, storeName);
  }

  // Wrap in a SOAP Envelope
  const soapPayload = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
      ${xmlContent}
    </epos-print>
  </s:Body>
</s:Envelope>`;

  const isDebug = import.meta.env.DEV === true || localStorage.getItem('epos_debug') === 'true';
  if (isDebug) {
    console.log("ePOS Normalized Printer IP:", cleanIP);
    console.log("ePOS Final Endpoint:", endpoint);
    console.log("ePOS SOAP Payload:", soapPayload);
  }

  let response;
  let responseText = '';

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '""'
      },
      body: soapPayload
    });

    responseText = await response.text();

    if (isDebug) {
      console.log("ePOS HTTP Status:", response.status);
      console.log("ePOS Raw Response:", responseText);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(responseText, "text/xml");

    // Check for SOAP Fault/detail tags first
    const faultTag = xmlDoc.getElementsByTagName('Fault')[0] || xmlDoc.getElementsByTagName('detail')[0];
    if (faultTag) {
      const faultString = xmlDoc.getElementsByTagName('faultstring')[0]?.textContent || "SOAP Fault";
      const faultCode = xmlDoc.getElementsByTagName('faultcode')[0]?.textContent || "";
      if (isDebug) {
        console.log("ePOS SOAP Fault details:", { faultString, faultCode });
      }
      throw new Error(faultString);
    }

    const responseTag = xmlDoc.getElementsByTagName('response')[0];
    if (!responseTag) {
      throw new Error("Invalid XML response format received from printer");
    }

    const successAttr = responseTag.getAttribute('success');
    const codeAttr = responseTag.getAttribute('code');

    if (isDebug) {
      console.log("ePOS Parsed Response Attributes:", { success: successAttr, code: codeAttr });
    }

    if (successAttr === 'true' || successAttr === '1') {
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
      const fallbackRes = await printViaIframeFallback(order, storeName);
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
