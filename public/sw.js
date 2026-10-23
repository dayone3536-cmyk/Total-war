// Bump VERSION on every deploy so players get an "Update ready" prompt.
const VERSION = "empire-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });


// Same-origin GETs: serve from cache instantly, refresh in the background. Analytics and /api/ calls are never touched.
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = (await cache.match(r, { ignoreSearch: true })) || (r.mode === "navigate" ? await cache.match("./index.html") : null);
      const net = fetch(r).then((res) => { if (res.ok) cache.put(r, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
});