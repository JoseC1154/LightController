// FILE: service-worker.js

/*
  Scene Controller PWA Service Worker
  - Caches core UI assets for offline use
  - Does NOT cache API POST calls
*/

const CACHE_NAME = "scene-controller-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json"
  // Add icons here when available:
  // "./icons/icon-192.png",
  // "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const asset of CORE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn("SW cache skip:", asset, err);
        }
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Never intercept non‑GET requests (important for device API calls)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same‑origin requests
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const fresh = await fetch(req);

        if (fresh && fresh.ok && fresh.type === "basic") {
          cache.put(req, fresh.clone());
        }

        return fresh;
      } catch (err) {
        // Offline fallback for navigation
        const accept = req.headers.get("accept") || "";
        if (accept.includes("text/html")) {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
