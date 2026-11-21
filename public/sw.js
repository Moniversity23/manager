// The Gaffer service worker: caches the whole app — UI, offline engine, 3D view and sound — so the
// game installs as a PWA and opens with no connection. API calls always go to the network; when the
// server is unreachable the UI switches to the offline engine (engine.worker.js) by itself.
const CACHE = 'gaffer-shell-v18';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'engine.worker.js', 'sound.js', 'commentary.js', 'ball.js', 'appearance.js', 'studio/', 'studio/index.html', 'studio/js/app.js', 'studio/css/studio.css', 'studio/css/modern.css', 'vendor/jsm/exporters/GLTFExporter.js', 'match3d.js', 'vendor/three.module.min.js', 'vendor/jsm/loaders/GLTFLoader.js', 'vendor/jsm/utils/SkeletonUtils.js', 'vendor/jsm/utils/BufferGeometryUtils.js', 'models/footballer.glb', 'models/footballer-anims.json', 'studio/', 'studio/index.html', 'studio/css/studio.css', 'studio/css/modern.css', 'studio/js/app.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/') || url.origin !== self.location.origin) return;
  // Network first so updates show immediately; fall back to the cache offline.
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
