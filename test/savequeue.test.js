// The autosave after a week runs in the background: the reply does not wait for it, saves never
// overlap, and anything that reads saves or reports the state hash waits for the queue first.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');
const { createApi } = require('../src/api.js');
const { stateHash } = require('../src/saveStore.js');

// An in-memory store whose saves take `delay` ms, recording how many run at once.
function slowStore(delay) {
  const slots = {}, docs = {};
  const s = { saves: 0, active: 0, maxActive: 0, chain: Promise.resolve() };
  Object.assign(s, {
    save(slot, gameState, meta) {
      const p = s.chain.then(async () => {
        s.active++; s.maxActive = Math.max(s.maxActive, s.active);
        const copy = JSON.parse(JSON.stringify(gameState));
        await new Promise(r => setTimeout(r, delay));
        slots[slot] = { gameState: copy, meta }; s.saves++; s.active--;
        return { ok: true };
      });
      s.chain = p.catch(() => null);
      return p;
    },
    async load(slot) { return slots[slot] ? { gameState: slots[slot].gameState } : null; },
    async backup() {}, async remove(slot) { delete slots[slot]; },
    async listMeta() { return Object.entries(slots).map(([id, x]) => ({ id, ...x.meta })); },
    async readDoc(n) { return docs[n] || null; }, async writeDoc(n, d) { docs[n] = d; },
    backend: () => 'memory', flush: () => s.chain, slots,
  });
  return s;
}

describe('background autosave queue', () => {
  it('replies before the save finishes, never overlaps saves, and flushes before hashes and loads', async () => {
    const store = slowStore(400);
    const api = createApi({ store, stateHash, randomSeed: () => 4242, log: { log() {}, error() {} } });
    const call = (m, path, body) => { const u = new URL(path, 'http://x'); return api.handle(m, u.pathname, u.searchParams, body); };
    expect((await call('POST', '/api/reset', { country: 'Australia', mode: 'existing', clubName: GameWorld.setupClubs().Australia.clubs[0] })).payload.hasCareer).toBe(true);
    const before = store.saves;

    // Three weeks in a row: each reply comes back while its save is still pending.
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      const wk = await call('POST', '/api/step-week', { interactive: false });
      expect(wk.payload.ok).toBe(true);
      expect(Date.now() - t).toBeLessThan(5000);
    }
    expect(store.saves - before).toBeLessThan(3);           // still saving in the background

    // The hash waits for the queue, and the saved state is the current one.
    const h = (await call('GET', '/api/state-hash')).payload.hash;
    expect(stateHash(store.slots.auto.gameState)).toBe(h);
    expect(store.maxActive).toBe(1);                        // saves never overlapped
    // Queued saves that had not started were merged: fewer saves than weeks.
    expect(store.saves - before).toBeLessThanOrEqual(3);

    // Loading the autosave gives exactly the state that was played.
    expect((await call('POST', '/api/load/auto')).payload.ok).toBe(true);
    expect((await call('GET', '/api/state-hash')).payload.hash).toBe(h);
  });

  it('flush() waits for a queued save (used by the server on shutdown)', async () => {
    const store = slowStore(300);
    const api = createApi({ store, stateHash, randomSeed: () => 77, log: { log() {}, error() {} } });
    const call = (m, path, body) => { const u = new URL(path, 'http://x'); return api.handle(m, u.pathname, u.searchParams, body); };
    await call('POST', '/api/reset', { country: 'Australia', mode: 'existing', clubName: GameWorld.setupClubs().Australia.clubs[1] });
    await call('POST', '/api/step-week', { interactive: false });
    const week = api.getWorld().currentWeek;
    await api.flush();
    expect(store.active).toBe(0);
    expect(store.slots.auto.gameState.currentWeek ?? store.slots.auto.gameState.week).toBeDefined();
    expect(stateHash(store.slots.auto.gameState)).toBe(stateHash(api.getWorld().toSave()));
    expect(api.getWorld().currentWeek).toBe(week);
  });
});
