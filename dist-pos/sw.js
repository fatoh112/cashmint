/**
 * Cashmint POS - Production Service Worker
 * Network-First Strategy for Navigation & Safe Static Asset Caching
 */

const CACHE_NAME = 'cashmint-pos-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // 1. Never intercept non-GET requests (POST, PUT, DELETE, OPTIONS)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 2. Explicitly BYPASS caching for all dynamic/sensitive services:
  // - Supabase API & Auth
  // - Stripe & Payment Terminals
  // - Local Epson / Thermal printer IPs & ports
  // - Authentication callbacks & OAuth
  const isSupabase = url.hostname.includes('supabase') || url.pathname.includes('/rest/v1') || url.pathname.includes('/auth/v1');
  const isStripe = url.hostname.includes('stripe.com') || url.pathname.includes('stripe');
  const isPrinter = url.pathname.includes('/printing') || url.port === '8008' || url.port === '8043' || url.hostname.startsWith('192.168.') || url.hostname.startsWith('10.');
  const isAuth = url.pathname.includes('/auth') || url.search.includes('error=') || url.pathname.includes('callback');

  if (isSupabase || isStripe || isPrinter || isAuth) {
    return; // Pass through directly to browser network without SW intervention
  }

  // 3. Navigation requests (HTML pages): Network-First
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 4. Static Assets (JS, CSS, Images, Fonts): Stale-While-Revalidate or Network-First
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
