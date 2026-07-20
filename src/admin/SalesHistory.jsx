import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { printReceipt } from '../utils/printerService';
import { resolveOrderStatus } from './FullTransactionHistory';
import { 
  TrendingUp, 
  ShoppingBag, 
  DollarSign, 
  Receipt, 
  Calendar, 
  RefreshCw, 
  ChevronLeft,
  Printer,
  Clock
} from 'lucide-react';

export default function SalesHistory({ store, showNotification, isArabic }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [_isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItemsMap, setOrderItemsMap] = useState({});

  const tableScrollContainerRef = useRef(null);

  const isOrderSuccessful = useCallback((order) => {
    if (order?.status !== 'completed') return false;
    const paymentArr = Array.isArray(order?.payments) ? order.payments : (order?.payments ? [order.payments] : []);
    return paymentArr.some(p => p.status === 'paid');
  }, []);

  const fetchSalesData = useCallback(async (isSilent = false) => {
    if (!store?.id) return;
    try {
      if (!isSilent) {
        setLoading(prev => orders.length === 0 ? true : prev);
      } else {
        setIsBackgroundRefreshing(true);
      }

      // 1. Fetch products to map product_id to name
      const { data: prods } = await supabase
        .from('products')
        .select('id, name')
        .eq('store_id', store.id);
      setProducts(prods || []);

      // 2. Fetch orders created ONLY in the last 24 hours (server-side filtering)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: ords, error: ordsErr } = await supabase
        .from('orders')
        .select('*, payments(*)')
        .eq('store_id', store.id)
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false });

      if (ordsErr) throw ordsErr;

      setOrders(ords || []);

      // 3. Fetch order items for last 24 hours orders
      let items = [];
      const orderIds = (ords || []).map(o => o.id);
      if (orderIds.length > 0) {
        const { data: ordItems, error: itemsErr } = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', orderIds);
        if (itemsErr) throw itemsErr;
        items = ordItems || [];
      }

      const map = {};
      items?.forEach(item => {
        if (!map[item.order_id]) {
          map[item.order_id] = [];
        }
        map[item.order_id].push(item);
      });
      setOrderItemsMap(map);

    } catch (err) {
      console.error("Error loading 24h sales history:", err);
      showNotification(isArabic ? "خطأ في تحميل سجل المبيعات (24 ساعة)" : "Error loading 24h sales history", "error");
    } finally {
      setLoading(false);
      setIsBackgroundRefreshing(false);
    }
  }, [store?.id, isArabic, showNotification]);

  useEffect(() => {
    if (store?.id) {
      fetchSalesData(false);
      
      const channel = supabase
        .channel(`sales-history-24h-${store.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `store_id=eq.${store.id}`
          },
          () => {
            fetchSalesData(true);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [store?.id, fetchSalesData]);

  // Successful orders ONLY for revenue/VAT/AOV/Top-selling computations
  const successfulOrders = orders.filter(isOrderSuccessful);
  
  const totalRevenue = successfulOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
  const totalTax = successfulOrders.reduce((sum, o) => sum + parseFloat(o.vat_amount || 0), 0);
  const avgOrderValue = successfulOrders.length > 0 ? (totalRevenue / successfulOrders.length) : 0;

  // Compute top selling items from successful orders ONLY
  const productSales = {};
  successfulOrders.forEach(o => {
    const items = orderItemsMap[o.id] || [];
    items.forEach(item => {
      productSales[item.product_id] = (productSales[item.product_id] || 0) + item.quantity;
    });
  });

  const topSelling = Object.keys(productSales)
    .map(prodId => {
      const prod = products.find(p => p.id === prodId);
      return {
        name: prod ? prod.name : (isArabic ? 'منتج غير معروف' : 'Product'),
        qty: productSales[prodId]
      };
    })
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  return (
    <div className="space-y-6" dir={isArabic ? 'rtl' : 'ltr'}>
      
      {/* Title */}
      <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            <span>{isArabic ? "لوحة المبيعات (آخر 24 ساعة)" : "Sales Dashboard (Last 24 Hours)"}</span>
          </h2>
          <p className="text-xs text-slate-450 dark:text-slate-400 mt-1">
            {isArabic ? "مراقبة الإيرادات الفلكية، الضريبة المحصلة، والطلبات المسجلة خلال الـ 24 ساعة الماضية فقط" : "Real-time revenue, collected VAT, and orders logged in the last 24 hours"}
          </p>
        </div>

        <button
          onClick={() => fetchSalesData(false)}
          disabled={loading}
          className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all active:scale-95 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-400">{isArabic ? "جاري تحميل بيانات الـ 24 ساعة..." : "Loading 24h dashboard data..."}</p>
        </div>
      ) : (
        <>
          {/* ANALYTICS METRIC CARDS (Successful Orders Only) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            
            {/* Total Revenue */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "إجمالي الإيرادات (24س)" : "Revenue (24h)"}</span>
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl text-emerald-500">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{totalRevenue.toFixed(2)} €</p>
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">{isArabic ? "طلبات مدفوعة مؤكدة فقط" : "Confirmed paid orders only"}</span>
              </div>
            </div>

            {/* Total Successful Orders */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "عدد الطلبات الناجحة" : "Successful Orders"}</span>
                <div className="p-2 bg-amber-50 dark:bg-amber-950/30 rounded-xl text-amber-500">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{successfulOrders.length}</p>
              <span className="text-[9px] font-bold text-slate-400 block">{isArabic ? "طلب مكتمل ومدفوع بنجاح" : "Completed & paid tickets"}</span>
            </div>

            {/* VAT Collected */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "الضريبة المحصلة (24س)" : "VAT Collected (24h)"}</span>
                <div className="p-2 bg-purple-50 dark:bg-purple-950/30 rounded-xl text-purple-500">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{totalTax.toFixed(2)} €</p>
              <span className="text-[9px] font-bold text-slate-400 block">{isArabic ? "الضريبة للطلبات المؤكدة" : "Tax from paid orders"}</span>
            </div>

            {/* Average Ticket */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "متوسط قيمة الطلب (AOV)" : "Average Order Value"}</span>
                <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded-xl text-blue-500">
                  <Calendar className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">
                {avgOrderValue.toFixed(2)} €
              </p>
              <span className="text-[9px] font-bold text-slate-400 block">{isArabic ? "معدل السلة الناجحة" : "AOV per paid ticket"}</span>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* RECENT ORDERS TABLE (2/3 width) - FIXED HEIGHT & STICKY HEADER */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-2xl shadow-sm overflow-hidden lg:col-span-2">
              <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 flex justify-between items-center">
                <span className="font-extrabold text-sm text-slate-700 dark:text-slate-200">
                  {isArabic ? "سجل طلبات آخر 24 ساعة" : "Recent Orders (Last 24 Hours)"}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {isArabic ? `إجمالي: ${orders.length} طلب` : `Total: ${orders.length} orders`}
                </span>
              </div>
              
              <div ref={tableScrollContainerRef} className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 uppercase">
                    <tr>
                      <th className="p-3.5">{isArabic ? "رقم الفاتورة" : "Receipt"}</th>
                      <th className="p-3.5">{isArabic ? "الوقت" : "Time"}</th>
                      <th className="p-3.5">{isArabic ? "النوع" : "Type"}</th>
                      <th className="p-3.5">{isArabic ? "الدفع" : "Method"}</th>
                      <th className="p-3.5">{isArabic ? "القيمة الكلية" : "Total"}</th>
                      <th className="p-3.5 text-center">{isArabic ? "الحالة" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-medium text-slate-700 dark:text-slate-300">
                    {orders.map(order => {
                      const timeStr = new Date(order.created_at).toLocaleTimeString(undefined, {
                        hour: '2-digit', minute: '2-digit'
                      });
                      
                      const orderType = order.order_type || order.raw_payload?.order_type || 'takeaway';
                      const typeLabel = orderType === 'dine_in' ? (isArabic ? '🍽️ محلي' : 'Dine In') : (isArabic ? '🛍️ سفري' : 'Takeaway');
                      const methodLabel = (order.payment_method || 'cash') === 'card' ? (isArabic ? '💳 بطاقة' : 'Card') : (isArabic ? '💵 نقداً' : 'Cash');
                      const statusBadge = resolveOrderStatus(order, isArabic);
                      const isSelected = selectedOrder?.id === order.id;

                      return (
                        <tr 
                          key={order.id} 
                          onClick={() => setSelectedOrder(order)}
                          className={`transition-all cursor-pointer ${
                            isSelected 
                              ? 'bg-amber-500/10 dark:bg-amber-500/20 font-bold' 
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'
                          }`}
                        >
                          <td className="p-3.5 font-mono font-bold text-slate-800 dark:text-white">
                            {order.receipt_number || `#${order.id.substring(0, 8)}`}
                          </td>
                          <td className="p-3.5 text-slate-500 dark:text-slate-400">{timeStr}</td>
                          <td className="p-3.5 text-slate-500 dark:text-slate-400">{typeLabel}</td>
                          <td className="p-3.5 text-slate-500 dark:text-slate-400">{methodLabel}</td>
                          <td className="p-3.5 font-black text-slate-800 dark:text-slate-200">{parseFloat(order.total_amount).toFixed(2)} €</td>
                          <td className="p-3.5 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${statusBadge.badgeClass}`}>
                              {statusBadge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-400 dark:text-slate-500">
                          {isArabic ? "لا توجد طلبات مسجلة في الـ 24 ساعة الماضية" : "No orders recorded in the last 24 hours"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SIDEBAR: TOP SELLING & DETAILS PANEL (1/3 width) */}
            <div className="space-y-6">
              
              {/* TOP SELLING PRODUCTS (Successful Only) */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4">
                <span className="font-extrabold text-sm text-slate-800 dark:text-white block border-b border-slate-100 dark:border-slate-700 pb-2.5">
                  {isArabic ? "الأكثر مبيعاً (الطلبات الناجحة)" : "Top Selling Items (Paid Only)"}
                </span>

                <div className="space-y-3">
                  {topSelling.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-3">
                        <div className="w-5 h-5 rounded-full bg-amber-50 dark:bg-amber-955/25 text-amber-600 dark:text-amber-400 font-bold flex items-center justify-center text-[10px]">
                          {idx + 1}
                        </div>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{item.name}</span>
                      </div>
                      <span className="font-black text-slate-500 dark:text-slate-400">{item.qty} {isArabic ? "مبيعات" : "sold"}</span>
                    </div>
                  ))}
                  {topSelling.length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">{isArabic ? "لا توجد مبيعات مؤكدة بعد" : "No paid sales recorded yet"}</p>
                  )}
                </div>
              </div>

              {/* ORDER DETAIL SLIDE PANEL */}
              {selectedOrder && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-2.5">
                    <span className="font-extrabold text-sm text-slate-800 dark:text-white">
                      {isArabic ? "تفاصيل الطلب" : "Order Details"} {selectedOrder.receipt_number || `#${selectedOrder.id.substring(0, 8)}`}
                    </span>
                    <button 
                      onClick={() => setSelectedOrder(null)} 
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>{isArabic ? "إغلاق" : "Close"}</span>
                    </button>
                  </div>

                  <div className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">{isArabic ? "التاريخ والوقت:" : "Date & Time:"}</span>
                      <span className="font-bold">{new Date(selectedOrder.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">{isArabic ? "الحالة:" : "Status:"}</span>
                      {(() => {
                        const badge = resolveOrderStatus(selectedOrder, isArabic);
                        return (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badge.badgeClass}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
                    <p className="text-[10px] font-bold text-slate-450 uppercase mb-2">{isArabic ? "العناصر المطلوبة:" : "Ordered Items:"}</p>
                    <div className="space-y-2.5 max-h-44 overflow-y-auto">
                      {(orderItemsMap[selectedOrder.id] || []).map((item, idx) => {
                        const prod = products.find(p => p.id === item.product_id);
                        return (
                          <div key={idx} className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                            <span>{prod ? prod.name : (item.product_name_snapshot || 'Product')} x{item.quantity}</span>
                            <span className="font-black">
                              {((parseFloat(item.price) || (parseFloat(item.subtotal || 0) / item.quantity)) * item.quantity).toFixed(2)} €
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-700 pt-3 flex flex-col gap-2">
                    <button
                      onClick={async () => {
                        const printerIP = localStorage.getItem('local_printer_ip');
                        showNotification(isArabic ? "جاري إرسال تذكرة الفاتورة للطابعة..." : "Sending receipt print job...", "info");
                        const cartItems = (orderItemsMap[selectedOrder.id] || []).map(item => {
                          const prod = products.find(p => p.id === item.product_id);
                          return {
                            name: prod ? prod.name : (item.product_name_snapshot || 'Product'),
                            price: prod ? parseFloat(prod.price) : (parseFloat(item.price) || (parseFloat(item.subtotal || 0) / item.quantity)),
                            quantity: item.quantity,
                            modifiers: []
                          };
                        });

                        const formattedOrder = {
                          id: selectedOrder.id,
                          total_amount: parseFloat(selectedOrder.total_amount),
                          raw_payload: selectedOrder.raw_payload || {
                            cart_items: cartItems,
                            timestamp: selectedOrder.created_at,
                            order_type: selectedOrder.order_type || 'takeaway'
                          }
                        };
                        
                        const res = await printReceipt(formattedOrder, printerIP, store ? store.name : 'Cashmint');
                        if (res.success) {
                          showNotification(isArabic ? "تم إعادة طباعة الفاتورة 🖨️" : "Receipt reprinted 🖨️");
                        } else {
                          showNotification(isArabic ? `فشل الطباعة: ${res.error}` : `Print failed: ${res.error}`, "error");
                        }
                      }}
                      className="w-full bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs py-2.5 rounded-xl shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>{isArabic ? "إعادة طباعة الفاتورة" : "Reprint Receipt"}</span>
                    </button>
                  </div>
                </div>
              )}

            </div>

          </div>
        </>
      )}

    </div>
  );
}
