import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { printReceipt } from '../utils/printerService';
import { 
  TrendingUp, 
  ShoppingBag, 
  DollarSign, 
  Receipt, 
  Calendar, 
  RefreshCw, 
  ChevronLeft,
  Printer
} from 'lucide-react';

export default function SalesHistory({ store, showNotification, isArabic }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderItemsMap, setOrderItemsMap] = useState({});

  const fetchSalesData = useCallback(async () => {
    if (!store) return;
    try {
      setLoading(true);

      // Fetch products to map product_id to name
      const { data: prods } = await supabase
        .from('products')
        .select('id, name')
        .eq('store_id', store.id);
      setProducts(prods || []);

      // Fetch completed and pending orders for the store
      const { data: ords, error: ordsErr } = await supabase
        .from('orders')
        .select('*')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false });
      if (ordsErr) throw ordsErr;

      setOrders(ords || []);

      // Fetch all order items to compute analytics
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

      // Group items by order_id
      const map = {};
      items?.forEach(item => {
        if (!map[item.order_id]) {
          map[item.order_id] = [];
        }
        map[item.order_id].push(item);
      });
      setOrderItemsMap(map);

    } catch (err) {
      console.error("Error loading sales history:", err);
      showNotification(isArabic ? "خطأ في تحميل سجل المبيعات" : "Error loading sales history", "error");
    } finally {
      setLoading(false);
    }
  }, [store, isArabic, showNotification]);

  useEffect(() => {
    if (store) {
      fetchSalesData();
      
      // Subscribe to real-time order updates
      const subscription = supabase
        .channel('sales-history-realtime')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `store_id=eq.${store.id}`
          },
          (payload) => {
            console.log('Sales history update:', payload);
            if (payload.eventType === 'INSERT') {
              setOrders(prev => [payload.new, ...prev]);
            } else if (payload.eventType === 'UPDATE') {
              setOrders(prev => prev.map(o => o.id === payload.new.id ? payload.new : o));
            } else if (payload.eventType === 'DELETE') {
              setOrders(prev => prev.filter(o => o.id !== payload.old.id));
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(subscription);
      };
    }
  }, [store, fetchSalesData]);

  // Analytics Computations
  const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'new');
  
  const totalRevenue = completedOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
  // VAT is an immutable checkout snapshot. Never infer it from a global rate:
  // a single receipt can contain several accounting groups and tax profiles.
  const totalTax = completedOrders.reduce((sum, o) => sum + parseFloat(o.vat_amount || 0), 0);

  // Compute top selling items
  const productSales = {};
  completedOrders.forEach(o => {
    const items = orderItemsMap[o.id] || [];
    items.forEach(item => {
      productSales[item.product_id] = (productSales[item.product_id] || 0) + item.quantity;
    });
  });

  const topSelling = Object.keys(productSales)
    .map(prodId => {
      const prod = products.find(p => p.id === prodId);
      return {
        name: prod ? prod.name : 'منتج غير معروف',
        qty: productSales[prodId]
      };
    })
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
      case 'new': return 'bg-blue-50 text-blue-700 border border-blue-100';
      case 'pending': return 'bg-amber-50 text-amber-700 border border-amber-100';
      case 'cancelled': return 'bg-rose-50 text-rose-700 border border-rose-100';
      default: return 'bg-slate-50 text-slate-700 border border-slate-100';
    }
  };

  const getStatusLabel = (status) => {
    if (!isArabic) return status.toUpperCase();
    switch (status) {
      case 'completed': return 'مكتمل';
      case 'new': return 'جديد';
      case 'pending': return 'قيد الانتظار';
      case 'cancelled': return 'ملغي';
      default: return status;
    }
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      
      {/* Title */}
      <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">
            {isArabic ? "سجل المبيعات والتقارير" : "Sales History & Reports"}
          </h2>
          <p className="text-xs text-slate-450 dark:text-slate-400 mt-1">
            {isArabic ? "مراقبة الإيرادات، الضرائب المحصلة، وحالة الطلبات الفورية" : "Monitor revenue, collected taxes, and live order history logs"}
          </p>
        </div>

        <button
          onClick={fetchSalesData}
          disabled={loading}
          className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all active:scale-95 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-400">{isArabic ? "جاري التحميل..." : "Loading report data..."}</p>
        </div>
      ) : (
        <>
          {/* ANALYTICS METRIC CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            
            {/* Total Revenue */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "إجمالي الإيرادات" : "Total Revenue"}</span>
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl text-emerald-500">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{totalRevenue.toFixed(2)} €</p>
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">{isArabic ? "شامل الضريبة" : "VAT Included"}</span>
              </div>
            </div>

            {/* Total Orders */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "عدد الطلبات الناجحة" : "Total Orders"}</span>
                <div className="p-2 bg-amber-50 dark:bg-amber-950/30 rounded-xl text-amber-500">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{completedOrders.length}</p>
              <span className="text-[9px] font-bold text-slate-400 block">{isArabic ? "طلب مكتمل أو جديد" : "Completed or new orders"}</span>
            </div>

            {/* VAT Collected */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "ضريبة القيمة المضافة المحصلة" : "VAT Collected"}</span>
                <div className="p-2 bg-purple-50 dark:bg-purple-950/30 rounded-xl text-purple-500">
                  <Receipt className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{totalTax.toFixed(2)} €</p>
              <span className="text-[9px] font-bold text-slate-400 block">{isArabic ? "الحصة الضريبية المفرزة" : "Isolated tax share"}</span>
            </div>

            {/* Average Ticket */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm p-5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{isArabic ? "متوسط قيمة الطلب" : "Average Order Value"}</span>
                <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded-xl text-blue-500">
                  <Calendar className="w-4 h-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white">
                {completedOrders.length > 0 ? (totalRevenue / completedOrders.length).toFixed(2) : '0.00'} €
              </p>
              <span className="text-[9px] font-bold text-slate-400 block">{isArabic ? "نسبة المبيعات لكل زبون" : "AOV per customer ticket"}</span>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* SALES LOG TABLE (2/3 width) */}
            <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 rounded-2xl shadow-sm overflow-hidden lg:col-span-2">
              <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
                <span className="font-extrabold text-sm text-slate-700 dark:text-slate-205">
                  {isArabic ? "سجل الطلبات الأخير" : "Order History Log"}
                </span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-450 dark:text-slate-400 font-bold border-b border-slate-150 dark:border-slate-700 uppercase">
                    <tr>
                      <th className="p-4">{isArabic ? "رقم الطلب" : "Order ID"}</th>
                      <th className="p-4">{isArabic ? "التاريخ والوقت" : "Date & Time"}</th>
                      <th className="p-4">{isArabic ? "النوع" : "Type"}</th>
                      <th className="p-4">{isArabic ? "القيمة الكلية" : "Total Amount"}</th>
                      <th className="p-4 text-center">{isArabic ? "الحالة" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-medium text-slate-700 dark:text-slate-300">
                    {orders.map(order => {
                      const date = new Date(order.created_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      });
                      
                      const orderType = order.raw_payload?.order_type || 'takeaway';
                      const typeLabel = orderType === 'delivery' 
                        ? (isArabic ? '📦 توصيل' : 'Delivery') 
                        : orderType === 'dine_in' 
                        ? (isArabic ? '🍽️ محلي' : 'Dine In') 
                        : (isArabic ? '🛍️ سفري' : 'Takeaway');

                      return (
                        <tr 
                          key={order.id} 
                          onClick={() => setSelectedOrder(order)}
                          className="hover:bg-slate-50/55 dark:hover:bg-slate-700/30 transition-all cursor-pointer"
                        >
                          <td className="p-4 font-mono font-bold text-slate-800 dark:text-white">#{order.id.substring(0, 8)}</td>
                          <td className="p-4 text-slate-450 dark:text-slate-400">{date}</td>
                          <td className="p-4 text-slate-500 dark:text-slate-400">{typeLabel}</td>
                          <td className="p-4 font-black text-slate-800 dark:text-slate-200">{parseFloat(order.total_amount).toFixed(2)} €</td>
                          <td className="p-4 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusColor(order.status)}`}>
                              {getStatusLabel(order.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SIDEBAR: ANALYTICS & DETAILS (1/3 width) */}
            <div className="space-y-6">
              
              {/* TOP SELLING PRODUCTS */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 space-y-4">
                <span className="font-extrabold text-sm text-slate-750 dark:text-slate-205 block border-b border-slate-50 dark:border-slate-700 pb-2.5">
                  {isArabic ? "الأكثر مبيعاً" : "Top Selling Items"}
                </span>

                <div className="space-y-3">
                  {topSelling.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-3">
                        <div className="w-5 h-5 rounded-full bg-amber-50 dark:bg-amber-955/25 text-amber-550 dark:text-amber-450 font-bold flex items-center justify-center text-[10px]">
                          {idx + 1}
                        </div>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{item.name}</span>
                      </div>
                      <span className="font-black text-slate-500 dark:text-slate-400">{item.qty} {isArabic ? "مبيعات" : "sold"}</span>
                    </div>
                  ))}
                  {topSelling.length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">{isArabic ? "لا توجد مبيعات مسجلة بعد" : "No sales registered yet"}</p>
                  )}
                </div>
              </div>

              {/* ORDER DETAIL SLIDE PANEL */}
              {selectedOrder && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 space-y-4 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-slate-55/60 dark:border-slate-700 pb-2.5">
                    <span className="font-extrabold text-sm text-slate-750 dark:text-slate-205">
                      {isArabic ? "تفاصيل الطلب" : "Order Details"} #{selectedOrder.id.substring(0, 8)}
                    </span>
                    <button 
                      onClick={() => setSelectedOrder(null)} 
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>{isArabic ? "إغلاق" : "Close"}</span>
                    </button>
                  </div>

                  <div className="text-xs space-y-2 text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">{isArabic ? "التاريخ والوقت:" : "Date & Time:"}</span>
                      <span className="font-bold">{new Date(selectedOrder.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{isArabic ? "الحالة:" : "Status:"}</span>
                      <span className={`px-2 py-0.5 rounded font-bold ${getStatusColor(selectedOrder.status)}`}>
                        {getStatusLabel(selectedOrder.status)}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-[10px] font-bold text-slate-450 uppercase mb-2">{isArabic ? "العناصر المطلوبة:" : "Ordered Items:"}</p>
                    <div className="space-y-2.5">
                      {(orderItemsMap[selectedOrder.id] || []).map((item, idx) => {
                        const prod = products.find(p => p.id === item.product_id);
                        return (
                          <div key={idx} className="flex justify-between text-xs font-medium text-slate-700">
                            <span>{prod ? prod.name : 'منتج'} x{item.quantity}</span>
                            <span className="font-black">
                              {((parseFloat(item.price) || (parseFloat(item.subtotal || 0) / item.quantity)) * item.quantity).toFixed(2)} €
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 flex flex-col gap-2">
                    <button
                      onClick={async () => {
                        const printerIP = localStorage.getItem('local_printer_ip');
                        showNotification(isArabic ? "جاري إرسال تذكرة الفاتورة للطابعة..." : "Sending receipt print job...", "info");
                        // Format the receipt payload properly
                        const cartItems = (orderItemsMap[selectedOrder.id] || []).map(item => {
                          const prod = products.find(p => p.id === item.product_id);
                          return {
                            name: prod ? prod.name : (isArabic ? 'منتج غير معروف' : 'Product'),
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
                            order_type: 'takeaway'
                          }
                        };
                        
                        const res = await printReceipt(formattedOrder, printerIP, store ? store.name : 'Cashmint');
                        if (res.success) {
                          showNotification(
                            res.fallback 
                              ? (isArabic ? "تم فتح نافذة الطباعة للفاتورة 🖨️" : "Receipt print window opened 🖨️")
                              : (isArabic ? "تم إعادة طباعة الفاتورة 🖨️" : "Receipt reprinted successfully 🖨️")
                          );
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
