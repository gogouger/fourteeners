const CACHE_NAME = '14ers-terrain-v1';
const TERRAIN_ASSETS = [
  './assets/usgs-colorado-dem-max.tiff',
  './assets/usgs-colorado-statewide-ultra.jpg',
  './assets/usgs-colorado-relief.png'
];
const TERRAIN_PATHS = new Set(TERRAIN_ASSETS.map((asset) => new URL(asset, self.location).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(TERRAIN_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith('14ers-terrain-') && name !== CACHE_NAME).map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !TERRAIN_PATHS.has(url.pathname)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (!response.ok) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
