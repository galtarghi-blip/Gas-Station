const CACHE_NAME = "gas-station-cache-v12";

const urlsToCache = [
    "./",
    "./index.html",
    "./manifest.json",
    "./styles.css",
    "./vendor/leaflet.css",
    "./vendor/leaflet.js",
    "./api-config.js",
    "./escape.js",
    "./app.js",
    "./brand-icon.svg",
    "./apple-touch-icon.png",
    "./icon-192.png",
    "./icon-512.png"
];

function isNetworkFirstRequest(url) {
    if (url.pathname.startsWith("/api/")) return true;
    return /\.(html?|js|mjs|css)$/i.test(url.pathname);
}

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.all(
                urlsToCache.map(url =>
                    cache.add(url).catch(() => {
                        /* لا نُسقط التثبيت إذا فشل ملف واحد */
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

    const url = new URL(event.request.url);
    const sameOrigin = url.origin === self.location.origin;

    if (sameOrigin && isNetworkFirstRequest(url)) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
