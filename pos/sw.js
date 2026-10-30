// MN Scents — Punto de venta: abre aunque no haya señal (las ventas quedan en el teléfono hasta que vuelva).
const CACHE = 'mnpos-v2';
const BASE = ['./', 'index.html', 'pos.css', 'js/app.js', 'js/logica.js', 'js/api.js', 'manifest.webmanifest',
  '../img/marca/logo.webp', '../img/marca/favicon.png', '../img/marca/icono-pos-192.png',
  '../fonts/onest-latin-400-normal.woff2', '../fonts/onest-latin-500-normal.woff2', '../fonts/onest-latin-700-normal.woff2', '../fonts/unbounded-latin-700-normal.woff2'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('mnpos-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;     // la hoja de Google nunca pasa por aquí
  if (/\/(fonts|img)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then(g => g || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })));
    return;
  }
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(g => g || caches.match('index.html'))));
});
