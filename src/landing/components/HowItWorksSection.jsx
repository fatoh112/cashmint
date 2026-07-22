import React from 'react';
import { FilePlus2, Cpu, Rocket } from 'lucide-react';

const steps = [
  {
    number: '01',
    stepTitle: 'الخطوة الأولى',
    title: 'أضف المنيو',
    description: 'أضف المنتجات يدويًا أو استورد المنيو من ملف CSV.',
    icon: FilePlus2
  },
  {
    number: '02',
    stepTitle: 'الخطوة الثانية',
    title: 'اربط الأجهزة',
    description: 'اربط الطابعة وماكينة الدفع وتطبيق Android Bridge بالنظام.',
    icon: Cpu
  },
  {
    number: '03',
    stepTitle: 'الخطوة الثالثة',
    title: 'ابدأ البيع',
    description: 'استقبل الطلبات وراقب المبيعات والضرائب والتقارير من مكان واحد.',
    icon: Rocket
  }
];

export default function HowItWorksSection() {
  return (
    <section className="py-20 bg-white dark:bg-slate-900 border-t border-slate-200/60 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            كيف يعمل نظام Cashmint؟
          </h2>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 font-medium">
            ثلاث خطوات بسيطة تضمن لك بدء تشغيل مطعمك وتلقي الطلبات في دقائق معدودة.
          </p>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {steps.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="bg-slate-50 dark:bg-slate-850 p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 relative space-y-6 text-right flex flex-col justify-between group hover:shadow-lg transition-all duration-300"
              >
                {/* Number Badge */}
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white font-black text-lg flex items-center justify-center shadow-md shadow-amber-500/20">
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className="text-3xl font-black text-slate-300 dark:text-slate-700 font-mono">
                    {item.number}
                  </span>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">
                    {item.stepTitle}
                  </span>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">
                    {item.title}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
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
