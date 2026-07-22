import React from 'react';
import { LogIn } from 'lucide-react';
import cashmintLogo from '../../assets/branding/cashmint-logo.png';

export default function LandingHeader({ onLoginClick }) {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Right side (RTL): Logo & Brand Name */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 select-none">
            <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm border border-slate-200/80">
              <img src={cashmintLogo} alt="Cashmint" className="h-8 max-w-[130px] object-contain w-auto" />
            </div>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:inline border-r border-slate-200 dark:border-slate-800 pr-3 mr-1">
            نظام إدارة المطاعم
          </span>
        </div>

        {/* Left side (RTL): Login Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={onLoginClick}
            type="button"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-extrabold shadow-md shadow-amber-500/15 hover:shadow-amber-500/25 transition-all active:scale-[0.98] cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            <span>تسجيل الدخول</span>
          </button>
        </div>

      </div>
    </header>
  );
}
