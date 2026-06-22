// Service worker — makes the Oracle installable and loadable offline.
// Bump CACHE when shipping changes so clients pick up new assets.
const CACHE = 'oracle-v20';
// The 2.4MB readings bundle lives in its own cache that SURVIVES shell bumps —
// otherwise every deploy forced every client to re-download all 1,728 readings.
// Bump this only when the readings themselves change.
const READINGS_CACHE = 'oracle-readings-v1';

// Same-origin app shell. CDN modules (three, cannon-es) are cached lazily
// at runtime below so the first online visit makes later visits work offline.
const SHELL = [
  './',
  './index.html',
  './main.js',
  './placements.js',
  './readings.js',
  './audio.js',
  './reveal.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== READINGS_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never cache the /interpret or /ask POSTs

  // Readings bundle: cache-first against the persistent readings cache.
  if (new URL(req.url).pathname.endsWith('/readings.json')) {
    e.respondWith(
      caches.open(READINGS_CACHE).then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Cache successful GETs (incl. CDN modules) for offline use.
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
