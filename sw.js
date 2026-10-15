// MN Scents — permite instalar la web como app y abrirla sin señal.
// Siempre intenta traer lo más nuevo de internet; solo usa la copia guardada si no hay conexión.
const CACHE = 'mnscents-v1';
const BASE = ['./', 'index.html', 'css/estilos.css', 'js/app.js', 'js/precios.js', 'data/productos.json',
  'img/marca/logo.webp', 'img/marca/crestas.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const esFijo = /\/(fonts|img)\//.test(req.url);
  if (esFijo) {
    // fotos y tipografías: copia guardada primero (cambian poco), y se actualiza en segundo plano
    e.respondWith(caches.match(req).then(guardado => {
      const red = fetch(req).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(req, r.clone())); return r; }).catch(() => guardado);
      return guardado || red;
    }));
  } else {
    // página, estilos, código y catálogo: siempre lo más nuevo de internet
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(g => g || caches.match('index.html'))));
  }
});
