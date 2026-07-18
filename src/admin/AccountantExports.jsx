import React, { useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { downloadCsv, formatAccountingDecimal } from '../utils/accountingExports';

const today = new Date().toISOString().slice(0, 10);

export default function AccountantExports({ store, showNotification, isArabic }) {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const validate = () => {
    if (!store?.id) throw new Error('Store context is unavailable.');
    if (!startDate || !endDate || startDate > endDate) throw new Error('Choose a valid date range.');
  };
  const query = async (source, columns = '*') => {
    validate();
    const { data, error } = await supabase.from(source).select(columns).eq('store_id', store.id).gte('business_date', startDate).lte('business_date', endDate).order('business_date');
    if (error) throw error;
    return data || [];
  };
  const run = async (action) => {
    try { setLoading(true); setStatus(''); await action(); setStatus(isArabic ? 'تم إنشاء التقرير بنجاح' : 'Report generated successfully.'); }
    catch (error) { console.error('Accounting export error:', error); const message = error.message || 'Export failed.'; setStatus(message); showNotification(message, 'error'); }
    finally { setLoading(false); }
  };
  const salesExport = () => run(async () => {
    const rows = await query('accountant_sales_transactions');
    downloadCsv({ filename: `sales_transactions_${startDate}_${endDate}.csv`, rows, columns: [
      { label: 'Date', key: 'business_date' }, { label: 'Time', value: r => r.completed_at ? new Date(r.completed_at).toLocaleTimeString() : '' }, { label: 'Receipt Number', key: 'receipt_number' }, { label: 'Order ID', key: 'order_id' }, { label: 'Order Type', key: 'order_type' }, { label: 'Product', key: 'product_name' }, { label: 'Category', key: 'category_name' }, { label: 'Quantity', key: 'quantity' }, { label: 'Unit Price Including VAT', value: r => formatAccountingDecimal(r.unit_price_incl_vat) }, { label: 'Discount', value: r => formatAccountingDecimal(r.discount_amount) }, { label: 'VAT Rate', key: 'vat_rate' }, { label: 'Net Amount', value: r => formatAccountingDecimal(r.net_amount) }, { label: 'VAT Amount', value: r => formatAccountingDecimal(r.vat_amount) }, { label: 'Gross Amount', value: r => formatAccountingDecimal(r.gross_amount) }, { label: 'Status', key: 'order_status' }
    ] });
  });
  const vatExport = () => run(async () => {
    const rows = await query('accountant_vat_summary');
    downloadCsv({ filename: `vat_summary_${startDate}_${endDate}.csv`, rows, columns: [
      { label: 'Date', key: 'business_date' }, { label: 'VAT Rate', key: 'vat_rate' }, { label: 'Sales Net', value: r => formatAccountingDecimal(r.net_sales) }, { label: 'Sales VAT', value: r => formatAccountingDecimal(r.vat_amount) }, { label: 'Sales Gross', value: r => formatAccountingDecimal(r.gross_sales) }, { label: 'Refund Net', value: r => formatAccountingDecimal(r.refund_net) }, { label: 'Refund VAT', value: r => formatAccountingDecimal(r.refund_vat) }, { label: 'Refund Gross', value: r => formatAccountingDecimal(r.refund_gross) }, { label: 'Final Net', value: r => formatAccountingDecimal(r.final_net) }, { label: 'Final VAT', value: r => formatAccountingDecimal(r.final_vat) }, { label: 'Final Gross', value: r => formatAccountingDecimal(r.final_gross) }
    ] });
  });
  const paymentsExport = () => run(async () => {
    const rows = await query('accountant_payments_summary');
    downloadCsv({ filename: `payments_summary_${startDate}_${endDate}.csv`, rows, columns: [
      { label: 'Date', key: 'business_date' }, { label: 'Time', value: r => r.paid_at ? new Date(r.paid_at).toLocaleTimeString() : '' }, { label: 'Receipt Number', key: 'receipt_number' }, { label: 'Order ID', key: 'order_id' }, { label: 'Payment Method', key: 'method' }, { label: 'Provider', key: 'provider' }, { label: 'Status', key: 'status' }, { label: 'Amount', value: r => formatAccountingDecimal(r.amount) }, { label: 'Processor Fee', value: r => formatAccountingDecimal(r.processor_fee) }, { label: 'Net Settlement', value: r => formatAccountingDecimal(r.net_settlement) }, { label: 'Provider Reference', key: 'provider_reference' }
    ] });
  });
  const finalizeClosing = () => run(async () => {
    validate();
    if (startDate !== endDate) throw new Error('A daily closing must cover one business date.');
    const { error } = await supabase.rpc('finalize_daily_closing', {
      p_store_id: store.id,
      p_business_date: startDate,
      p_cashier_session_id: null,
    });
    if (error) throw error;
  });
  const printClosing = () => run(async () => {
    const [vatRows, paymentRows] = await Promise.all([query('accountant_vat_summary'), query('accountant_payments_summary')]);
    const total = vatRows.reduce((sum, row) => sum + Number(row.final_gross || 0), 0);
    const payments = paymentRows.filter(row => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const content = `<html><head><title>Daily Closing</title><style>@page{size:A4;margin:12mm}body{font-family:Arial;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ddd;padding:6px;text-align:right}th{text-align:left;background:#f5f5f5}.no-print{margin-bottom:12px}@media print{.no-print{display:none!important}}</style></head><body><button class="no-print" onclick="window.print()">Print / Save PDF</button><h1>${store.name} — Daily Closing</h1><p>${startDate} to ${endDate} · ${store.currency || 'EUR'} · ${store.timezone || 'Europe/Brussels'}</p><h2>VAT breakdown</h2><table><tr><th>VAT rate</th><th>Net</th><th>VAT</th><th>Gross</th></tr>${vatRows.map(r => `<tr><td>${r.vat_rate}%</td><td>${formatAccountingDecimal(r.final_net)}</td><td>${formatAccountingDecimal(r.final_vat)}</td><td>${formatAccountingDecimal(r.final_gross)}</td></tr>`).join('')}</table><h2>Totals</h2><p>Final gross: ${formatAccountingDecimal(total)} · Successful payments: ${formatAccountingDecimal(payments)} · Difference: ${formatAccountingDecimal(total - payments)}</p></body></html>`;
    const report = window.open('', '_blank');
    if (!report) throw new Error('Popup blocked. Allow popups to generate the PDF.');
    report.opener = null;
    report.document.write(content); report.document.close(); report.focus();
  });
  const disabled = loading || !store?.id;
  return <div className="max-w-3xl space-y-6" dir={isArabic ? 'rtl' : 'ltr'}>
    <div><h2 className="text-xl font-black text-slate-800 dark:text-white">{isArabic ? 'تصدير المحاسب' : 'Accountant Exports'}</h2><p className="text-xs text-slate-500 mt-1">{isArabic ? 'تقارير المبيعات والضريبة والمدفوعات حسب الفترة.' : 'Sales, VAT, payment, and daily-closing reports for the selected period.'}</p></div>
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 grid sm:grid-cols-2 gap-4"><label className="text-xs font-bold">{isArabic ? 'من' : 'Start date'}<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-2 w-full p-2.5 rounded-xl border bg-transparent" /></label><label className="text-xs font-bold">{isArabic ? 'إلى' : 'End date'}<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-2 w-full p-2.5 rounded-xl border bg-transparent" /></label></div>
    <div className="grid sm:grid-cols-2 gap-3"><button disabled={disabled} onClick={salesExport} className="p-4 rounded-xl bg-amber-500 text-white font-bold text-sm flex gap-2 justify-center"><Download className="w-4 h-4" />Download Sales Transactions CSV</button><button disabled={disabled} onClick={vatExport} className="p-4 rounded-xl bg-amber-500 text-white font-bold text-sm flex gap-2 justify-center"><Download className="w-4 h-4" />Download VAT Summary CSV</button><button disabled={disabled} onClick={paymentsExport} className="p-4 rounded-xl bg-amber-500 text-white font-bold text-sm flex gap-2 justify-center"><FileText className="w-4 h-4" />Download Payments Summary CSV</button><button disabled={disabled} onClick={finalizeClosing} className="p-4 rounded-xl bg-emerald-600 text-white font-bold text-sm flex gap-2 justify-center"><FileText className="w-4 h-4" />Finalize Daily Closing</button><button disabled={disabled} onClick={printClosing} className="p-4 rounded-xl bg-slate-800 text-white font-bold text-sm flex gap-2 justify-center sm:col-span-2"><Printer className="w-4 h-4" />Generate Daily Closing PDF</button></div>
    {status && <p className="text-xs font-semibold text-slate-500">{status}</p>}
  </div>;
}
