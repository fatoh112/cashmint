import React from 'react';
import { LayoutDashboard, Receipt, Utensils, Sliders, Smartphone, BarChart3, CheckCircle2 } from 'lucide-react';
import { LANDING_ASSETS } from '../../assets/landing';

const showcaseIcons = {
  sales: LayoutDashboard,
  transactions: Receipt,
  menu: Utensils,
  invoice: Sliders,
  devices: Smartphone,
  reports: BarChart3,
};

export default function ScreenshotPlaceholder({ type = 'sales', title, description }) {
  const assetInfo = LANDING_ASSETS[type] || LANDING_ASSETS.sales;
  const displayTitle = title || assetInfo.title;
  const placeholderLabel = assetInfo.placeholderLabel;
  const Icon = showcaseIcons[type] || LayoutDashboard;

  return (
    <div className="w-full h-full min-h-[260px] sm:min-h-[320px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 p-4 sm:p-6 text-slate-100 flex flex-col justify-between shadow-xl relative overflow-hidden group select-none">
      {/* Decorative ambient background blur */}
      <div className="absolute -top-16 -right-16 w-36 h-36 bg-amber-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-amber-500/20 transition-all duration-500" />
      <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-500/20 transition-all duration-500" />

      {/* Header mock bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
          <span className="text-[11px] font-mono text-slate-500 mr-2">cashmint-app://{type}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-full text-[11px] font-medium text-amber-400 border border-amber-500/20">
          <Icon className="w-3.5 h-3.5" />
          <span>{displayTitle}</span>
        </div>
      </div>

      {/* Mock UI Body */}
      <div className="flex-1 flex flex-col justify-center items-center py-6 text-center px-4 relative z-10 space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner group-hover:scale-105 transition-transform duration-300">
          <Icon className="w-8 h-8" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h4 className="font-bold text-base text-white">{displayTitle}</h4>
          {description && <p className="text-xs text-slate-400 leading-relaxed">{description}</p>}
        </div>
        
        {/* Placeholder badge indicator */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-800/90 text-slate-300 text-[11px] border border-slate-700/60 mt-2">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>{placeholderLabel}</span>
        </div>
      </div>

      {/* Footer bar mock */}
      <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between text-[11px] text-slate-500">
        <span>وضع للعرض والتوضيح</span>
        <span className="font-mono text-amber-500/80">Cashmint POS v2.4</span>
      </div>
    </div>
  );
}
