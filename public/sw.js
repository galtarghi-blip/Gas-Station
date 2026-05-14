const CACHE_NAME = "gas-station-cache-v3";

const urlsToCache = [
    "./",
    "./index.html",
    "./manifest.json",
    "./styles.css",
    "./vendor/leaflet.css",
    "./vendor/leaflet.js",
    "./escape.js",
    "./app.js",
    "./icon-192.png",
    "./icon-512.png"
];

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.all(
                urlsToCache.map(url =>
                    cache.add(url).catch(() => {
                        /* لا نُسقط التثبيت إذا فشل ملف واحد (مثلاً مسار مختلف محلياً) */
                    })
                )
            )
        )
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys =>
                Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
