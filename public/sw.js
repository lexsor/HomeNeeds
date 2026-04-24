// HomeNeeds — service worker
// Strategy:
//   * Static shell (HTML/CSS/JS/icons/manifest) -> stale-while-revalidate, fast loads + fresh on next visit
//   * GET /api/*      -> network-first, fall back to cache when offline
//   * Non-GET /api/*  -> network only (the client queues writes locally and replays them later)
//   * /api/stream     -> passthrough, never cache (SSE)
//
// Bump CACHE_VERSION to force clients to purge old caches after a deploy.

const CACHE_VERSION = 'home-needs-v6';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const API_CACHE     = `${CACHE_VERSION}-api`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch SSE.
  if (url.pathname === '/api/stream') return;

  // Same-origin only.
  if (url.origin !== self.location.origin) return;

  // API
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') return; // mutations go network-only
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // Static shell: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || network;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (_) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', items: [] }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
