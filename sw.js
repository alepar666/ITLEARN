const CACHE_NAME = "italienisch-b1-shell-v1";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./vocab.js",
  "./sync-config.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./apple-touch-icon.png",
  "./app-icon-512.png"
];

async function cacheCurrentShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_FILES.map(async (file) => {
    const request = new Request(file, { cache: "reload" });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Impossibile aggiornare ${file}: ${response.status}`);
    await cache.put(request, response);
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await cacheCurrentShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("italienisch-b1-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = event.request.mode === "navigate" ? "./index.html" : event.request;

    try {
      const freshRequest = event.request.mode === "navigate"
        ? new Request(event.request.url, { cache: "no-cache", credentials: "same-origin" })
        : new Request(event.request, { cache: "no-cache" });
      const response = await fetch(freshRequest);
      if (response.ok) await cache.put(cacheKey, response.clone());
      if (response.ok) return response;
      return (await cache.match(cacheKey)) || response;
    } catch (_) {
      return (await cache.match(cacheKey)) || (await caches.match(event.request)) || Response.error();
    }
  })());
});
