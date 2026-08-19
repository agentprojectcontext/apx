// The panel as an installed app.
//
// Chrome will not offer "install" without a service worker that handles fetch,
// and iOS will not keep a home-screen app in its own window without the
// manifest this sits beside. That is the whole reason this file exists — it is
// an installability requirement first and an offline story second.
//
// Which makes the caching policy the important part: NETWORK FIRST, always. A
// panel that served a stale bundle after a rebuild would be worse than no app
// at all, and this one talks to a daemon on the same machine, so "offline" is
// nearly always "the daemon moved", not "there is no network". The cache is a
// last resort that keeps the shell painting long enough to say so.
//
// Never cached, under any circumstances:
//   • /api/*        — data, and the failover in lib/net depends on a real error
//                     reaching it rather than a cached 200 from an hour ago.
//   • cross-origin  — when the app fails over to another address, its requests
//                     are not ours to answer.
const CACHE = "apx-shell-v3";
const SHELL = "/index.html";

self.addEventListener("install", () => {
  // Take over immediately: a half-updated app is a support ticket.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const navigating = req.mode === "navigate";

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          // A navigation to any client route resolves to the same shell, so
          // one entry serves every path the app can be launched at.
          const key = navigating ? SHELL : req;
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(navigating ? SHELL : req);
        if (hit) return hit;
        throw err;
      }
    })(),
  );
});
