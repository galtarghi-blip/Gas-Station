const CACHE_NAME = 'gas-station-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/admin.html',
  '/superadmin.html',
  '/styles.css',
  '/app.js',
  '/admin.js',
  '/superadmin.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});