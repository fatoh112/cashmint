import React, { useState, useEffect, useCallback } from 'react';
import { X, UserPlus, Trash2, Shield, User, Loader2, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { supabase } from '../../supabaseClient';

export default function UserManagerDrawer({ isOpen, onClose, storeId, storeName, isArabic }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [isAdding, setIsAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('cashier'); // 'admin' or 'cashier'
  const [aiEnabledInput, setAiEnabledInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);

  // Fetch Users
  const fetchUsers = useCallback(async () => {
    if (!storeId) return;
    try {
      setLoading(true);
      setError(null);
      
      const { data, error: fetchErr } = await supabase
        .from('store_users')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;

      // Resolve emails for each user mapping in parallel
      const usersWithEmails = await Promise.all(
        (data || []).map(async (u) => {
          try {
            const { data: emailData, error: rpcErr } = await supabase
              .rpc('get_user_email', { user_uuid: u.user_id });
            if (rpcErr) throw rpcErr;
            return { ...u, email: emailData || 'No Email Registered' };
          } catch (err) {
            console.error(`Error resolving email for user ${u.user_id}:`, err);
            return { ...u, email: 'Awaiting Resolution' };
          }
        })
      );

      setUsers(usersWithEmails);
    } catch (err) {
      console.error('Error fetching users:', err);
      const dbErrorMessage = err.message || err.details || '';
      setError(
        isArabic 
          ? `حدث خطأ أثناء تحميل المستخدمين: ${dbErrorMessage}` 
          : `Failed to fetch store users: ${dbErrorMessage}`
      );
    } finally {
      setLoading(false);
    }
  }, [storeId, isArabic]);

  // Real-time synchronization subscription
  useEffect(() => {
    if (!isOpen || !storeId) return;

    fetchUsers();

    // Subscribe to public.store_users changes filtered by store_id
    const channel = supabase
      .channel(`realtime-store-users-${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'store_users',
          filter: `store_id=eq.${storeId}`
        },
        async (payload) => {
          console.log('Realtime change in store_users:', payload);
          
          if (payload.eventType === 'INSERT') {
            // Check if user is already in state to prevent duplicates
            setUsers((prev) => {
              if (prev.some(u => u.id === payload.new.id)) return prev;
              
              // We need to resolve the email first, so fetch asynchronously and patch state
              supabase
                .rpc('get_user_email', { user_uuid: payload.new.user_id })
                .then(({ data: emailData }) => {
                  setUsers(current => 
                    current.map(u => 
                      u.id === payload.new.id 
                        ? { ...u, email: emailData || 'No Email Registered' } 
                        : u
                    )
                  );
                });

              // Add placeholder immediately
              const newUser = { ...payload.new, email: 'Resolving...' };
              return [newUser, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            setUsers((prev) =>
              prev.map((u) => {
                if (u.id === payload.new.id) {
                  // Keep already resolved email
                  return { ...u, ...payload.new };
                }
                return u;
              })
            );
          } else if (payload.eventType === 'DELETE') {
            setUsers((prev) => prev.filter((u) => u.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, storeId, fetchUsers]);

  // Handle auto-dismiss success alerts
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Assign/Create new user
  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);

      // Invoke Deno Edge Function to create Auth user and map store relation (including AI access toggle)
      const { data, error: funcErr } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: email.trim(),
          password: password.trim(),
          role: role,
          store_id: storeId,
          ai_enabled: aiEnabledInput
        }
      });

      if (funcErr) throw funcErr;
      if (data?.error) throw new Error(data.error);

      setSuccess(
        isArabic 
          ? 'تم إنشاء حساب المستخدم وتعيينه للمتجر بنجاح' 
          : 'User account created and assigned successfully'
      );
      setEmail('');
      setPassword('');
      setRole('cashier');
      setAiEnabledInput(false);
      setIsAdding(false);
    } catch (err) {
      console.error('Error adding user:', err);
      const msg = err.message || err.details || '';
      setError(isArabic ? `فشل إضافة المستخدم: ${msg}` : `Failed to map user: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Revoke user access & delete account
  const handleRemoveUser = async (u) => {
    const confirmMsg = isArabic 
      ? `هل أنت متأكد من إلغاء صلاحية وحذف هذا المستخدم نهائياً؟` 
      : `Are you sure you want to revoke access and permanently delete this user account?`;
    
    if (!window.confirm(confirmMsg)) return;

    try {
      setDeletingUserId(u.id);
      setError(null);
      setSuccess(null);

      // Invoke Deno Edge Function to delete Auth account and clean up database mappings
      const { data, error: deleteErr } = await supabase.functions.invoke('admin-delete-user', {
        body: { user_id: u.user_id }
      });

      if (deleteErr) throw deleteErr;
      if (data?.error) throw new Error(data.error);

      setSuccess(isArabic ? 'تم حذف المستخدم وإلغاء صلاحياته بنجاح' : 'User account and access revoked successfully');
    } catch (err) {
      console.error('Error deleting user:', err);
      const msg = err.message || err.details || '';
      setError(isArabic ? `فشل حذف المستخدم: ${msg}` : `Failed to revoke user access: ${msg}`);
    } finally {
      setDeletingUserId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[280] flex justify-end">
      {/* Drawer Overlay backdrop */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />

      {/* Main Drawer Slide-over Container (Slate/Cyan Dark Theme) */}
      <div 
        className="w-full max-w-lg bg-slate-900 border-l border-slate-800 h-screen flex flex-col shadow-2xl relative animate-slide-left text-right"
        dir={isArabic ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-cyan-400" />
              <span>{isArabic ? "إدارة مستخدمي المتجر" : "Store User Management"}</span>
            </h3>
            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">
              {isArabic ? `المتجر: ${storeName}` : `Store: ${storeName}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Notifications */}
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex items-start gap-2.5 text-rose-400 text-xs">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="font-bold leading-relaxed">{error}</span>
            </div>
          )}

          {success && (
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 flex items-start gap-2.5 text-cyan-400 text-xs">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="font-bold leading-relaxed">{success}</span>
            </div>
          )}

          {/* Quick Add Form Section */}
          {isAdding ? (
            <div className="bg-slate-850 border border-slate-850 p-5 rounded-2xl space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <h4 className="text-xs font-black text-white flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4 text-cyan-400" />
                  <span>{isArabic ? "إنشاء وتعيين مستخدم جديد" : "Create & Assign New User"}</span>
                </h4>
                <button 
                  onClick={() => setIsAdding(false)} 
                  className="text-[10px] text-slate-400 hover:text-white font-bold cursor-pointer"
                >
                  {isArabic ? "إلغاء" : "Cancel"}
                </button>
              </div>

              <form onSubmit={handleAddUser} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">
                    {isArabic ? "البريد الإلكتروني" : "Email Address"}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                    dir="ltr"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">
                    {isArabic ? "كلمة المرور" : "Password"}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-left"
                    dir="ltr"
                    minLength={6}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 block">
                    {isArabic ? "الصلاحية / الدور" : "Assign Role"}
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-750 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-cyan-500 text-right"
                  >
                    <option value="cashier" className="bg-slate-900 text-white">{isArabic ? "كاشير / موظف مبيعات" : "Cashier"}</option>
                    <option value="admin" className="bg-slate-900 text-white">{isArabic ? "مدير الفرع / Admin" : "Store Admin"}</option>
                  </select>
                </div>

                {/* AI Access Toggle */}
                <div className="flex items-center justify-between p-3.5 bg-slate-900 border border-slate-750 rounded-xl select-none">
                  <div className="text-right">
                    <p className="text-xs font-bold text-white">{isArabic ? "صلاحية الذكاء الاصطناعي (AI Access)" : "AI Access Permission"}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">{isArabic ? "تمكين المستخدم من الاستعانة بمحلل الأعمال الذكي" : "Allow user to consult the AI Business Analyst"}</p>
                  </div>
                  <div 
                    onClick={() => setAiEnabledInput(!aiEnabledInput)}
                    className={`w-9 h-5 rounded-full p-0.5 cursor-pointer flex items-center border transition-all duration-200 shrink-0 ${
                      aiEnabledInput 
                        ? 'bg-cyan-500/20 border-cyan-500/30 justify-end' 
                        : 'bg-slate-800 border-slate-750 justify-start'
                    }`}
                  >
                    <div className={`w-3.8 h-3.8 rounded-full transition-all duration-200 ${
                      aiEnabledInput ? 'bg-cyan-400' : 'bg-slate-500'
                    }`} />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-800 text-slate-950 disabled:text-slate-550 rounded-xl font-extrabold text-xs shadow-lg shadow-cyan-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>{isArabic ? "إنشاء وتعيين المستخدم" : "Create & Assign User"}</span>
                  )}
                </button>
              </form>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="w-full py-3 bg-slate-800 hover:bg-slate-750 active:scale-[0.99] text-cyan-400 rounded-xl font-bold text-xs border border-cyan-500/10 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>{isArabic ? "إنشاء وتعيين مستخدم جديد للمتجر" : "Create & Assign New User"}</span>
            </button>
          )}

          {/* User List */}
          <div className="space-y-3">
            <h4 className="text-xs font-black text-slate-400 pb-2 border-b border-slate-800">
              {isArabic ? "المستخدمون الحاليون بالفرع" : "Mapped Store Staff"}
            </h4>

            {loading && users.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                <p className="text-[10px] text-slate-400 font-bold">{isArabic ? "جاري تحميل قائمة المستخدمين..." : "Fetching active staff list..."}</p>
              </div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center bg-slate-850/30 rounded-2xl border border-slate-850/60 border-dashed">
                <p className="text-xs text-slate-500 font-bold">{isArabic ? "لا يوجد مستخدمون معينون لهذا المتجر حالياً" : "No staff members mapped to this store"}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {users.map((u) => (
                  <div key={u.id} className="bg-slate-850 border border-slate-850/60 p-4 rounded-2xl flex items-center justify-between gap-4 hover:border-slate-750 transition-colors">
                    <div className="flex items-start gap-3 text-right">
                      <div className={`p-2.5 rounded-xl mt-0.5 ${
                        u.role === 'admin' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {u.role === 'admin' ? <Shield className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-extrabold text-white truncate max-w-[220px]" dir="ltr">{u.email}</p>
                        <p className="text-[9px] font-mono text-slate-550 select-all" dir="ltr">{u.user_id}</p>
                        <div className="flex items-center gap-1.5 justify-start text-[9px] text-slate-450">
                          <span className="font-bold px-1.5 py-0.2 bg-slate-800 rounded capitalize font-sans">
                            {u.role === 'admin' ? (isArabic ? 'مدير الفرع' : 'Admin') : (isArabic ? 'كاشير' : 'Cashier')}
                          </span>
                          {u.ai_enabled && (
                            <span className="flex items-center gap-0.5 text-cyan-400 font-extrabold px-1.5 py-0.2 bg-cyan-950/40 border border-cyan-500/20 rounded-full text-[8px]">
                              <Sparkles className="w-2.5 h-2.5 animate-pulse" />
                              <span>{isArabic ? "ذكاء اصطناعي" : "AI"}</span>
                            </span>
                          )}
                          <span>•</span>
                          <span>{new Date(u.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveUser(u)}
                      disabled={deletingUserId === u.id}
                      className="p-2 hover:bg-slate-800 text-slate-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title={isArabic ? "إلغاء صلاحية الوصول وحذف الحساب" : "Revoke Access & Delete Account"}
                    >
                      {deletingUserId === u.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
