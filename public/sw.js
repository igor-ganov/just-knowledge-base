/**
 * App-shell service worker (AC-6.3, AC-6.4). Caches ONLY the static shell:
 * navigations and same-origin static assets. Vault data lives in IndexedDB
 * and never passes through fetch, so no plaintext can end up here (AC-9.3).
 */
const CACHE = 'jkb-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
};

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    return cached ?? (await caches.match('/')) ?? Response.error();
  }
};

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (event.request.method !== 'GET' || !sameOrigin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(event.request));
  }
});
