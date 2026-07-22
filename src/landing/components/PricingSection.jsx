import React from 'react';
import { Check, ShieldAlert, ArrowLeft } from 'lucide-react';

const pricingFeatures = [
  'نظام نقاط بيع كامل',
  'إدارة المنيو والمنتجات',
  'سجل المبيعات والمعاملات',
  'إدارة الأجهزة والورديات',
  'ربط الدفع والطباعة',
  'مصمم الفواتير',
  'حساب الضرائب',
  'تقارير CSV وPDF',
  'تحديثات النظام',
  'دعم فني عن بُعد'
];

export default function PricingSection({ onOrderClick }) {
  return (
    <section id="pricing" className="py-20 bg-slate-50 dark:bg-slate-950 border-t border-slate-200/60 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            خطط أسعار واضحة وشفافة
          </h2>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 font-medium">
            باقة واحدة شاملة لكافة الخصائص والمميزات التي يحتاجها مطعمك.
          </p>
        </div>

        {/* Pricing Card Container */}
        <div className="max-w-lg mx-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-amber-500/40 shadow-xl p-8 sm:p-10 space-y-8 relative overflow-hidden text-right">
            
            {/* Top Accent Badge */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600" />
            
            {/* Title & Price Header */}
            <div className="space-y-4 border-b border-slate-100 dark:border-slate-800 pb-6">
              <span className="inline-block px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-xs">
                الباقة الشاملة
              </span>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">
                نظام Cashmint الكامل
              </h3>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-black text-slate-900 dark:text-white font-mono">
                  €59
                </span>
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
                  شهريًا
                </span>
              </div>

              <div className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/5 px-3 py-2 rounded-xl border border-amber-500/15">
                €299 إعداد وربط مرة واحدة
              </div>
            </div>

            {/* Included Features Checklist */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                المميزات المشمولة في الاشتراك:
              </h4>

              <ul className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
                {pricingFeatures.map((feat, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-medium">{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Clear Notice */}
            <div className="flex items-start gap-2.5 p-3.5 bg-slate-100 dark:bg-slate-800/60 rounded-xl text-xs text-slate-600 dark:text-slate-400 font-medium">
              <ShieldAlert className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
              <span>الأجهزة ورسوم Stripe غير مشمولة في الاشتراك.</span>
            </div>

            {/* CTA Button */}
            <button
              onClick={onOrderClick}
              type="button"
              className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black text-base shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>اطلب تجربة</span>
              <ArrowLeft className="w-5 h-5" />
            </button>

          </div>
        </div>

      </div>
    </section>
  );
}
