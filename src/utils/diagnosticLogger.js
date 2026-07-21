/**
 * In-App Printing Diagnostic Logger & iPad Diagnostics Engine for Cashmint POS.
 * Captures in-memory trace logs for [CASH-TRACE], [LOGO-TRACE], [PRINTER-TRACE], and [EPSON-TRACE].
 * Supports Web Share API, Clipboard fallback, text report generation, and iPad Safari error detection.
 */

let logs = [];
const MAX_LOGS = 200;

let lastPrintAttemptState = {
  orderId: null,
  paymentMethod: null,
  timestamp: null,
  attemptedTypes: [],
  success: null,
  logoIncluded: false,
  errorStage: null,
  errorCode: null,
  retryAllowed: false,
  printableOrder: null,
  rawEpsonResponse: null
};

const listeners = new Set();

function notifyListeners() {
  listeners.forEach(fn => fn());
}

export function subscribeDiagnostics(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addDiagnosticLog({
  type,
  step,
  success = true,
  metadata = {},
  error = null,
  status = null,
  code = null,
  transport = 'epos'
}) {
  const timestamp = new Date().toISOString();

  // Safe sanitization - strip sensitive info, secrets, or huge binary data
  const safeMeta = { ...metadata };
  delete safeMeta.card_number;
  delete safeMeta.cvv;
  delete safeMeta.auth_token;
  delete safeMeta.api_key;
  if (safeMeta.rasterHex) {
    safeMeta.rasterHexLength = safeMeta.rasterHex.length;
    delete safeMeta.rasterHex;
  }

  const logEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp,
    type, // [CASH-TRACE], [LOGO-TRACE], [PRINTER-TRACE], [EPSON-TRACE]
    step,
    success,
    metadata: safeMeta,
    error: error ? String(error) : null,
    status: status || null,
    code: code || null,
    transport
  };

  logs.unshift(logEntry);
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }

  notifyListeners();
  return logEntry;
}

export function getDiagnosticLogs() {
  return [...logs];
}

export function clearDiagnosticLogs() {
  logs = [];
  notifyListeners();
}

export function setLastPrintAttempt(data) {
  lastPrintAttemptState = {
    ...lastPrintAttemptState,
    ...data,
    timestamp: new Date().toISOString()
  };
  notifyListeners();
}

export function getLastPrintAttempt() {
  return { ...lastPrintAttemptState };
}

export function categorizePrinterError(err, responseText = null) {
  const msg = (err?.message || String(err || '')).toLowerCase();

  if (msg.includes('mixed content') || (window.location.protocol === 'https:' && err?.url?.startsWith('http:'))) {
    return { code: 'MIXED_CONTENT_BLOCKED', label: 'Mixed Content Blocked: App is HTTPS but printer IP uses HTTP.' };
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('cors')) {
    if (window.location.protocol === 'https:') {
      return { code: 'TLS_CERTIFICATE_ERROR', label: 'TLS / SSL Certificate or CORS error connecting to local HTTPS printer.' };
    }
    return { code: 'CORS_BLOCKED', label: 'CORS / Network Access Blocked by Browser.' };
  }
  if (msg.includes('timeout') || msg.includes('ex_timeout')) {
    return { code: 'NETWORK_TIMEOUT', label: 'Network Timeout: Printer IP unreachable or printer is powered off.' };
  }
  if (msg.includes('missing_cart_items')) {
    return { code: 'MISSING_CART_ITEMS', label: 'Missing Cart Items: Order payload contains 0 items.' };
  }
  if (msg.includes('empty_print_payload')) {
    return { code: 'EMPTY_PRINT_PAYLOAD', label: 'Empty Print Payload: Generated ePOS XML command string is empty.' };
  }
  if (msg.includes('deduplication_blocked') || msg.includes('alreadyprinted')) {
    return { code: 'DEDUPLICATION_BLOCKED', label: 'Deduplication Guard: Order was already printed previously.' };
  }
  if (msg.includes('logo_fetch') || msg.includes('failed to load logo image')) {
    return { code: 'LOGO_FETCH_ERROR', label: 'Logo Fetch Error: Could not download store logo image.' };
  }
  if (msg.includes('logo_canvas') || msg.includes('tainted')) {
    return { code: 'LOGO_CANVAS_ERROR', label: 'Logo Canvas Error: Canvas tainted by cross-origin security rules.' };
  }

  return { code: err?.code || 'EPSON_RESPONSE_ERROR', label: err?.message || 'Epson printer command error.' };
}

export function formatDiagnosticReportText() {
  const last = lastPrintAttemptState;
  let text = `==================================================\n`;
  text += `CASHMINT POS — PRINTING SYSTEM DIAGNOSTIC REPORT\n`;
  text += `Generated: ${new Date().toLocaleString()}\n`;
  text += `User Agent: ${navigator.userAgent}\n`;
  text += `Online Status: ${navigator.onLine ? 'ONLINE' : 'OFFLINE'}\n`;
  text += `Protocol: ${window.location.protocol}\n`;
  text += `==================================================\n\n`;

  text += `--- LAST PRINT ATTEMPT ---\n`;
  text += `Order ID: ${last.orderId || '(none)'}\n`;
  text += `Payment Method: ${last.paymentMethod || '(none)'}\n`;
  text += `Time: ${last.timestamp || '(none)'}\n`;
  text += `Attempted Outputs: ${(last.attemptedTypes || []).join(', ') || 'none'}\n`;
  text += `Success: ${last.success === null ? 'N/A' : last.success ? 'YES' : 'NO'}\n`;
  text += `Logo Included: ${last.logoIncluded ? 'YES' : 'NO'}\n`;
  text += `Error Stage: ${last.errorStage || 'None'}\n`;
  text += `Error Code: ${last.errorCode || 'None'}\n`;
  text += `Retry Allowed: ${last.retryAllowed ? 'YES' : 'NO'}\n`;
  if (last.rawEpsonResponse) {
    text += `Epson Raw Response:\n${last.rawEpsonResponse}\n`;
  }
  text += `\n--- DIAGNOSTIC LOG TRAIL (${logs.length} entries) ---\n`;

  logs.forEach((l, idx) => {
    text += `[${idx + 1}] ${l.timestamp} | ${l.type} | ${l.step} | Status: ${l.success ? 'SUCCESS' : 'FAILURE'}\n`;
    if (l.transport) text += `    Transport: ${l.transport}\n`;
    if (l.status) text += `    HTTP Status: ${l.status}\n`;
    if (l.code) text += `    Error Code: ${l.code}\n`;
    if (l.error) text += `    Error Message: ${l.error}\n`;
    if (l.metadata && Object.keys(l.metadata).length > 0) {
      text += `    Metadata: ${JSON.stringify(l.metadata)}\n`;
    }
    text += `\n`;
  });

  return text;
}
