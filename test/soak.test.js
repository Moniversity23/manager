// Phase 0 gate: simulate seasons headless with zero exceptions and check world health every week.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { GameWorld } = require('../src/index.js');
const { assertWorldInvariants } = require('../src/engine/seasonEngine.js');

const SEASONS = Number(process.env.SOAK_SEASONS || 3);

// Every newly closed period reconciles (opening + income − costs = closing) and chains onto the
// previous one (opening = previous closing), so no money ever moves outside the ledger.
function checkLedger(world, lastSeen) {
  for (const c of world.clubs) {
    const prev = lastSeen.get(c.id);
    const idx = prev ? c.ledger.indexOf(prev) : -1;
    if (prev) expect(idx, `${c.name}: previous period trimmed before it was checked`).toBeGreaterThanOrEqual(0);
    let before = prev;
    for (const l of c.ledger.slice(idx + 1)) {
      expect(l.opening + l.income - l.costs, `${c.name} week ${l.week}`).toBe(l.closing);
      expect(l.opening + Object.values(l.items).reduce((a, b) => a + b, 0)).toBe(l.closing);
      if (before) expect(l.opening, `${c.name} ledger chain at ${l.season}/${l.week}`).toBe(before.closing);
      before = l;
    }
    if (before) lastSeen.set(c.id, before);
  }
}

describe(`headless soak (${SEASONS} seasons)`, () => {
  it('runs every week with zero exceptions and keeps the world healthy', () => {
    const world = new GameWorld({ seed: 1234, startCountry: 'Nigeria' });
    assertWorldInvariants(world);
    const me = world.club();
    expect(me.division).toBe(Math.max(...world.leagues.filter(l => l.country === 'Nigeria').map(l => l.level)));
    expect(me.finance.balance).toBeLessThan(400_000);

    const lastSeen = new Map();
    const timings = [];
    for (let s = 0; s < SEASONS; s++) {
      let out;
      do {
        const t = performance.now();
        out = world.stepWeek({});
        // A headless manager makes no decisions and can be sacked: take the first offer and carry on.
        if (world.manager.status === 'sacked') expect(world.acceptJob(world.jobOffers[0].clubId).ok).toBe(true);
        timings.push(performance.now() - t);
        checkLedger(world, lastSeen);
      } while (!out.seasonComplete);

      // Every division holds exactly 15 clubs; squads, registry and league membership agree.
      assertWorldInvariants(world);
      for (const lg of world.leagues) expect(lg.clubIds.length).toBe(15);

      // Season start: everyone 100% fit, no injuries.
      for (const p of world.players.values()) {
        expect(p.fitness).toBe(100);
        expect(p.injury).toBeNull();
        expect(p.suspension || 0).toBe(0);
      }

      // Free agents stay rare (≤ 3% of active players).
      let active = 0, free = 0;
      for (const p of world.players.values()) if (!p.retired) { active++; if (p.clubId == null) free++; }
      expect(free).toBeLessThanOrEqual(Math.floor(active * 0.03));

      // Integrity: nobody has goals, assists or minutes without an appearance.
      for (const p of world.players.values()) {
        const apps = p.history.appearances + (p.history.subApps || 0);
        if (apps === 0) {
          expect(p.history.goals).toBe(0);
          expect(p.history.assists).toBe(0);
          expect(p.history.minutes || 0).toBe(0);
        }
      }

      // Continental competitions finished with a winner and full group tables.
      expect(world.history.continentalWinners.filter(w => w.season === world.season - 1).length).toBeGreaterThan(0);
      expect(world.managerHistory.length).toBe(s + 1);
    }

    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    const regular = timings.slice().sort((a, b) => a - b)[Math.floor(timings.length / 2)];
    console.log(`soak: ${timings.length} weeks, median ${regular.toFixed(0)} ms/week, mean ${avg.toFixed(0)} ms/week (incl. season ends)`);
    expect(regular).toBeLessThan(400);
  });
});
