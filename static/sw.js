// App shell is cached so the PWA opens instantly; API is always network-first;
// saved media never changes, so it's cache-first.
//
// Bump SHELL whenever app.js, app.css or index.html change. The version is what publishes
// a release: install refetches the shell, activate drops the old cache, and a stale pair
// can't survive a deploy.
const SHELL = "peek-shell-v9";
const MEDIA = "peek-media-v1";
const SHELL_FILES = ["/", "/index.html", "/app.css", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, MEDIA].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // /api/burner included: the Burner tab must never be served from cache
  if (url.pathname.startsWith("/api/")) return; // straight to network
  if (url.pathname.startsWith("/media/") || url.pathname.startsWith("/m/") || url.pathname.startsWith("/hl/")) {
    if (/\.mp4$/.test(url.pathname) || url.pathname.startsWith("/hl/i/")) return; // may be video: range requests
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // shell: network first so updates land, cache as fallback. cache: "no-cache" makes the
  // browser revalidate instead of handing back its own (possibly stale) HTTP-cached copy.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
    if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))));
});