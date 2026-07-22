import React, { useState, useEffect } from 'react';
import { Share, X, Smartphone, Check } from 'lucide-react';
import { shouldShowIpadInstallGuide, dismissIpadInstallGuide } from '../utils/pwaIpadUtils';

export default function IpadInstallGuide() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(shouldShowIpadInstallGuide());
  }, []);

  if (!visible) return null;

  const handleDismiss = () => {
    dismissIpadInstallGuide();
    setVisible(false);
  };

  return (
    <div className="bg-slate-900 text-white px-4 py-3 border-b border-amber-500/40 shadow-lg relative z-50">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-3 dir-rtl">
          <div className="p-2 bg-amber-500/20 rounded-xl text-amber-400 shrink-0">
            <Share className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <p className="font-extrabold text-amber-300">
              تثبيت Cashmint POS على جهاز iPad
            </p>
            <p className="text-slate-300 text-[11px] sm:text-xs mt-0.5">
              للحصول على وضع ملء الشاشة واستقرار الكاشير: اضغط على زر المشاركة{' '}
              <span className="inline-flex items-center px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-amber-400">
                <Share className="w-3 h-3 inline ml-1" /> مشاركة / Share
              </span>{' '}
              ثم اختر <strong className="text-white">إضافة إلى الصفحة الرئيسية (Add to Home Screen)</strong>.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors shrink-0"
          title="إغلاق"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
