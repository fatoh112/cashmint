import React from 'react';
import { LogIn, UtensilsCrossed } from 'lucide-react';

export default function LandingHeader({ onLoginClick }) {
  return (
    <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        
        {/* Right side (RTL): Logo & Brand Name */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-400 p-0.5 shadow-lg shadow-amber-500/20 flex items-center justify-center flex-shrink-0">
            <div className="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center text-amber-400">
              <UtensilsCrossed className="w-6 h-6" />
            </div>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
                Cashmint
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                POS
              </span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              نظام إدارة المطاعم
            </span>
          </div>
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
