import React from 'react';
import cashmintLogo from '../../assets/branding/cashmint-logo.png';

/**
 * Cashmint official logo component
 * Supports header, sidebar, login screen, landing page, and compact navigation sizes.
 * Preserves exact aspect ratio and handles background contrast cleanly.
 */
export default function CashmintLogo({
  size = 'md',
  className = '',
  containerClassName = '',
  showWordmarkText = false,
  badgeBg = true
}) {
  const sizeMap = {
    xs: 'h-6 max-w-[100px]',
    sm: 'h-8 max-w-[130px]',
    md: 'h-10 max-w-[160px]',
    lg: 'h-14 max-w-[220px]',
    xl: 'h-20 max-w-[280px]',
  };

  const selectedSizeClass = sizeMap[size] || sizeMap.md;

  return (
    <div className={`inline-flex items-center gap-2 select-none ${containerClassName}`}>
      <div className={`relative flex items-center justify-center overflow-hidden rounded-xl ${badgeBg ? 'bg-white p-1 shadow-sm border border-slate-200/80' : ''}`}>
        <img
          src={cashmintLogo}
          alt="Cashmint"
          className={`object-contain w-auto ${selectedSizeClass} ${className}`}
        />
      </div>
      {showWordmarkText && (
        <span className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
          Cashmint
        </span>
      )}
    </div>
  );
}
