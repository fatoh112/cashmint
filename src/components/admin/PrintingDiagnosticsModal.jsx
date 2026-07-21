import React, { useState, useEffect, useRef } from 'react';
import { 
  Printer, 
  Image as ImageIcon, 
  RefreshCw, 
  Copy, 
  Download, 
  Trash2, 
  AlertCircle, 
  CheckCircle, 
  Info, 
  X, 
  Share2, 
  Wifi, 
  ShieldAlert 
} from 'lucide-react';
import { 
  getDiagnosticLogs, 
  clearDiagnosticLogs, 
  getLastPrintAttempt, 
  formatDiagnosticReportText, 
  subscribeDiagnostics,
  addDiagnosticLog,
  categorizePrinterError
} from '../../utils/diagnosticLogger';
import { printReceipt, convertLogoToEpsonXML } from '../../utils/printerService';
import { supabase } from '../../supabaseClient';

export default function PrintingDiagnosticsModal({ isOpen, onClose, onRetryPrint, isArabic = false, store = null }) {
  const [logs, setLogs] = useState(getDiagnosticLogs());
  const [lastAttempt, setLastAttempt] = useState(getLastPrintAttempt());
  const [isTestingPrinter, setIsTestingPrinter] = useState(false);
  const [isTestingLogo, setIsTestingLogo] = useState(false);
  const [logoTestResult, setLogoTestResult] = useState(null);
  const [printerTestResult, setPrinterTestResult] = useState(null);
  const [notification, setNotification] = useState(null);
  const [showErrorGuide, setShowErrorGuide] = useState(false);

  const canvasRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setLogs(getDiagnosticLogs());
    setLastAttempt(getLastPrintAttempt());

    const unsubscribe = subscribeDiagnostics(() => {
      setLogs(getDiagnosticLogs());
      setLastAttempt(getLastPrintAttempt());
    });

    return () => unsubscribe();
  }, [isOpen]);

  if (!isOpen) return null;

  const showToast = (msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Test 1: Epson Connection Test
  const handleTestConnection = async () => {
    setIsTestingPrinter(true);
    setPrinterTestResult(null);

    const printerIP = localStorage.getItem('local_printer_ip') || '';
    const cleanIP = printerIP.trim();
    const endpoint = cleanIP ? `https://${cleanIP}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000` : '';

    addDiagnosticLog({
      type: '[PRINTER-TRACE]',
      step: 'test-connection-start',
      success: true,
      metadata: { printerIP: cleanIP, endpoint }
    });

    if (!cleanIP) {
      setPrinterTestResult({
        success: false,
        error: 'Printer IP address is not configured in settings.',
        code: 'MISSING_PRINTER_IP',
        endpoint: ''
      });
      addDiagnosticLog({
        type: '[PRINTER-TRACE]',
        step: 'test-connection-failed',
        success: false,
        error: 'Printer IP missing'
      });
      setIsTestingPrinter(false);
      return;
    }

    try {
      const dummyOrder = {
        id: `test-conn-${Date.now()}`,
        total_amount: 0,
        raw_payload: { cart_items: [{ name: 'Test Connection Item', price: 0, quantity: 1 }] }
      };

      const startTime = Date.now();
      const res = await printReceipt(dummyOrder, cleanIP, store?.name || 'Cashmint', {
        minimalTest: true,
        skipFallback: true,
        isArabic
      });
      const durationMs = Date.now() - startTime;

      setPrinterTestResult({
        ...res,
        endpoint,
        durationMs
      });

      addDiagnosticLog({
        type: '[PRINTER-TRACE]',
        step: 'test-connection-response',
        success: res.success,
        status: res.status,
        code: res.code,
        transport: res.transport,
        error: res.error,
        metadata: { durationMs, endpoint }
      });

      if (res.success) {
        showToast(isArabic ? "نجح اتصال الطابعة!" : "Epson printer connection successful!", "success");
      } else {
        showToast(isArabic ? `فشل الاتصال: ${res.error}` : `Connection failed: ${res.error}`, "error");
      }
    } catch (err) {
      const cat = categorizePrinterError(err);
      setPrinterTestResult({
        success: false,
        error: err.message,
        code: cat.code,
        label: cat.label,
        endpoint
      });

      addDiagnosticLog({
        type: '[PRINTER-TRACE]',
        step: 'test-connection-error',
        success: false,
        error: err.message,
        code: cat.code,
        metadata: { endpoint }
      });

      showToast(`Printer Error (${cat.code}): ${err.message}`, "error");
    } finally {
      setIsTestingPrinter(false);
    }
  };

  // Test 2: Logo Pipeline Test & Visual Canvas Render
  const handleTestLogoPipeline = async () => {
    setIsTestingLogo(true);
    setLogoTestResult(null);

    const printerIP = (localStorage.getItem('local_printer_ip') || '').trim();

    addDiagnosticLog({
      type: '[LOGO-TRACE]',
      step: 'pipeline-test-start',
      success: true,
      metadata: { printerIP }
    });

    try {
      // 1. Fetch active pos_receipt template config
      let templateConfig = null;
      let activeLogoUrl = store?.logo_url || store?.logoUrl || '';

      if (store?.id) {
        const { data: tpls } = await supabase
          .from('receipt_templates')
          .select('config_json')
          .eq('store_id', store.id)
          .eq('template_type', 'pos_receipt')
          .eq('is_active', true)
          .maybeSingle();

        if (tpls?.config_json) {
          templateConfig = tpls.config_json;
          if (templateConfig.header?.logo_url) {
            activeLogoUrl = templateConfig.header.logo_url;
          }
        }
      }

      const showLogoConfig = templateConfig?.header?.show_logo !== false;

      addDiagnosticLog({
        type: '[LOGO-TRACE]',
        step: 'template-fetch-result',
        success: true,
        metadata: { showLogoConfig, resolvedLogoUrl: activeLogoUrl }
      });

      if (!activeLogoUrl) {
        throw new Error('No store logo URL configured on store or receipt template.');
      }

      // 2. Fetch logo blob & check HTTP status & content type
      let fetchStatus = null;
      let contentType = null;
      let blobSize = 0;
      let blobUrl = activeLogoUrl;

      if (activeLogoUrl.startsWith('http')) {
        const res = await fetch(activeLogoUrl);
        fetchStatus = res.status;
        contentType = res.headers.get('content-type') || '';
        if (res.ok) {
          const blob = await res.blob();
          blobSize = blob.size;
          blobUrl = URL.createObjectURL(blob);
        } else {
          throw new Error(`HTTP ${res.status} when fetching logo image URL.`);
        }
      }

      // 3. Load image into HTML Image object
      const img = new Image();
      if (!activeLogoUrl.startsWith('http')) {
        img.crossOrigin = 'Anonymous';
      }

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load logo image element.'));
        img.src = blobUrl;
      });

      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;

      let targetWidth = Math.min(naturalWidth || 256, 384);
      targetWidth = Math.floor(targetWidth / 8) * 8;
      if (targetWidth < 8) targetWidth = 8;
      const scale = targetWidth / (naturalWidth || targetWidth);
      const targetHeight = Math.max(1, Math.round((naturalHeight || targetWidth) * scale));

      // Draw onto visible canvas element for in-app preview
      if (canvasRef.current) {
        const cvs = canvasRef.current;
        cvs.width = targetWidth;
        cvs.height = targetHeight;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        // Convert to monochrome 1-bit on preview canvas
        const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
          const lum = px[i + 3] < 128 ? 255 : (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
          const mono = lum < 128 ? 0 : 255;
          px[i] = mono;
          px[i + 1] = mono;
          px[i + 2] = mono;
          px[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      // 4. Convert logo to Epson XML string
      const logoXml = await convertLogoToEpsonXML(activeLogoUrl, 'center', 384);
      const hasImageTag = logoXml.includes('<image');
      const rasterByteCount = Math.floor(targetWidth / 8) * targetHeight;

      let epsonRes = null;
      if (printerIP && hasImageTag) {
        const dummyLogoOrder = {
          id: `logo-test-${Date.now()}`,
          total_amount: 0,
          raw_payload: { cart_items: [{ name: '*** LOGO TEST PRINT ***', price: 0, quantity: 1 }] }
        };
        epsonRes = await printReceipt(dummyLogoOrder, printerIP, store?.name || 'Cashmint', {
          templateConfig,
          outputType: 'pos_receipt',
          skipFallback: true
        });
      }

      setLogoTestResult({
        success: true,
        logoUrl: activeLogoUrl,
        fetchStatus,
        contentType,
        blobSize,
        naturalSize: `${naturalWidth}x${naturalHeight}`,
        canvasSize: `${targetWidth}x${targetHeight}`,
        rasterByteCount,
        hasImageTag,
        epsonRes
      });

      addDiagnosticLog({
        type: '[LOGO-TRACE]',
        step: 'pipeline-test-complete',
        success: true,
        metadata: {
          fetchStatus,
          contentType,
          blobSize,
          canvasSize: `${targetWidth}x${targetHeight}`,
          rasterByteCount,
          hasImageTag,
          epsonSuccess: epsonRes?.success
        }
      });

      showToast(isArabic ? "تم اختبار اللوجو بنجاح!" : "Logo test pipeline executed!", "success");
    } catch (err) {
      const cat = categorizePrinterError(err);
      setLogoTestResult({
        success: false,
        error: err.message,
        code: cat.code
      });

      addDiagnosticLog({
        type: '[LOGO-TRACE]',
        step: 'pipeline-test-error',
        success: false,
        error: err.message,
        code: cat.code
      });

      showToast(`Logo Test Error: ${err.message}`, "error");
    } finally {
      setIsTestingLogo(false);
    }
  };

  // Report Export Actions
  const handleCopyReport = async () => {
    const reportText = formatDiagnosticReportText();
    if (navigator.share && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Cashmint POS Printing Diagnostic Report',
          text: reportText
        });
        showToast(isArabic ? "تمت المشاركة بنجاح" : "Report shared successfully", "success");
        return;
      } catch (e) {
        // Fallback to clipboard if share dismissed or unsupported
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(reportText);
        showToast(isArabic ? "تم نسخ التقرير إلى الحافظة" : "Report copied to clipboard", "success");
        return;
      } catch (e) { }
    }

    showToast(isArabic ? "تعذر النسخ التلقائي. استخدم زر التنزيل." : "Could not auto-copy. Use Download Report.", "error");
  };

  const handleDownloadReport = () => {
    const reportText = formatDiagnosticReportText();
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cashmint-printing-diagnostics-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(isArabic ? "تم تحميل ملف التقرير" : "Diagnostic report downloaded", "success");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-md font-sans overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-slate-900 dark:text-slate-100" dir={isArabic ? 'rtl' : 'ltr'}>
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-500 rounded-2xl">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-tight">
                {isArabic ? "محرك تشخيص الطباعة (iPad Diagnostics Mode)" : "Printing System Diagnostics Mode"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {isArabic ? "تشخيص وإصلاح الطابعة Epson TM-T20IV مباشرة من أجهزة iPad" : "Epson TM-T20IV In-App Diagnostics & Live Log Inspection"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toast Alert Banner */}
        {notification && (
          <div className={`px-6 py-2.5 text-xs font-bold flex items-center justify-between ${
            notification.type === 'error' ? 'bg-rose-500 text-white' : notification.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
          }`}>
            <span>{notification.msg}</span>
            <button onClick={() => setNotification(null)} className="ml-2 font-bold opacity-80 hover:opacity-100">✕</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Card 1: Last Print Status Card */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-500" />
                {isArabic ? "حالة آخر محاولة طباعة (Last Print Attempt)" : "Last Print Attempt Status"}
              </h3>
              {lastAttempt.success !== null && (
                <span className={`px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5 ${
                  lastAttempt.success 
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                }`}>
                  {lastAttempt.success ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  {lastAttempt.success ? (isArabic ? "نجحت الطباعة" : "PRINT SUCCEEDED") : (isArabic ? "فشلت الطباعة" : "PRINT FAILED")}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 block">{isArabic ? "رقم الطلب" : "Order ID"}</span>
                <span className="font-mono font-extrabold truncate block">{lastAttempt.orderId ? lastAttempt.orderId.substring(0, 12) : 'N/A'}</span>
              </div>
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 block">{isArabic ? "طريقة الدفع" : "Payment Method"}</span>
                <span className="font-bold capitalize">{lastAttempt.paymentMethod || 'N/A'}</span>
              </div>
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 block">{isArabic ? "وجود اللوجو" : "Logo Included"}</span>
                <span className="font-bold">{lastAttempt.logoIncluded ? 'Yes' : 'No'}</span>
              </div>
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 block">{isArabic ? "رمز الخطأ" : "Error Code"}</span>
                <span className="font-mono font-bold text-rose-500">{lastAttempt.errorCode || 'None'}</span>
              </div>
            </div>

            {/* Retry Button */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-850">
              <div className="text-[11px] text-slate-500">
                {lastAttempt.retryAllowed 
                  ? (isArabic ? "يمكن إعادة محاولة الطباعة باستخدام نفس بيانات الفاتورة." : "Order payload is cached and ready for retry.")
                  : (isArabic ? "لا توجد محاولة طباعة فاشلة قابلة للإعادة حالياً." : "No failed printable order pending retry.")
                }
              </div>
              <button
                disabled={!lastAttempt.retryAllowed || !lastAttempt.printableOrder || !onRetryPrint}
                onClick={() => onRetryPrint && onRetryPrint(lastAttempt.printableOrder)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {isArabic ? "إعادة محاولة الطباعة الفاشلة" : "Retry Last Failed Print"}
              </button>
            </div>
          </div>

          {/* Card 2: Interactive Diagnostic Tests (Epson & Logo Pipeline) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Test Action 1: Epson Connection Test */}
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700 dark:text-slate-300">
                <Wifi className="w-4 h-4 text-amber-500" />
                {isArabic ? "اختبار اتصال الطابعة Epson" : "Epson Printer Connection Test"}
              </div>
              <p className="text-[11px] text-slate-500">
                {isArabic ? "إرسال أمر ePOS XML تجريبي خفيف للتحقق من الشبكة والاستجابة." : "Sends a lightweight XML command directly to the local printer IP address."}
              </p>

              <button
                onClick={handleTestConnection}
                disabled={isTestingPrinter}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-800 dark:hover:bg-slate-700 font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isTestingPrinter ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                {isTestingPrinter ? (isArabic ? "جاري الاختبار..." : "Testing Connection...") : (isArabic ? "اختبار اتصال Epson" : "Test Epson Connection")}
              </button>

              {printerTestResult && (
                <div className={`p-3 rounded-xl text-xs space-y-1 font-mono border ${
                  printerTestResult.success ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 text-rose-800 dark:text-rose-300'
                }`}>
                  <div><strong className="font-sans">Target Endpoint:</strong> {printerTestResult.endpoint}</div>
                  <div><strong className="font-sans">HTTP Status:</strong> {printerTestResult.status || 'N/A'}</div>
                  <div><strong className="font-sans">Transport:</strong> {printerTestResult.transport || 'epos'}</div>
                  <div><strong className="font-sans">Result:</strong> {printerTestResult.success ? 'Epson XML Accepted (success="true")' : printerTestResult.error}</div>
                </div>
              )}
            </div>

            {/* Test Action 2: Logo Pipeline & Raster Canvas Test */}
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700 dark:text-slate-300">
                <ImageIcon className="w-4 h-4 text-amber-500" />
                {isArabic ? "اختبار تحويل وطباعة اللوجو" : "Logo Raster & Pipeline Test"}
              </div>
              <p className="text-[11px] text-slate-500">
                {isArabic ? "جلب الشعار، تحويله لـ Monochrome Canvas، واختبار الطباعة الحرارية." : "Fetches logo, builds 1-bit thermal raster on canvas, and verifies XML packaging."}
              </p>

              <button
                onClick={handleTestLogoPipeline}
                disabled={isTestingLogo}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                {isTestingLogo ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                {isTestingLogo ? (isArabic ? "جاري المعالجة..." : "Processing Logo...") : (isArabic ? "اختبار اللوجو الحراري" : "Test Receipt Logo")}
              </button>

              {/* Canvas Preview Container */}
              <div className="flex items-center justify-center p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 min-h-[50px]">
                <canvas ref={canvasRef} className="max-h-[60px] object-contain" />
              </div>

              {logoTestResult && (
                <div className={`p-3 rounded-xl text-xs space-y-1 font-mono border ${
                  logoTestResult.success ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 text-rose-800 dark:text-rose-300'
                }`}>
                  <div><strong className="font-sans">Logo URL:</strong> {logoTestResult.logoUrl}</div>
                  <div><strong className="font-sans">Blob Size:</strong> {logoTestResult.blobSize} bytes ({logoTestResult.contentType})</div>
                  <div><strong className="font-sans">Canvas Dimensions:</strong> {logoTestResult.canvasSize}</div>
                  <div><strong className="font-sans">Raster Payload:</strong> {logoTestResult.rasterByteCount} bytes</div>
                  <div><strong className="font-sans">XML &lt;image&gt; Tag:</strong> {logoTestResult.hasImageTag ? 'YES' : 'NO'}</div>
                </div>
              )}
            </div>

          </div>

          {/* Card 3: In-Memory Chronological Log Trail */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-extrabold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  {isArabic ? "سجل تتبع الأحداث التفصيلي (Live Diagnostic Logs)" : "Live Diagnostic Log Trail"}
                </h3>
                <span className="text-[11px] text-slate-500">
                  {logs.length} {isArabic ? "حدث مسجل في الذاكرة" : "captured diagnostic entries"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyReport}
                  className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  {navigator.share ? <Share2 className="w-3.5 h-3.5 text-amber-500" /> : <Copy className="w-3.5 h-3.5 text-amber-500" />}
                  {isArabic ? "مشاركة / نسخ التقرير" : "Share / Copy"}
                </button>
                <button
                  onClick={handleDownloadReport}
                  className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Download className="w-3.5 h-3.5 text-blue-500" />
                  {isArabic ? "تنزيل report.txt" : "Download .txt"}
                </button>
                <button
                  onClick={() => clearDiagnosticLogs()}
                  className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 hover:bg-rose-100 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isArabic ? "مسح السجل" : "Clear"}
                </button>
              </div>
            </div>

            {/* Log Trail Display List */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 max-h-72 overflow-y-auto font-mono text-[11px] space-y-2">
              {logs.length === 0 ? (
                <div className="text-center text-slate-400 py-8 font-sans">
                  {isArabic ? "لا توجد سجلات بعد. قم بإنشاء طلب نقدي أو إجراء اختبار للاتصال." : "No diagnostic logs captured yet. Execute a checkout or run a printer test."}
                </div>
              ) : (
                logs.map((log) => (
                  <div 
                    key={log.id} 
                    className={`p-2.5 rounded-lg border text-left ${
                      log.success 
                        ? 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200' 
                        : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold border-b border-slate-200/50 dark:border-slate-800/50 pb-1 mb-1">
                      <span className="text-amber-600 dark:text-amber-400">{log.type} {log.step}</span>
                      <span className="text-[10px] opacity-75">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                    {log.error && <div className="text-rose-600 dark:text-rose-400 font-extrabold">Error: {log.error}</div>}
                    {log.status && <div>HTTP Status: {log.status}</div>}
                    {log.code && <div>Code: {log.code}</div>}
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <div className="text-[10px] opacity-80 truncate">
                        Meta: {JSON.stringify(log.metadata)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card 4: iPad Safari Troubleshooting Guide */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-amber-500/5 space-y-2">
            <button 
              onClick={() => setShowErrorGuide(!showErrorGuide)} 
              className="w-full flex items-center justify-between text-xs font-extrabold text-amber-600 dark:text-amber-400 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {isArabic ? "دليل رموز الأخطاء الخاصة بـ iPad Safari" : "iPad Safari Error Codes Reference & Self-Help"}
              </span>
              <span>{showErrorGuide ? '▲' : '▼'}</span>
            </button>

            {showErrorGuide && (
              <div className="pt-2 text-xs text-slate-600 dark:text-slate-300 space-y-2 border-t border-amber-500/20">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <strong className="text-rose-500 block">MIXED_CONTENT_BLOCKED</strong>
                    App is loaded over HTTPS (`https://...`), but printer IP address is configured with HTTP (`http://...`). Ensure printer IP uses HTTPS or configure SSL on Epson ePOS.
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <strong className="text-rose-500 block">TLS_CERTIFICATE_ERROR</strong>
                    iPad Safari blocks untrusted self-signed SSL certificates on local network IPs. Open https://[printer-ip] in iPad Safari directly once to accept the self-signed certificate.
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <strong className="text-rose-500 block">CORS_BLOCKED</strong>
                    Local Network Access is disabled for Safari on iPad Settings, or printer did not return CORS headers. Enable "Local Network" access in iPad Settings -&gt; Safari.
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <strong className="text-rose-500 block">NETWORK_TIMEOUT</strong>
                    Printer IP is unreachable on the Wi-Fi network or printer power is off. Verify iPad and printer are connected to the exact same Wi-Fi subnet.
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <strong className="text-rose-500 block">MISSING_CART_ITEMS</strong>
                    The order object submitted to the printer has 0 cart items. Checkout payload validation failed.
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                    <strong className="text-rose-500 block">EPSON_RESPONSE_ERROR</strong>
                    Printer received XML payload but returned `success="false"` or a printer hardware code (paper empty, cover open, etc.).
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
