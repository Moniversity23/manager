// The Gaffer service worker: caches the whole app (UI, offline engine, 3D view, sound and the
// commentator) so the game installs as an app and opens with no connection. API calls always go to
// the network; when the server is unreachable the UI switches to the offline engine by itself.
//
// Until v29 the shell list named five Studio files twice. Cache.addAll() rejects a list with
// duplicates, so this worker never installed and the app had no offline mode. Now every file is
// cached on its own: a missing optional file is skipped instead of failing the whole install.
const CACHE = 'gaffer-shell-v30';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'engine.worker.js'];
const SHELL = [...new Set([...CORE, 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'sound.js', 'commentary.js', 'ball.js', 'appearance.js', 'match3d.js', 'portraits.js',
  'vendor/three.module.min.js', 'vendor/jsm/loaders/GLTFLoader.js', 'vendor/jsm/utils/SkeletonUtils.js', 'vendor/jsm/utils/BufferGeometryUtils.js', 'vendor/jsm/exporters/GLTFExporter.js', 'vendor/jsm/environments/RoomEnvironment.js',
  'models/footballer.glb', 'models/footballer-anims.json',
  'studio/', 'studio/index.html', 'studio/js/app.js', 'studio/css/studio.css', 'studio/css/modern.css'])];
// Big files that only change with a new version (athletes, hairstyles, crowd and commentary audio):
// from the cache first, so a phone does not download them again for every match.
const LARGE = /\/(models|audio)\//;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const got = await Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))));
    const missing = SHELL.filter((u, i) => got[i].status === 'rejected');
    if (missing.some(u => CORE.includes(u))) throw new Error('core files missing: ' + missing.join(', '));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'gaffer-updated', version: CACHE });
  })());
});
self.addEventListener('message', e => { if (e.data === 'gaffer-version' && e.source) e.source.postMessage({ type: 'gaffer-version', version: CACHE }); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/') || url.origin !== self.location.origin) return;
  const range = e.request.headers.get('range');
  if (range && /\/audio\//.test(url.pathname)) {
    // Media elements can issue byte ranges for streamed ambience. Cache and slice the complete
    // local MP3 so installed/offline playback does not bypass Cache Storage for Range requests.
    e.respondWith((async () => {
      const key = new Request(url.href, { method: 'GET' });
      let full = await caches.match(key, { ignoreSearch: true });
      if (!full) {
        full = await fetch(key);
        if (!full.ok) return full;
        await caches.open(CACHE).then(c => c.put(key, full.clone()));
      }
      const bytes = await full.arrayBuffer(), size = bytes.byteLength;
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[2] && m[1] ? Math.min(size - 1, Number(m[2])) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const headers = new Headers(full.headers); headers.set('Accept-Ranges', 'bytes'); headers.set('Content-Range', `bytes ${start}-${end}/${size}`); headers.set('Content-Length', String(end - start + 1));
      return new Response(bytes.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
    })());
    return;
  }
  if (range) return;
  const keep = r => { if (r && r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; };
  if (LARGE.test(url.pathname)) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(keep)));
    return;
  }
  // Everything else: the network first, so an update shows at once; the cache when offline.
  e.respondWith(fetch(e.request).then(keep)
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
