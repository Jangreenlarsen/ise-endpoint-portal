// Service worker for HyperVision ISE Portal (M8).
// - Cacher app shell så registreringssiden kan boote uden netværk.
// - Lader API-kald (/api/...) gå direkte til netværk; offline-handling
//   for POST /api/endpoints gøres i frontend (offline_queue.js) så vi
//   bevarer auth-token-flowet uden komplekse SW-svar.
const SHELL_CACHE = "ise-portal-shell-v1";
const SHELL = [
  "/index.html",
  "/css/styles.css",
  "/js/app.js",
  "/js/api.js",
  "/js/auth.js",
  "/js/csv.js",
  "/js/offline_queue.js",
  "/js/views/register.js",
  "/js/views/login.js",
  "/js/views/settings.js",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // API-kald: går altid direkte til netværk. Offline-håndtering sker
  // i frontend (offline_queue) så vi bevarer Bearer-token + 401-handling.
  if (url.pathname.startsWith("/api/")) return;

  // Kun GET cacher vi.
  if (req.method !== "GET") return;

  // Network-first med cache-fallback for app shell.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("/index.html"))),
  );
});

// Background-sync fra registreringsviewet — flusher offline-køen.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skipWaiting") self.skipWaiting();
});
