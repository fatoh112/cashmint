import React from 'react';
import CashmintLogo from '../../components/branding/CashmintLogo';

export default function LandingFooter({ onLoginClick }) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-800 font-sans transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-slate-800/80">
          
          {/* Brand Info */}
          <div className="flex items-center gap-3">
            <CashmintLogo size="sm" badgeBg={true} />
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
