import React from 'react';
import { MessageCircle, Mail, Send } from 'lucide-react';

export default function ContactSection() {
  const whatsappUrl = import.meta.env.VITE_CONTACT_WHATSAPP || '';
  const emailAddr = import.meta.env.VITE_CONTACT_EMAIL || '';

  const hasWhatsApp = Boolean(whatsappUrl.trim());
  const hasEmail = Boolean(emailAddr.trim());

  return (
    <section id="contact" className="py-20 bg-white dark:bg-slate-900 border-t border-slate-200/60 dark:border-slate-800 transition-colors">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-10">
        
        {/* Header */}
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold">
            <Send className="w-4 h-4" />
            <span>تواصل معنا</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            ابدأ باستخدام Cashmint
          </h2>

          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 font-medium max-w-xl mx-auto">
            تواصل معنا للحصول على تجربة للنظام ومناقشة احتياجات مطعمك.
          </p>
        </div>

        {/* Contact Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          
          {/* WhatsApp Button */}
          {hasWhatsApp ? (
            <a
              href={whatsappUrl.startsWith('http') ? whatsappUrl : `https://wa.me/${whatsappUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-base shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98]"
            >
              <MessageCircle className="w-5 h-5" />
              <span>تواصل عبر واتساب</span>
            </a>
          ) : (
            <button
              disabled
              type="button"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 font-bold text-base border border-slate-200 dark:border-slate-700 cursor-not-allowed"
            >
              <MessageCircle className="w-5 h-5 opacity-60" />
              <span>واتساب (سيتم إضافته قريباً)</span>
            </button>
          )}

          {/* Email Button */}
          {hasEmail ? (
            <a
              href={`mailto:${emailAddr}`}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-base border border-slate-800 shadow-md transition-all active:scale-[0.98]"
            >
              <Mail className="w-5 h-5" />
              <span>تواصل عبر البريد الإلكتروني</span>
            </a>
          ) : (
            <button
              disabled
              type="button"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 font-bold text-base border border-slate-200 dark:border-slate-700 cursor-not-allowed"
            >
              <Mail className="w-5 h-5 opacity-60" />
              <span>البريد (سيتم إضافته قريباً)</span>
            </button>
          )}

        </div>

      </div>
    </section>
  );
}
