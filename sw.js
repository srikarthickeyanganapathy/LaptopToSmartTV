/* ==============================================================================
   MOM TV Remote 2.0 — Service Worker Engine
   Zero-flicker instant launch & offline cache for luxury standalone PWA
   ============================================================================== */

// CACHE_NAME should be tied to app build hash for production
const CACHE_NAME = "mom-tv-remote-v2.0.1";
const PRECACHE_ASSETS = [
  "/",
  "/remote",
  "/index.html",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png", // NOTE: Should be generated from icon.svg at build time
  "/icon-512.png"  // NOTE: Should be generated from icon.svg at build time
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
    .then(() => {
      // Notify all clients that a new version is available
      return self.clients.matchAll({type: 'window'}).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
        });
      });
    })
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
        .catch(async () => {
          const match1 = await caches.match(request);
          if (match1) return match1;
          const match2 = await caches.match("/index.html");
          if (match2) return match2;
          return caches.match("/");
        })
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
        .catch(() => cachedResponse || new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="50" fill="#888">Offline</text></svg>',
          { headers: { 'Content-Type': 'image/svg+xml' } }
        ));

      return cachedResponse || fetchPromise;
    })
  );
});
