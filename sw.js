/* Extinction Fighters — offline service worker.
   Network-first: when online you always get the latest game; when offline
   the cached copy is used. Bump CACHE when the precache list changes. */
const CACHE = "extinction-fighters-v3";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg",
                "./3d/ink.js", "./3d/dinos.js", "./3d/world.js", "./vendor/three.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for GET; refresh the cache with what we fetch, fall back to cache offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })   // revalidate with the server so updates arrive immediately
      .then((resp) => {
        if (resp && resp.ok) { const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return resp;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
