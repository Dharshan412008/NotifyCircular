const CACHE_NAME = 'campus-relay-shell-v3';
const CORE_FILES = ['/manifest.webmanifest', '/icon.svg', '/maskable.svg'];

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('/');
  if (!response.ok) throw new Error('Application shell could not be loaded.');
  await cache.put('/', response.clone());
  const html = await response.text();
  const versionedAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);
  await cache.addAll([...CORE_FILES, ...new Set(versionedAssets)]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('campus-relay-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.pathname === '/api'
    || url.pathname.startsWith('/api/')
    || url.pathname === '/socket.io'
    || url.pathname.startsWith('/socket.io/')
  ) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/', response.clone()));
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'New CampusRelay circular', {
    body: payload.body || 'A new official notice is waiting in your inbox.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || `circular-${payload.circularId || 'new'}`,
    renotify: Boolean(payload.urgent),
    data: {
      url: payload.url || (payload.circularId ? `/student/circulars/${payload.circularId}` : '/student'),
    },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = event.notification.data?.url || '/student';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client);
    if (existing) {
      existing.navigate(destination);
      return existing.focus();
    }
    return self.clients.openWindow(destination);
  }));
});
