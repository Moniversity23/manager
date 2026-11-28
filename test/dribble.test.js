// The dribble drawn in the match view (public/index.html, simDribble): the ball is pushed ahead of
// the carrier in touches and rolls out between them, never trailing behind him, at walking pace and
// at a sprint, through a turn, at 4× speed; and when the ball changes hands (a tackle, a pass
// received) it carries on from where it is, without jumping. The engine and timeline decide who has
// the ball; this only draws it.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

// The page's scripts in a sandbox (as in ui.test.js), for their pure functions.
function loadUI() {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf-8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, appendChild() {}, remove() {}, querySelectorAll() { return []; }, querySelector() { return null; } });
  const els = new Map();
  const document = { getElementById: id => { if (!els.has(id)) els.set(id, el()); return els.get(id); }, querySelectorAll: () => [], createElement: el, addEventListener() {}, documentElement: { dataset: {} } };
  const ctx = vm.createContext({ document, window: { location: { origin: 'http://test' }, addEventListener() {}, innerWidth: 1200 }, navigator: { sendBeacon() {} }, location: { protocol: 'file:' },
    localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ json: async () => ({}) }), setTimeout: () => 0, clearTimeout() {}, console, URL, Blob: class {}, confirm: () => true, prompt: () => null });
  for (const s of scripts) vm.runInContext(s, ctx);
  return ctx;
}
const ctx = loadUI();
const M = [105, 68];

// Runs a carrier along path(t) → [x, y] metres (heading for where he will be in a second), drawing
// the dribble every frame. hand(t) may give the ball to someone else: { side, idx, at: [x, y] }.
function run({ path, secs = 6, fps = 60, speed = 1, hand = null }) {
  const v = { ball: { x: 0, y: 0, z: 0 }, dots: { home: [{}], away: [{}] } };
  const s = { poss: 'home', holder: 0, t: 0, phase: 'play' };
  const dt = speed / fps, out = [];
  const [x0, y0] = path(0); v.ball.x = (x0 + 0.4) / M[0]; v.ball.y = y0 / M[1];
  let prev = null;
  for (let i = 0; i <= secs * fps / speed; i++) {
    const t = i * dt; s.t = t;
    const h = hand && hand(t);
    if (h && (s.poss !== h.side || s.holder !== h.idx)) { s.poss = h.side; s.holder = h.idx; }
    const who = s.poss === 'home' ? path : (h && h.path) || path;
    const [x, y] = who(t), [x1, y1] = who(t + 1 / 60), [xa, ya] = who(t + 1);
    const d = v.dots[s.poss][s.holder];
    Object.assign(d, { x: x / M[0], y: y / M[1], vx: (x1 - x) * 60 / M[0], vy: (y1 - y) * 60 / M[1], tx: xa / M[0], ty: ya / M[1] });
    ctx.simDribble(v, s, dt);
    const bx = v.ball.x * M[0], by = v.ball.y * M[1], vx = (x1 - x) * 60, vy = (y1 - y) * 60, sp = Math.hypot(vx, vy);
    const along = sp > 0.3 ? ((bx - x) * vx + (by - y) * vy) / sp : null;
    out.push({ t, bx, by, x, y, sp, along, dist: Math.hypot(bx - x, by - y), jump: prev ? Math.hypot(bx - prev[0], by - prev[1]) / dt : 0, touch: s.touch ? s.touch.t0 : null, owner: s.drib ? `${s.drib.side}:${s.drib.idx}` : null });
    prev = [bx, by];
  }
  return out;
}
const straight = mps => t => [20 + mps * t, 34];
const settled = (rows, from = 0.8) => rows.filter(r => r.t >= from && r.along != null);
const share = (rows, f) => rows.filter(f).length / Math.max(1, rows.length);
const touches = rows => [...new Set(rows.map(r => r.touch).filter(x => x != null))];

describe('dribbling in the match view', () => {
  it('at walking pace the ball stays just ahead of him, touched about every half second', () => {
    const rows = run({ path: straight(2) }), s = settled(rows);
    expect(share(s, r => r.along > 0)).toBeGreaterThan(0.97);
    const lead = s.reduce((a, r) => a + r.along, 0) / s.length;
    expect(lead).toBeGreaterThan(0.35); expect(lead).toBeLessThan(1.3);
    expect(Math.max(...s.map(r => r.dist))).toBeLessThan(2.2);
    const T = touches(rows), gaps = T.slice(1).map((t, i) => t - T[i]);
    expect(T.length).toBeGreaterThan(8);
    expect(Math.min(...gaps.slice(2))).toBeGreaterThan(0.25);
    expect(Math.max(...gaps.slice(2))).toBeLessThan(0.75);
  });

  it('at a sprint the ball is pushed further ahead and still never trails him', () => {
    const rows = run({ path: straight(8) }), s = settled(rows);
    expect(share(s, r => r.along > 0)).toBeGreaterThan(0.95);
    const lead = s.reduce((a, r) => a + r.along, 0) / s.length;
    expect(lead).toBeGreaterThan(1.0); expect(lead).toBeLessThan(3.2);
    expect(Math.max(...s.map(r => r.dist))).toBeLessThan(4.5);
    expect(Math.max(...rows.slice(1).map(r => r.jump))).toBeLessThan(30);          // no teleport
  });

  it('follows him through a turn: ahead again in the new direction within a second', () => {
    // East at 5 m/s for 2 s, a tight U-turn over 0.6 s, then west.
    const path = t => (t < 2 ? [20 + 5 * t, 34] : t < 2.6 ? [30 + 1.5 * Math.sin((t - 2) / 0.6 * Math.PI), 34 + 1.5 * (1 - Math.cos((t - 2) / 0.6 * Math.PI))] : [30 - 5 * (t - 2.6), 37]);
    const rows = run({ path, secs: 5 });
    const after = rows.filter(r => r.t > 3.5 && r.along != null);
    expect(share(after, r => r.along > 0)).toBeGreaterThan(0.95);
    expect(Math.max(...rows.slice(1).map(r => r.jump))).toBeLessThan(30);
  });

  it('at 4× speed (fewer, longer frames) the ball is still ahead of him', () => {
    for (const mps of [2, 7]) {
      const s = settled(run({ path: straight(mps), speed: 4, secs: 12 }));
      expect(share(s, r => r.along > 0), `${mps} m/s`).toBeGreaterThan(0.9);
    }
  });

  it('a tackle: the defender takes it from where it is, with no jump, and dribbles it his way', () => {
    const def = t => [36 - 3 * Math.max(0, t - 3), 34];                         // waiting, then carrying it back
    const rows = run({ path: straight(4), secs: 6, hand: t => (t >= 3 ? { side: 'away', idx: 0, path: def } : { side: 'home', idx: 0 }) });
    const at = rows.findIndex(r => r.t >= 3);
    expect(rows[at + 1].owner).toBe('away:0');
    expect(Math.max(...rows.slice(at - 2, at + 20).map(r => r.jump))).toBeLessThan(30);
    const later = rows.filter(r => r.t > 4.5 && r.along != null);
    expect(share(later, r => r.along > 0)).toBeGreaterThan(0.9);                // ahead of the new carrier
  });

  it('receiving: the ball starts from where it arrived and is then carried on', () => {
    // The ball arrives 1.2 m away from a team-mate standing still; he then runs with it.
    const rec = t => (t < 0.5 ? [50, 30] : [50 + 4 * (t - 0.5), 30]);
    const rows = run({ path: rec, secs: 3 });
    expect(rows[1].jump).toBeLessThan(30);
    expect(share(rows.filter(r => r.t > 1.4 && r.along != null), r => r.along > 0)).toBeGreaterThan(0.95);
  });
});
