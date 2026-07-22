/**
 * iPad & PWA Standalone Mode Utilities for Cashmint POS
 */

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator?.standalone === true ||
    document.referrer?.includes('android-app://') === true
  );
}

export function isIosOrIpad() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isIosDevice = /iPad|iPhone|iPod/.test(ua);
  const isMacTouch = /Macintosh/.test(ua) && (window.navigator.maxTouchPoints > 1);
  return isIosDevice || isMacTouch;
}

export function shouldShowIpadInstallGuide() {
  if (typeof window === 'undefined') return false;
  // Show only if iOS/iPad, NOT in standalone mode, and user hasn't permanently dismissed it
  if (!isIosOrIpad()) return false;
  if (isStandalone()) return false;
  const dismissed = localStorage.getItem('cashmint_pos_pwa_guide_dismissed');
  return dismissed !== 'true';
}

export function dismissIpadInstallGuide() {
  if (typeof window !== 'undefined') {
    localStorage.setItem('cashmint_pos_pwa_guide_dismissed', 'true');
  }
}

export function registerPosServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('Cashmint POS: New version available');
              const userConfirmed = window.confirm(
                'يتوفر تحديث جديد لنظام نقاط البيع Cashmint POS. هل تريد التحديث والتنشيط الآن؟'
              );
              if (userConfirmed) {
                window.location.reload();
              }
            }
          });
        }
      });
    }).catch((err) => {
      console.warn('Cashmint POS SW registration failed:', err);
    });
  });
}
