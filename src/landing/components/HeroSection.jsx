import React from 'react';
import { ArrowLeft, Sparkles, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';
import ScreenshotPlaceholder from './ScreenshotPlaceholder';

export default function HeroSection({ onPrimaryClick, onSecondaryClick }) {
  return (
    <section className="relative overflow-hidden py-16 sm:py-24 bg-gradient-to-b from-slate-50 via-white to-slate-50/50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 transition-colors">
      
      {/* Decorative ambient background glows */}
      <div className="absolute top-10 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Text Content */}
          <div className="lg:col-span-6 space-y-8 text-right">
            
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold shadow-xs">
              <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
              <span>الحل الذكي المتكامل لإدارة المطاعم</span>
            </div>

            {/* Main Heading */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 dark:text-white tracking-tight leading-[1.2]">
              نظام متكامل <br className="hidden sm:inline" />
              <span className="bg-clip-text text-transparent bg-gradient-to-l from-amber-500 via-orange-500 to-amber-600">
                لإدارة مطعمك
              </span>
            </h1>

            {/* Description */}
            <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 font-normal leading-relaxed max-w-2xl">
              تحكم في المبيعات والمنيو والأجهزة والضرائب من مكان واحد، بواجهة سهلة وسريعة مصممة لاحتياجات المطاعم.
            </p>

            {/* Bullet features summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs font-bold text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span>ربط فوري بأجهزة الدفع والطابعات</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span>تقارير وتصدير الضرائب بضغطة زر</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span>إدارة المنيو واستيراد CSV بسهولة</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <span>سرعة عالية بدون أي تعقيد</span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-4">
              <button
                onClick={onPrimaryClick}
                type="button"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-extrabold text-base shadow-lg shadow-amber-500/25 transition-all active:scale-[0.98] cursor-pointer"
              >
                <span>اطلب تجربة للنظام</span>
                <ArrowLeft className="w-5 h-5" />
              </button>

              <button
                onClick={onSecondaryClick}
                type="button"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-base border border-slate-200 dark:border-slate-700 shadow-sm transition-all active:scale-[0.98] cursor-pointer"
              >
                <span>شاهد مميزات النظام</span>
              </button>
            </div>

          </div>

          {/* Large Screenshot / Mockup Preview */}
          <div className="lg:col-span-6 relative">
            <div className="relative mx-auto max-w-lg lg:max-w-none">
              
              {/* Highlight backdrop glow */}
              <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500 to-orange-500 opacity-20 blur-xl group-hover:opacity-30 transition duration-1000" />
              
              <div className="relative">
                <ScreenshotPlaceholder
                  type="sales"
                  title="شاشة المبيعات والكاشير الرئيسية"
                  description="واجهة تفاعلية وسريعة تمكنك من استقبال الطلبات وإدارتها بدقة متناهية."
                />
              </div>

              {/* Floating feature pills */}
              <div className="absolute -bottom-6 -right-6 hidden sm:flex items-center gap-3 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-4 py-3 rounded-2xl shadow-xl z-20">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">سرعة معالجة فورية</div>
                  <div className="text-[11px] text-slate-500">طباعة ودفع لم ينقطع</div>
                </div>
              </div>

              <div className="absolute -top-6 -left-6 hidden sm:flex items-center gap-3 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-4 py-3 rounded-2xl shadow-xl z-20">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">أمان واستقرار عالي</div>
                  <div className="text-[11px] text-slate-500">حفظ البيانات في السحابة</div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
