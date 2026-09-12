const CACHE = "feedback-shell-__CACHE_VERSION__";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(__PRECACHE_ASSETS__)),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/api") ||
    url.searchParams.has("share") ||
    url.searchParams.has("remote")
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (
          response.ok &&
          (url.pathname === "/" ||
            url.pathname.startsWith("/assets/") ||
            url.pathname === "/favicon.svg")
        ) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request, { ignoreVary: true })
          .then(
            (cached) =>
              cached ||
              (event.request.mode === "navigate"
                ? caches.match("/")
                : Response.error()),
          ),
      ),
  );
});
