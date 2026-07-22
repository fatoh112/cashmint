import React from 'react';
import {
  ShoppingBag,
  Utensils,
  FileSpreadsheet,
  CreditCard,
  Printer,
  Smartphone,
  Clock,
  Sliders,
  Calculator,
  Download
} from 'lucide-react';

const features = [
  {
    icon: ShoppingBag,
    title: 'إدارة المبيعات',
    desc: 'تسجيل وتنفيذ مبيعات الكاشير والطلبات بسرعة ودقة متناهية.'
  },
  {
    icon: Utensils,
    title: 'إدارة المنيو والأسعار',
    desc: 'إضافة المنتجات والتصنيفات والخيارات وتحديد الأسعار بسهولة.'
  },
  {
    icon: FileSpreadsheet,
    title: 'استيراد CSV',
    desc: 'رفع وتحديث المنيو والمنتجات دفعة واحدة عبر ملفات CSV.'
  },
  {
    icon: CreditCard,
    title: 'ربط WisePad 3',
    desc: 'تكامل مباشر مع ماكينات الدفع والبطاقات الإلكترونية.'
  },
  {
    icon: Printer,
    title: 'ربط طابعة الفواتير',
    desc: 'طباعة فورية للمطابخ وفواتير العملاء عبر شبكة IP المحلية.'
  },
  {
    icon: Smartphone,
    title: 'إدارة الأجهزة',
    desc: 'مراقبة حالة اتصال نقاط البيع والشاشات والطابعات.'
  },
  {
    icon: Clock,
    title: 'إدارة الورديات',
    desc: 'متابعة بداية ونهاية كل وردية مع حساب النقدية والمبيعات.'
  },
  {
    icon: Sliders,
    title: 'تصميم الفواتير',
    desc: 'تخصيص معلومات الفاتورة والشعار وبيانات الضريبة للمطعم.'
  },
  {
    icon: Calculator,
    title: 'حساب الضرائب',
    desc: 'احتساب دقيق لنسب الضريبة حسب نوع الطلب (صالة / سفري).'
  },
  {
    icon: Download,
    title: 'تصدير CSV وPDF',
    desc: 'تصدير التقارير المالية والضريبية وسجل المعاملات بسهولة.'
  }
];

export default function FeaturesSection() {
  return (
    <section id="features" className="py-20 bg-slate-50 dark:bg-slate-950 border-t border-slate-200/60 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            مميزات متكاملة لإدارة كل تفاصيل مطعمك
          </h2>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 font-medium">
            مجموعة واسعة من الأدوات والخصائص المصممة خصيصاً لرفع كفاءة تشغيل المطاعم.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {features.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-amber-500/30 transition-all duration-300 flex flex-col justify-between space-y-4 group text-right"
              >
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
