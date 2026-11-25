// BilgiAl mobile shell service worker (D-047).
//
// The phone installs this client as an app; the shell must open instantly and
// survive a short Wi-Fi drop. Only the app shell is cached: `/api/*` (live
// state, jobs, credits) and `/api/media` (Range video) are never cached, so the
// phone can never show stale answers or half-written media.
//
// Update policy: shell files are served from cache and refreshed in the
// background (`stale-while-revalidate`); `index.html` is network-first with a
// cache fallback, so a new build is picked up on the next online open.

'use strict';

const VERSION = 'bilgial-shell-v1';
const SHELL_PATHS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/tokens.css',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];
const SHELL_SET = new Set(SHELL_PATHS);

/** API ve medya akışı asla önbelleğe girmez; Range/206 yanıtları bozulmasın. */
function neverCache(pathname) {
  return pathname.startsWith('/api/');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Tek tek ekle: bir dosya yoksa kurulum tümden düşmesin.
    await Promise.all(SHELL_PATHS.map(async (pathname) => {
      try {
        const request = new Request(pathname, { cache: 'reload' });
        const response = await fetch(request);
        if (response && response.ok) await cache.put(pathname, response);
      } catch (_error) {
        /* çevrimdışı kurulum: eksik dosya sonraki açılışta tazelenir */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put('/index.html', response.clone());
    return response;
  } catch (_error) {
    const cached = await cache.match('/index.html');
    if (cached) return cached;
    return new Response('BilgiAl arayüzü önbellekte yok.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(event, key) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const refresh = fetch(event.request).then(async (response) => {
    if (response && response.ok) await cache.put(key, response.clone());
    return response;
  }).catch(() => null);

  if (cached) {
    // Tazeleme arka planda sürsün; yanıtı bekletme.
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  if (fresh) return fresh;
  return new Response('', { status: 504, statusText: 'offline' });
}

/** Önbellek anahtarı: `/` → `/index.html`, shell dosyaları kendi yolu, diğerleri istek. */
function cacheKey(pathname) {
  if (pathname === '/') return '/index.html';
  return SHELL_SET.has(pathname) ? pathname : null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url = null;
  try {
    url = new URL(request.url);
  } catch (_error) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (neverCache(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  const key = cacheKey(url.pathname);
  event.respondWith(staleWhileRevalidate(event, key || request));
});

self.addEventListener('message', (event) => {
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  if (data.type === 'skip-waiting') self.skipWaiting();
  if (data.type === 'version' && event.source) {
    event.source.postMessage({ type: 'version', version: VERSION });
  }
});
