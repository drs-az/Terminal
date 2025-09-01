// Terminal List Service Worker
importScripts('./asset-manifest.js');

const CACHE_NAME = `terminal-list-${self.__ASSET_MANIFEST.version}`;
const ASSETS = self.__ASSET_MANIFEST.files;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('terminal-list-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req)
        .then(async (netRes) => {
          if (
            netRes &&
            netRes.ok &&
            new URL(req.url).origin === self.location.origin
          ) {
            await cache.put(req, netRes.clone());
          }
          return netRes;
        })
        .catch(() => null);

      event.waitUntil(fetchPromise);

      if (cached) return cached;

      const netRes = await fetchPromise;
      if (netRes) return netRes;

      if (req.mode === 'navigate') {
        const index = await cache.match('./index.html');
        if (index) return index;
      }

      return Response.error();
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
