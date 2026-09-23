/* ==============================================================================
   MOM TV Remote 2.0 — Service Worker Engine
   Zero-flicker instant launch & offline cache for luxury standalone PWA
   ============================================================================== */

const CACHE_NAME = "mom-tv-remote-v2.0.1";
const PRECACHE_ASSETS = [
  "/",
  "/remote",
  "/index.html",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png"
];

// Install: Pre-cache core UI shell and activate immediately
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          fetch(url, { cache: "reload" })
            .then((response) => {
              if (response && response.ok) {
                return cache.put(url, response);
              }
            })
            .catch((err) => {
              console.warn(`[SW] Precache failed for ${url}:`, err);
            })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: Prune outdated caches and take control of all open tabs immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Purging outdated cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip WebSocket, chrome-extension, and non-GET requests
  if (request.method !== "GET" || url.protocol.startsWith("ws")) {
    return;
  }

  // Always fetch fresh for live pairing / status APIs
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ status: "offline" }), {
        headers: { "Content-Type": "application/json" }
      }))
    );
    return;
  }

  // Navigation (HTML Pages): Network-First with Cache Fallback for instant updates
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/remote" || url.pathname === "/index.html") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(request) || caches.match("/index.html") || caches.match("/"))
    );
    return;
  }

  // Static Assets (Icons, Manifest, Images): Cache-First with Background Revalidation
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
