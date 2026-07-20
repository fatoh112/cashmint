import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { 
  MessageSquare, 
  X, 
  Send, 
  Sparkles, 
  Bot, 
  User,
  Lock,
  Loader2
} from 'lucide-react';

export default function AIChatWidget({ isArabic, isSuperAdmin = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(isSuperAdmin);
  const [checkingAuth, setCheckingAuth] = useState(!isSuperAdmin);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: isArabic 
        ? "مرحباً! أنا محلل الأعمال الذكي الخاص بك. كيف يمكنني مساعدتك في تحليل منيو مطعمك أو تحسين مبيعاتك اليوم؟" 
        : "Hello! I am your AI Business Analyst. How can I help you analyze your menu or optimize store sales today?"
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef(null);

  // Check AI permission for standard cashier/admin users
  useEffect(() => {
    if (isSuperAdmin) {
      setAiEnabled(true);
      setCheckingAuth(false);
      return;
    }

    const checkAiAccess = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data, error: _error } = await supabase
            .from('store_users')
            .select('ai_enabled')
            .eq('user_id', user.id)
            .maybeSingle();

          if (data) {
            setAiEnabled(!!data.ai_enabled);
          }
        }
      } catch (err) {
        console.error("Error checking AI access:", err);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAiAccess();
  }, [isSuperAdmin]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [isOpen, messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    // Add empty assistant placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const chatHistory = messages
        .filter((_, idx) => idx > 0)
        .concat(userMessage)
        .map(({ role, content }) => ({ role, content }));

      // Call Deno Edge Function securely
      const { data: funcData, error: funcErr } = await supabase.functions.invoke('ai-business-analyst', {
        body: { 
          messages: chatHistory, 
          is_superadmin: isSuperAdmin 
        }
      });

      if (funcErr) throw funcErr;
      if (funcData?.error) throw new Error(funcData.error);

      const assistantMessage = funcData?.message?.content || "";
      
      setMessages(prev => {
        const next = [...prev];
        if (next.length > 0) {
          next[next.length - 1] = {
            role: 'assistant',
            content: assistantMessage
          };
        }
        return next;
      });

    } catch (err) {
      console.error("AI Chat Error:", err);
      // Clean up the empty assistant placeholder if failed
      setMessages(prev => {
        const next = [...prev];
        const lastMsg = next[next.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
          next.pop();
        }
        return [
          ...next,
          {
            role: 'assistant',
            content: isArabic 
              ? "عذراً، حدث خطأ أثناء الاتصال بمساعد الذكاء الاصطناعي. يرجى المحاولة مرة أخرى." 
              : "Sorry, an error occurred while connecting to the AI assistant. Please try again."
          }
        ];
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Action Button (FAB) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 left-6 w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-2xl z-40 hover:scale-105 active:scale-95 transition-all animate-pulse"
        title="AI Assistant"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>

      {/* Floating Chat Sidebar/Popup Panel */}
      {isOpen && (
        <div 
          dir={isArabic ? 'rtl' : 'ltr'}
          className="fixed bottom-24 left-6 w-96 h-[520px] bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-40 animate-fade-in"
        >
          {/* Header */}
          <div className="p-4 bg-indigo-600 text-white flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-white/10 rounded-xl text-white">
                <Bot className="w-5 h-5" />
              </div>
              <div className="text-right">
                <h3 className="text-xs font-black leading-none">{isArabic ? "محلل الأعمال الذكي" : "AI Business Analyst"}</h3>
                <p className="text-[9px] font-bold text-indigo-200 mt-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  <span>Kimi k2.6 Engine</span>
                </p>
              </div>
            </div>
            
            <button 
              onClick={() => setIsOpen(false)} 
              className="text-indigo-200 hover:text-white transition-all"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Messages list area or Locked state overlay */}
          {checkingAuth ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50/50 dark:bg-slate-900/50">
              <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
              <p className="text-[10px] text-slate-400 dark:text-slate-400 font-bold mt-2">
                {isArabic ? "جاري التحقق من الصلاحيات..." : "Verifying permissions..."}
              </p>
            </div>
          ) : !aiEnabled ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-slate-50/50 dark:bg-slate-900/50 select-none">
              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 rounded-full text-rose-500">
                <Lock className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-sm font-black text-slate-800 dark:text-white">
                  {isArabic ? "المساعد الذكي مغلق" : "AI Assistant Locked"}
                </h4>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-relaxed">
                  {isArabic 
                    ? "تواصل مع الإدارة لتفعيل المساعد الذكي لموظفي هذا الفرع." 
                    : "Please contact administration to activate the AI assistant."}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50 dark:bg-slate-900/50">
              {messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                if (!msg.content && msg.role === 'assistant') return null;
                return (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-2.5 max-w-[85%] ${
                      isUser ? (isArabic ? 'mr-auto flex-row-reverse' : 'ml-auto') : ''
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                      isUser ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 dark:bg-slate-700 text-slate-655 dark:text-slate-200'
                    }`}>
                      {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>
                    
                    <div className={`rounded-2xl p-3 text-xs leading-relaxed ${
                      isUser 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-white dark:bg-slate-700 border border-slate-150 dark:border-slate-600 text-slate-800 dark:text-white rounded-tl-none shadow-sm'
                    }`}>
                      <p className="whitespace-pre-wrap font-semibold">{msg.content}</p>
                    </div>
                  </div>
                );
              })}
              
              {/* Typing indicator */}
              {loading && (
                <div className="flex items-start gap-2.5 max-w-[85%]">
                  <div className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-655 dark:text-slate-200 shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="bg-white dark:bg-slate-700 border border-slate-150 dark:border-slate-600 rounded-2xl rounded-tl-none p-3.5 shadow-sm flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Footer Input Bar */}
          <form onSubmit={handleSendMessage} className="p-3 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                !aiEnabled 
                  ? (isArabic ? "المساعد الذكي غير متاح" : "AI Assistant is unavailable")
                  : (isArabic ? "اسأل عن أداء المبيعات أو المنيو..." : "Ask about sales or menus...")
              }
              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-indigo-500 rounded-xl text-xs font-semibold placeholder-slate-350 dark:placeholder-slate-500 text-slate-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !aiEnabled}
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || !aiEnabled}
              className="p-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:bg-indigo-300 dark:disabled:bg-indigo-900/50 dark:disabled:text-indigo-400 text-white rounded-xl transition-all"
            >
              <Send className="w-4.5 h-4.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
