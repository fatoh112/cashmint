import React from 'react';
import ScreenshotPlaceholder from './ScreenshotPlaceholder';

const showcaseItems = [
  {
    id: 'sales',
    title: 'لوحة المبيعات',
    description: 'تابع معاملات البيع وأداء المطعم خلال آخر 24 ساعة من لوحة واضحة وسهلة الاستخدام.',
    type: 'sales',
  },
  {
    id: 'transactions',
    title: 'سجل المعاملات',
    description: 'راجع جميع الطلبات والمعاملات السابقة مع تفاصيل الدفع والضرائب والفواتير.',
    type: 'transactions',
  },
  {
    id: 'menu',
    title: 'إدارة المنيو',
    description: 'أضف المنتجات والتصنيفات وعدّل الأسعار والخيارات بسهولة، مع إمكانية استيراد المنيو من ملف CSV.',
    type: 'menu',
  },
  {
    id: 'invoice',
    title: 'مصمم الفواتير',
    description: 'جهّز شكل الفاتورة وحدد المعلومات التي تريد ظهورها بما يناسب هوية مطعمك.',
    type: 'invoice',
  },
  {
    id: 'devices',
    title: 'إدارة الأجهزة',
    description: 'راقب أجهزة نقاط البيع والطابعات وتطبيق الدفع وحالة الاتصال من مكان واحد.',
    type: 'devices',
  },
  {
    id: 'reports',
    title: 'التقارير والضرائب',
    description: 'احسب الضرائب لكل طلب وصدّر تقارير المبيعات والضريبة بصيغ CSV وPDF خلال الفترة التي تحددها.',
    type: 'reports',
  },
];

export default function SystemShowcase() {
  return (
    <section id="showcase" className="py-20 bg-white dark:bg-slate-900 border-t border-slate-200/60 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            استعرض شاشات ومميزات النظام
          </h2>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 font-medium">
            صُمم نظام Cashmint بعناية ليلبي متطلبات إدارة التشغيل والتحكم الكامل في المطعم.
          </p>
        </div>

        {/* Alternating Showcase Blocks */}
        <div className="space-y-16 sm:space-y-24">
          {showcaseItems.map((item, index) => {
            const isEven = index % 2 === 0;

            return (
              <div
                key={item.id}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center"
              >
                {/* Visual Screenshot / Container */}
                <div
                  className={`lg:col-span-7 ${
                    isEven ? 'lg:order-1' : 'lg:order-2'
                  }`}
                >
                  <ScreenshotPlaceholder
                    type={item.type}
                    title={item.title}
                    description={item.description}
                  />
                </div>

                {/* Text Description */}
                <div
                  className={`lg:col-span-5 space-y-4 text-right ${
                    isEven ? 'lg:order-2' : 'lg:order-1'
                  }`}
                >
                  <span className="inline-block text-xs font-black tracking-wider text-amber-600 dark:text-amber-400 uppercase bg-amber-500/10 px-3 py-1 rounded-md border border-amber-500/20">
                    قسم 0{index + 1}
                  </span>

                  <h3 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                    {item.title}
                  </h3>

                  <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
                    {item.description}
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
