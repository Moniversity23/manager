// src/webEngine.js — the whole game running in the browser (Web Worker), for offline play.
//
// Bundled by scripts/build-web.js into public/engine.worker.js. It runs exactly the same API as the
// server (src/api.js) with a browser save store: gzip-compressed JSON in IndexedDB, three auto-save
// generations, manual slots, backups of migrated saves and the local leaderboard.
// Protocol: postMessage({ id, method, path, body }) → postMessage({ id, status, payload }).

/* global self, indexedDB */
const { createApi } = require('./api');

const SLOTS = ['auto', 'slot_1', 'slot_2', 'slot_3'];
const AUTO_GENERATIONS = 3;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('the-gaffer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const dbp = openDb();
async function tx(mode, fn) {
  const db = await dbp;
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const out = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const get = key => tx('readonly', s => s.get(key));
const put = (key, val) => tx('readwrite', s => s.put(val, key));
const del = key => tx('readwrite', s => s.delete(key));

const canGzip = typeof CompressionStream !== 'undefined';
async function encode(obj) {
  const text = JSON.stringify(obj);
  if (!canGzip) return { json: text };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { gz: await new Response(stream).blob() };
}
async function decode(rec) {
  if (!rec) return null;
  if (rec.json) return JSON.parse(rec.json);
  const stream = rec.gz.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

let chain = Promise.resolve();
// The auto slot keeps 3 generations round-robin (auto@0..2) plus a tiny pointer record, so a save is
// one large write instead of copying older generations around.
const autoKey = g => `auto@${((g % AUTO_GENERATIONS) + AUTO_GENERATIONS) % AUTO_GENERATIONS}`;
async function autoGen() { const p = await get('autoPtr'); return p ? p.gen : -1; }
const store = {
  backend: () => 'browser',
  connect: async () => true,
  flush: () => chain,
  save(slotId, gameState, meta) {
    const p = chain.then(async () => {
      const rec = await encode({ gameState, meta, updatedAt: new Date().toISOString() });
      const value = { ...rec, meta, updatedAt: new Date().toISOString() };
      if (slotId === 'auto') {
        const gen = (await autoGen()) + 1;
        await put(autoKey(gen), value);
        await put('autoPtr', { gen, meta, updatedAt: value.updatedAt });
      } else await put(slotId, value);
      return { ok: true, backend: 'browser' };
    });
    chain = p.catch(e => console.error('[save]', e));
    return p;
  },
  async load(slotId) {
    let ids = [slotId];
    if (slotId === 'auto') { const gen = await autoGen(); ids = gen < 0 ? [] : Array.from({ length: Math.min(AUTO_GENERATIONS, gen + 1) }, (_, i) => autoKey(gen - i)); }
    const errors = [];
    for (const id of ids) {
      try {
        const doc = await decode(await get(id));
        if (doc && doc.gameState) return { ...doc, loadedFrom: id, recovered: id !== ids[0], errors };
      } catch (e) { errors.push(`${id}: ${e.message}`); }
    }
    return errors.length ? { gameState: null, errors } : null;
  },
  async backup(slotId, raw, v) { const id = `${slotId}.v${v}.backup`; if (!(await get(id))) await put(id, await encode({ gameState: raw })); },
  async remove(slotId) { await del(slotId); return true; },
  async listMeta() {
    const out = {};
    for (const id of SLOTS) { const rec = await get(id === 'auto' ? 'autoPtr' : id); out[id] = rec ? { meta: rec.meta, updatedAt: rec.updatedAt || null } : null; }
    return out;
  },
  async readDoc(name) { const r = await get(`doc:${name}`); return r || null; },
  async writeDoc(name, doc) { await put(`doc:${name}`, doc); },
};

// Content hash (canonical JSON, FNV-1a 64-bit as two 32-bit halves) — matches nothing on the server,
// only used to compare two states in the same browser.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
function stateHash(state) {
  const s = canonical(JSON.parse(JSON.stringify(state)));
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const api = createApi({
  store, stateHash,
  randomSeed: () => { const a = new Uint32Array(1); self.crypto.getRandomValues(a); return (a[0] % (2 ** 31 - 1)) + 1; },
});
const ready = api.tryRestoreAutoSave();

// Auto-saves are deferred: every action marks the career dirty and the worker writes it once
// things have been quiet for 1.5 s (usually while the match plays on screen), so a click never
// waits for a 13 MB save. A finished week is written right after the reply; hiding or closing the
// tab sends /api/autosave, which flushes at once. Manual slots save immediately.
const rawSave = store.save;
let dirty = false, timer = null, flushing = null;
async function flushAuto() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (flushing) await flushing;
  const world = api.getWorld();
  if (!dirty || !world) return;
  dirty = false;
  flushing = rawSave('auto', world.toSave(), api.buildMeta()).finally(() => { flushing = null; });
  await flushing;
}
store.save = (slotId, gameState, meta) => {
  if (slotId !== 'auto') return rawSave(slotId, gameState, meta);
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushAuto, 1500);
  return Promise.resolve({ ok: true, backend: 'browser', deferred: true });
};

self.onmessage = async (e) => {
  const { id, method, path, body } = e.data || {};
  await ready;
  const url = new URL(path, 'http://offline.local');
  const t0 = Date.now();
  let res;
  if (url.pathname === '/api/autosave') { await flushAuto(); res = { status: 200, payload: { ok: true } }; }
  else {
    // Loading or exporting must see the latest state on disk / in memory.
    if (/^\/api\/(load|saves)/.test(url.pathname)) await flushAuto();
    res = await api.handle(method || 'GET', url.pathname, url.searchParams, body || {});
  }
  if (url.pathname === '/api/health') res.payload.offline = true;
  self.postMessage({ id, status: res.status, payload: res.payload, ms: { total: Date.now() - t0 } });
  // A finished week, a new career or a loaded save is written straight away (after the reply).
  if (res.payload && (res.payload.out || res.payload.summary || /^\/api\/(reset|load|import-save)/.test(url.pathname))) flushAuto();
};
self.postMessage({ id: 0, status: 200, payload: { ok: true, booted: true } });
