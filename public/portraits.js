// The Gaffer — player portraits from the players themselves.
// Every portrait in the game (squad cards, lists, the Lineup, the market, profiles) is first drawn
// as a small picture from the player's look (portraitSVG in index.html), then replaced by a render of
// his own 3D athlete: the same face, skin, eyes, hair and beard as on the pitch and in the Player
// Studio, in his club's shirt, head and shoulders from a three-quarter angle in soft light
// (renderPortrait in match3d.js). No photographs of anyone are used.
// Renders are made one at a time when the browser is idle, kept in memory and in IndexedDB (keyed by
// everything that changes how he looks, so a new look from the Studio makes a new portrait), and
// shared by every element showing the same player. Off when the close-up bodies are switched off
// (Settings), without WebGL, or with the classic figures; the drawn portrait then stays.
(function () {
  const VERSION = 'p1';                    // bump when the portrait's framing or lighting changes
  const DB = 'gaffer-portraits', STORE = 'img', KEEP = 800;
  const want = new Map();                  // key → { look, kit, gk } for the portraits on screen
  const urls = new Map();                  // key → object URL, made this session
  const queue = [], queued = new Set();
  let busy = false, mod = null, failed = 0, observer = null, dbp = null;
  let enabledFn = () => (typeof window.portraits3d === 'function' ? window.portraits3d() : true);   // the game's setting (index.html)

  // FNV-1a over a string: a short, stable key.
  function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
  function keyFor(look, kit, gk) { return VERSION + '-' + hash(JSON.stringify([look, kit, !!gk])); }
  function register(look, kit, gk) { const k = keyFor(look, kit, gk); if (!want.has(k)) want.set(k, { look, kit, gk: !!gk }); return k; }

  function db() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function idbGet(k) { const d = await db(); if (!d) return null; return new Promise(res => { try { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function idbPut(k, blob) {
    const d = await db(); if (!d) return;
    try {
      const tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
      st.put({ blob, t: Date.now() }, k);
      // Keep the store small: the oldest go when there are too many.
      const c = st.count(); c.onsuccess = () => { if (c.result <= KEEP) return; const all = st.openCursor(); const rows = []; all.onsuccess = () => { const cur = all.result; if (cur) { rows.push([cur.key, cur.value.t || 0]); cur.continue(); } else rows.sort((a, b) => a[1] - b[1]).slice(0, rows.length - KEEP).forEach(([key]) => st.delete(key)); }; };
    } catch (e) { /* not kept: made again next time */ }
  }

  function show(k) {
    const url = urls.get(k); if (!url) return;
    document.querySelectorAll(`.pt[data-pk="${k}"]`).forEach(el => {
      if (el.dataset.done === '1') return;
      const img = new Image(); img.alt = ''; img.decoding = 'async'; img.src = url; img.className = 'pt3';
      img.onload = () => { el.textContent = ''; el.appendChild(img); el.dataset.done = '1'; el.classList.add('pt-3d'); };
    });
  }
  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        if (!enabledFn() || failed > 3) { queue.length = 0; queued.clear(); break; }
        const k = queue.shift(); queued.delete(k);
        if (urls.has(k)) { show(k); continue; }
        if (!document.querySelector(`.pt[data-pk="${k}"]`)) continue;          // no longer on screen
        const saved = await idbGet(k);
        if (saved && saved.blob) { urls.set(k, URL.createObjectURL(saved.blob)); show(k); continue; }
        const w = want.get(k); if (!w) continue;
        await idle();
        try {
          mod = mod || await import('./match3d.js');
          const blob = await mod.renderPortrait(w.look, { kit: w.kit, gk: w.gk });
          if (!blob) { failed++; continue; }
          urls.set(k, URL.createObjectURL(blob)); show(k); idbPut(k, blob);
        } catch (e) { failed++; console.warn('portrait unavailable', e && e.message); }
      }
    } finally { busy = false; }
  }
  const idle = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 600 }) : setTimeout(r, 30)));

  // Finds portraits on screen that can be upgraded, the ones already made first.
  function scan(root) {
    if (!enabledFn()) return;
    const els = (root || document).querySelectorAll ? (root || document).querySelectorAll('.pt[data-pk]:not([data-done="1"])') : [];
    for (const el of els) {
      const k = el.dataset.pk;
      if (urls.has(k)) { show(k); continue; }
      if (!queued.has(k) && want.has(k)) { queued.add(k); queue.push(k); }
    }
    if (queue.length) pump();
  }
  let pending = 0;
  function watch() {
    if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
    observer = new MutationObserver(() => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; scan(document); }); });
    observer.observe(document.body, { childList: true, subtree: true });
    scan(document);
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch(); }

  function state() { return { made: urls.size, queued: queue.length, busy, failed, wanted: want.size, enabled: enabledFn() }; }
  // forget(): a setting changed (portraits back to drawn ones) — the made ones stay cached for later.
  function setEnabled(fn) { enabledFn = typeof fn === 'function' ? fn : () => !!fn; if (enabledFn()) scan(document); }
  window.GafferPortraits = { register, keyFor, scan, state, setEnabled, version: VERSION };
})();
