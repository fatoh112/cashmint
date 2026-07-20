import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { printReceipt } from '../utils/printerService';
import { 
  History, 
  Search, 
  Filter, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  Printer, 
  RefreshCw,
  Calendar,
  DollarSign,
  Tag,
  CreditCard,
  Utensils
} from 'lucide-react';
// oxlint-disable-next-line react/only-export-components
export const resolveOrderStatus = (order, isArabic) => {
  const orderStatus = order?.status;
  const paymentArr = Array.isArray(order?.payments) ? order.payments : (order?.payments ? [order.payments] : []);
  const hasPaidPayment = paymentArr.some(p => p.status === 'paid');

  // 1. Completed order with paid payment -> Green: Completed
  if (orderStatus === 'completed' && hasPaidPayment) {
    return {
      key: 'completed',
      label: isArabic ? 'مكتمل' : 'Completed',
      badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
    };
  }

  // 2. Completed order without paid payment row -> Amber: Requires Review
  if (orderStatus === 'completed' && !hasPaidPayment) {
    return {
      key: 'requires_review',
      label: isArabic ? 'يحتاج مراجعة' : 'Requires Review',
      badgeClass: 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700'
    };
  }

  // 3. Pending order but payment row IS paid -> Purple: Inconsistent
  if (orderStatus === 'pending' && hasPaidPayment) {
    return {
      key: 'inconsistent',
      label: isArabic ? 'غير متطابق' : 'Inconsistent',
      badgeClass: 'bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700'
    };
  }

  // 4. Pending -> Amber: Pending
  if (orderStatus === 'pending') {
    return {
      key: 'pending',
      label: isArabic ? 'قيد الانتظار' : 'Pending',
      badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
    };
  }

  // 5. Cancelled -> Red: Cancelled
  if (orderStatus === 'cancelled') {
    return {
      key: 'cancelled',
      label: isArabic ? 'ملغي' : 'Cancelled',
      badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800'
    };
  }

  // 6. Failed -> Dark Red: Failed
  if (orderStatus === 'failed') {
    return {
      key: 'failed',
      label: isArabic ? 'فاشل' : 'Failed',
      badgeClass: 'bg-red-900/10 text-red-900 border border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
    };
  }

  // 7. Expired -> Gray/Red: Expired
  if (orderStatus === 'expired') {
    return {
      key: 'expired',
      label: isArabic ? 'منتهي' : 'Expired',
      badgeClass: 'bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
    };
  }

  // Default Incomplete -> Gray: Incomplete
  return {
    key: 'incomplete',
    label: isArabic ? 'غير مكتمل' : 'Incomplete',
    badgeClass: 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
  };
};

const PAGE_SIZE = 50;

export default function FullTransactionHistory({ store, showNotification, isArabic }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [orderItemsMap, setOrderItemsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);

  // Filters State
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [minTotal, setMinTotal] = useState('');
  const [maxTotal, setMaxTotal] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const scrollContainerRef = useRef(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page to 1 whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, statusFilter, methodFilter, typeFilter, minTotal, maxTotal, debouncedSearch]);

  // Fetch full transaction history from Supabase with server-side pagination & filtering
  const fetchFullHistory = useCallback(async (isSilent = false) => {
    if (!store?.id) return;
    try {
      if (!isSilent) {
        setLoading(prev => orders.length === 0 ? true : prev);
      } else {
        setIsRefreshing(true);
      }

      // 1. Fetch products for item mapping if not loaded
      if (products.length === 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, name')
          .eq('store_id', store.id);
        if (prods) setProducts(prods);
      }

      // 2. Handle product search server-side (search order_items product_name_snapshot and products table)
      let matchingOrderIdsFromProducts = null;
      if (debouncedSearch) {
        let itemOrderIds = [];

        // Query order_items by store_id and product_name_snapshot ILIKE
        const { data: itemSnapshotMatches } = await supabase
          .from('order_items')
          .select('order_id')
          .eq('store_id', store.id)
          .ilike('product_name_snapshot', `%${debouncedSearch}%`)
          .limit(200);

        if (itemSnapshotMatches) {
          itemOrderIds = itemSnapshotMatches.map(i => i.order_id);
        }

        // Query products table for matching product names in this store
        const { data: matchedProducts } = await supabase
          .from('products')
          .select('id')
          .eq('store_id', store.id)
          .ilike('name', `%${debouncedSearch}%`);
        
        if (matchedProducts && matchedProducts.length > 0) {
          const matchedProdIds = matchedProducts.map(p => p.id);
          const { data: matchedItems } = await supabase
            .from('order_items')
            .select('order_id')
            .eq('store_id', store.id)
            .in('product_id', matchedProdIds)
            .limit(200);
          if (matchedItems) {
            itemOrderIds = [...itemOrderIds, ...matchedItems.map(i => i.order_id)];
          }
        }
        matchingOrderIdsFromProducts = Array.from(new Set(itemOrderIds));
      }

      // 3. Build order query
      let query = supabase
        .from('orders')
        .select('*, payments(*)', { count: 'exact' })
        .eq('store_id', store.id);

      if (dateFrom) {
        query = query.gte('created_at', new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endOfDay.toISOString());
      }
      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (methodFilter && methodFilter !== 'all') {
        query = query.eq('payment_method', methodFilter);
      }
      if (typeFilter && typeFilter !== 'all') {
        query = query.eq('order_type', typeFilter);
      }
      if (minTotal && !isNaN(parseFloat(minTotal))) {
        query = query.gte('total_amount', parseFloat(minTotal));
      }
      if (maxTotal && !isNaN(parseFloat(maxTotal))) {
        query = query.lte('total_amount', parseFloat(maxTotal));
      }
      if (debouncedSearch) {
        if (matchingOrderIdsFromProducts && matchingOrderIdsFromProducts.length > 0) {
          query = query.or(`receipt_number.ilike.%${debouncedSearch}%,id.ilike.%${debouncedSearch}%,id.in.(${matchingOrderIdsFromProducts.join(',')})`);
        } else {
          query = query.or(`receipt_number.ilike.%${debouncedSearch}%,id.ilike.%${debouncedSearch}%`);
        }
      }

      // Pagination
      const from = (page - 1) * PAGE_SIZE;
      const to = page * PAGE_SIZE - 1;

      query = query.order('created_at', { ascending: false }).range(from, to);

      const { data: ords, count, error: ordsErr } = await query;
      if (ordsErr) throw ordsErr;

      setOrders(ords || []);
      setTotalCount(count || 0);

      // Fetch items for displayed orders
      const orderIds = (ords || []).map(o => o.id);
      if (orderIds.length > 0) {
        const { data: ordItems } = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', orderIds);
        
        const map = {};
        (ordItems || []).forEach(item => {
          if (!map[item.order_id]) map[item.order_id] = [];
          map[item.order_id].push(item);
        });
        setOrderItemsMap(map);
      } else {
        setOrderItemsMap({});
      }

    } catch (err) {
      console.error("Error fetching full transaction history:", err);
      showNotification(isArabic ? "خطأ في تحميل سجل المعاملات" : "Error loading transaction history", "error");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [store?.id, dateFrom, dateTo, statusFilter, methodFilter, typeFilter, minTotal, maxTotal, debouncedSearch, page, products.length, isArabic, showNotification]);

  useEffect(() => {
    if (store?.id) {
      fetchFullHistory(false);

      const channel = supabase
        .channel(`full-history-realtime-${store.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${store.id}` },
          () => { fetchFullHistory(true); }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [store?.id, fetchFullHistory]);

  const handleResetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setStatusFilter('all');
    setMethodFilter('all');
    setTypeFilter('all');
    setMinTotal('');
    setMaxTotal('');
    setSearchQuery('');
    setPage(1);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  return (
    <div className="space-y-5" dir={isArabic ? 'rtl' : 'ltr'}>
      
      {/* Title & Refresh */}
      <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5 text-amber-500" />
            <span>{isArabic ? "سجل المعاملات بالكامل" : "Full Transaction History"}</span>
          </h2>
          <p className="text-xs text-slate-450 dark:text-slate-400 mt-1">
            {isArabic ? "عرض وتصفية كافة المعاملات والطلبات المسجلة من أول معاملة" : "Complete audit trail of all historical sales, pending, and cancelled transactions"}
          </p>
        </div>

        <button
          onClick={() => fetchFullHistory(false)}
          disabled={loading || isRefreshing}
          className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all active:scale-95 cursor-pointer"
          title={isArabic ? "تحديث" : "Refresh"}
        >
          <RefreshCw className={`w-4 h-4 ${(loading || isRefreshing) ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* FILTER BAR */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-amber-500" />
            {isArabic ? "تصفية المعاملات" : "Filter Transactions"}
          </span>
          <button
            onClick={handleResetFilters}
            className="text-[11px] font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{isArabic ? "إعادة ضبط الفلاتر" : "Reset Filters"}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          
          {/* Search Input */}
          <div className="relative sm:col-span-2">
            <Search className="w-3.5 h-3.5 absolute top-3 left-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isArabic ? "بحث برقم الطلب، الفاتورة أو اسم المنتج..." : "Search receipt, order ID, product..."}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-amber-500 text-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Date From */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">{isArabic ? "من تاريخ" : "Date From"}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">{isArabic ? "إلى تاريخ" : "Date To"}</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Status Filter */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">{isArabic ? "حالة المعاملة" : "Status"}</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            >
              <option value="all">{isArabic ? "الكل" : "All Statuses"}</option>
              <option value="completed">{isArabic ? "مكتمل (Completed)" : "Completed"}</option>
              <option value="pending">{isArabic ? "قيد الانتظار (Pending)" : "Pending"}</option>
              <option value="cancelled">{isArabic ? "ملغي (Cancelled)" : "Cancelled"}</option>
              <option value="failed">{isArabic ? "فاشل (Failed)" : "Failed"}</option>
              <option value="expired">{isArabic ? "منتهي (Expired)" : "Expired"}</option>
            </select>
          </div>

          {/* Payment Method */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">{isArabic ? "طريقة الدفع" : "Payment Method"}</label>
            <select
              value={methodFilter}
              onChange={e => setMethodFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            >
              <option value="all">{isArabic ? "الكل" : "All Methods"}</option>
              <option value="cash">{isArabic ? "نقداً (Cash)" : "Cash"}</option>
              <option value="card">{isArabic ? "بطاقة (Card)" : "Card"}</option>
            </select>
          </div>

          {/* Order Type */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">{isArabic ? "نوع الطلب" : "Order Type"}</label>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            >
              <option value="all">{isArabic ? "الكل" : "All Types"}</option>
              <option value="dine_in">{isArabic ? "محلي (Dine In)" : "Dine In"}</option>
              <option value="takeaway">{isArabic ? "سفري (Takeaway)" : "Takeaway"}</option>
            </select>
          </div>

          {/* Min Total */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">{isArabic ? "الحد الأدنى €" : "Min Total €"}</label>
            <input
              type="number"
              step="0.01"
              value={minTotal}
              onChange={e => setMinTotal(e.target.value)}
              placeholder="0.00"
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Max Total */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">{isArabic ? "الحد الأقصى €" : "Max Total €"}</label>
            <input
              type="number"
              step="0.01"
              value={maxTotal}
              onChange={e => setMaxTotal(e.target.value)}
              placeholder="999.00"
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200"
            />
          </div>

        </div>
      </div>

      {/* TABLE & DETAILS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* TRANSACTION HISTORY TABLE */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-2xl shadow-sm overflow-hidden lg:col-span-2">
          
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 flex justify-between items-center text-xs">
            <span className="font-extrabold text-slate-700 dark:text-slate-200">
              {isArabic ? `إجمالي النتائج: ${totalCount} معاملة` : `Total Results: ${totalCount} transactions`}
            </span>
            <span className="text-slate-400 font-medium">
              {isArabic ? `الصفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
            </span>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
              <p className="text-xs font-semibold text-slate-400">{isArabic ? "جاري تحميل سجل المعاملات..." : "Loading transaction history..."}</p>
            </div>
          ) : (
            <>
              {/* FIXED HEIGHT SCROLLABLE TABLE CONTAINER */}
              <div ref={scrollContainerRef} className="max-h-[520px] overflow-y-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 uppercase">
                    <tr>
                      <th className="p-3.5">{isArabic ? "رقم الطلب / الفاتورة" : "Order / Receipt"}</th>
                      <th className="p-3.5">{isArabic ? "التاريخ والوقت" : "Date & Time"}</th>
                      <th className="p-3.5">{isArabic ? "النوع" : "Type"}</th>
                      <th className="p-3.5">{isArabic ? "الدفع" : "Method"}</th>
                      <th className="p-3.5">{isArabic ? "المبلغ" : "Total"}</th>
                      <th className="p-3.5 text-center">{isArabic ? "الحالة" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-medium text-slate-700 dark:text-slate-300">
                    {orders.map(order => {
                      const dateStr = new Date(order.created_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      });
                      const receiptNum = order.receipt_number || `#${order.id.substring(0, 8)}`;
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
                            {receiptNum}
                          </td>
                          <td className="p-3.5 text-slate-500 dark:text-slate-400">{dateStr}</td>
                          <td className="p-3.5 text-slate-500 dark:text-slate-400">{typeLabel}</td>
                          <td className="p-3.5 text-slate-500 dark:text-slate-400">{methodLabel}</td>
                          <td className="p-3.5 font-black text-slate-800 dark:text-slate-200">
                            {parseFloat(order.total_amount || 0).toFixed(2)} €
                          </td>
                          <td className="p-3.5 text-center">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-block ${statusBadge.badgeClass}`}>
                              {statusBadge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-400 dark:text-slate-500">
                          {isArabic ? "لا توجد معاملات مطابقة للفلاتر المحددة" : "No transactions match the selected filters"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION CONTROLS */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 flex justify-between items-center text-xs">
                <button
                  onClick={() => setPage(p => Math.max(p - 1, 1))}
                  disabled={page <= 1}
                  className="px-3.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>{isArabic ? "السابق" : "Previous"}</span>
                </button>

                <span className="font-bold text-slate-600 dark:text-slate-300">
                  {isArabic ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
                </span>

                <button
                  onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                  disabled={page >= totalPages}
                  className="px-3.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <span>{isArabic ? "التالي" : "Next"}</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

        </div>

        {/* ORDER DETAILS PANEL */}
        <div className="space-y-4">
          {selectedOrder ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4 sticky top-6">
              <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
                <span className="font-extrabold text-sm text-slate-800 dark:text-white">
                  {isArabic ? "تفاصيل المعاملة" : "Transaction Details"}
                </span>
                <button 
                  onClick={() => setSelectedOrder(null)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-xs font-bold cursor-pointer"
                >
                  {isArabic ? "إغلاق" : "Close"}
                </button>
              </div>

              <div className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">{isArabic ? "رقم الفاتورة:" : "Receipt Number:"}</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-white">{selectedOrder.receipt_number || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isArabic ? "معرف الطلب:" : "Order ID:"}</span>
                  <span className="font-mono text-[10px] text-slate-500">{selectedOrder.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isArabic ? "التاريخ والوقت:" : "Date & Time:"}</span>
                  <span className="font-bold">{new Date(selectedOrder.created_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isArabic ? "طريقة الدفع:" : "Payment Method:"}</span>
                  <span className="font-bold uppercase">{selectedOrder.payment_method || 'cash'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">{isArabic ? "الحالة المحسوبة:" : "Calculated Status:"}</span>
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
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">{isArabic ? "العناصر:" : "Line Items:"}</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
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

              <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-1.5 text-xs">
                <div className="flex justify-between font-medium text-slate-500">
                  <span>{isArabic ? "المبلغ الصافي:" : "Net Amount:"}</span>
                  <span>{parseFloat(selectedOrder.subtotal_excl_vat || 0).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between font-medium text-slate-500">
                  <span>{isArabic ? "مبلغ الضريبة:" : "VAT Amount:"}</span>
                  <span>{parseFloat(selectedOrder.vat_amount || 0).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between font-black text-sm text-slate-800 dark:text-white pt-1 border-t border-slate-100 dark:border-slate-700">
                  <span>{isArabic ? "الإجمالي:" : "Grand Total:"}</span>
                  <span>{parseFloat(selectedOrder.total_amount || 0).toFixed(2)} €</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={async () => {
                    const printerIP = localStorage.getItem('local_printer_ip');
                    showNotification(isArabic ? "جاري طباعة الفاتورة..." : "Sending print job...", "info");
                    const cartItems = (orderItemsMap[selectedOrder.id] || []).map(item => {
                      const prod = products.find(p => p.id === item.product_id);
                      return {
                        name: prod ? prod.name : (item.product_name_snapshot || 'Product'),
                        price: parseFloat(item.price) || (parseFloat(item.subtotal || 0) / item.quantity),
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
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs py-2.5 rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>{isArabic ? "إعادة طباعة الفاتورة" : "Reprint Receipt"}</span>
                </button>
              </div>

            </div>
          ) : (
            <div className="bg-slate-100/50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-xs text-slate-400">
              {isArabic ? "انقر على أي معاملة لعرض التفاصيل وإعادة الطباعة" : "Click on any transaction row to view full breakdown and print receipt"}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
