// Terminal List Service Worker
const CACHE_NAME = 'terminal-list-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const netRes = await fetch(req);
        if (netRes && netRes.ok && (new URL(req.url).origin === self.location.origin)) {
          cache.put(req, netRes.clone());
        }
        return netRes;
      } catch (e) {
        const cached = await cache.match(req);
        if (cached) return cached;
        // fallback to cached index for navigation requests
        if (req.mode === 'navigate') {
          const index = await cache.match('./index.html');
          if (index) return index;
        }
        throw e;
      }
    })()
  );
});

// Focus or open the app when a notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./');
      }
    })
  );
});
