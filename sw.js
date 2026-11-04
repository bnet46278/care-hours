// Lets Care Hours open without an internet connection.
// Bump VERSION whenever you change any file, so phones pick up the new version.
const VERSION = "care-hours-v3";
const FILES = ["./", "index.html", "config.js", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
// Outside files worth keeping for offline use (the sync library and fonts).
const CACHE_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameSite = url.origin === self.location.origin;
  // Leave everything else alone, including the online database, which must never be cached.
  if (!sameSite && !CACHE_HOSTS.includes(url.hostname)) return;
  // Network first, so updates show up; fall back to the saved copy when offline.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
