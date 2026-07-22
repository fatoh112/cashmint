import React from 'react';
import cashmintLogo from '../../assets/branding/cashmint-logo.png';

export default function LandingFooter({ onLoginClick }) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-950 border-t border-slate-800/80 text-slate-400 py-12 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          
          {/* Brand Info */}
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 select-none">
              <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm border border-slate-200/80">
                <img src={cashmintLogo} alt="Cashmint" className="h-8 max-w-[130px] object-contain w-auto" />
              </div>
            </div>
            <span className="text-xs text-slate-500 border-r border-slate-800 pr-3 mr-1">
              نظام نقاط بيع وإدارة مطاعم
            </span>
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold text-slate-300">
            <button
              type="button"
              onClick={onLoginClick}
              className="hover:text-amber-400 transition-colors cursor-pointer"
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={(e) => e.preventDefault()}
              className="hover:text-amber-400 transition-colors cursor-pointer text-slate-400 hover:text-slate-200"
            >
              سياسة الخصوصية
            </button>
            <button
              type="button"
              onClick={(e) => e.preventDefault()}
              className="hover:text-amber-400 transition-colors cursor-pointer text-slate-400 hover:text-slate-200"
            >
              الشروط والأحكام
            </button>
          </div>

        </div>

        {/* Bottom Copyright */}
        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <span>© {currentYear} Cashmint. جميع الحقوق محفوظة.</span>
          <span>تصميم مخصص لإدارة المطاعم</span>
        </div>

      </div>
    </footer>
  );
}
