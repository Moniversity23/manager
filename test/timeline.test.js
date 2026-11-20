// The authoritative match timeline: deterministic, coherent, agrees with the engine, and gives
// measured possession and pass statistics.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');
const ME = require('../src/engine/matchEngine');
const TL = require('../src/engine/timeline');

// Plays n seeded matches between real clubs with full recording (as the manager's own matches are).
function playMany(seed, n, opts = {}) {
  const w = new GameWorld({ seed, startCountry: 'England' });
  const clubs = w.clubs.filter(c => c.division === 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const home = clubs[i % clubs.length], away = clubs[(i * 7 + 3) % clubs.length];
    if (home === away) continue;
    const ctx = w.matchCtx();
    const { match, result } = ME.playMatch(ctx, { id: `t${seed}-${i}`, comp: 'league', compName: 'Test', week: 1, home, away, recordShots: true, knockout: !!opts.knockout });
    out.push({ match, result });
  }
  return out;
}

describe('authoritative match timeline', () => {
  const games = playMany(41, 40);

  it('is coherent and agrees with the engine in every match', () => {
    for (const { match } of games) expect(TL.validate(match), match.id).toEqual([]);
  });

  it('records passes between real players, possession changes, the build-up to each shot and the assister on goals', () => {
    for (const { match } of games) {
      const ev = match.tl.events;
      const passes = ev.filter(e => e.type === 'PASS');
      expect(passes.length).toBeGreaterThan(250);
      expect(ev.some(e => e.type === 'INTERCEPTION')).toBe(true);
      expect(ev.some(e => e.type === 'TACKLE')).toBe(true);
      // Every goal's last pass comes from its assister, and the scorer/assister pairs are the engine's.
      const pairs = [];
      for (const g of ev.filter(e => e.type === 'GOAL')) {
        pairs.push(`${g.pid}/${g.tid ?? '-'}`);
        if (g.tid == null || g.tid === g.pid) continue;
        const shotIdx = ev.findIndex(e => e.seq === g.rel);
        const lastPass = [...ev.slice(0, shotIdx)].reverse().find(e => e.type === 'PASS');
        expect(lastPass.pid).toBe(g.tid);
        expect(lastPass.tid).toBe(g.pid);
      }
      const engine = match.events.filter(e => e.type === 'goal').map(e => `${e.playerId}/${e.assistId ?? '-'}`);
      expect(pairs.sort()).toEqual(engine.sort());
    }
  });

  it('measures possession from the spells, not from expected goals', () => {
    const shares = games.map(g => g.result.pos);
    for (const { match, result } of games) {
      expect(result.pos).toBe(TL.possession(match));
      expect(result.ts.possession).toBe(result.pos);
      expect(result.pos).toBeGreaterThan(15); expect(result.pos).toBeLessThan(85);
      const s = match.tl.stats;
      expect(result.ts.passes).toEqual([s.home.passes, s.away.passes]);
      for (const side of ['home', 'away']) expect(s[side].completed).toBeLessThanOrEqual(s[side].passes);
    }
    expect(new Set(shares).size).toBeGreaterThan(8);                     // it varies from match to match
  });

  it('produces match statistics in the range of real football', () => {
    const med = k => { const x = games.flatMap(g => g.result.ts[k]).sort((a, b) => a - b); return x[x.length >> 1]; };
    expect(med('passes')).toBeGreaterThan(350); expect(med('passes')).toBeLessThan(650);
    expect(med('passAccuracy')).toBeGreaterThan(76); expect(med('passAccuracy')).toBeLessThan(90);
    expect(med('tackles')).toBeGreaterThan(10); expect(med('tackles')).toBeLessThan(30);
    expect(med('interceptions')).toBeGreaterThan(7); expect(med('interceptions')).toBeLessThan(25);
    expect(med('fouls')).toBeGreaterThan(6); expect(med('fouls')).toBeLessThan(16);
    // possession changes that are not tackles or interceptions: loose balls and throw-ins
    const ev = games[0].match.tl.events;
    expect(ev.some(e => e.type === 'RECOVERY')).toBe(true);
    expect(ev.some(e => e.type === 'THROW_IN')).toBe(true);
  });

  it('is deterministic: the same match id and state give the same timeline', () => {
    const a = playMany(41, 3), b = playMany(41, 3);
    for (let i = 0; i < a.length; i++) expect(JSON.stringify(a[i].match.tl.events)).toBe(JSON.stringify(b[i].match.tl.events));
  });

  it('does not change match results (it has its own random stream)', () => {
    // The same world and fixtures with recording on (timeline) and off must give the same scores.
    const w1 = new GameWorld({ seed: 77, startCountry: 'Spain' }), w2 = new GameWorld({ seed: 77, startCountry: 'Spain' });
    const pair = w => w.clubs.filter(c => c.division === 1).slice(0, 2);
    const [h1, a1] = pair(w1), [h2, a2] = pair(w2);
    const r1 = ME.playMatch(w1.matchCtx(), { id: 'x', comp: 'league', compName: 'T', week: 1, home: h1, away: a1, recordShots: true }).result;
    const r2 = ME.playMatch(w2.matchCtx(), { id: 'x', comp: 'league', compName: 'T', week: 1, home: h2, away: a2, recordShots: false }).result;
    expect([r1.hg, r1.ag, r1.hx, r1.ax]).toEqual([r2.hg, r2.ag, r2.hx, r2.ax]);
  });

  it('keeps substitutions, cards and extra time consistent', () => {
    const ko = playMany(5, 25, { knockout: true });
    for (const { match } of ko) expect(TL.validate(match), match.id).toEqual([]);
    const all = [...games, ...ko].flatMap(g => g.match.tl.events);
    expect(all.some(e => e.type === 'SUB')).toBe(true);
    expect(all.some(e => e.type === 'YELLOW')).toBe(true);
    expect(all.some(e => e.type === 'FOUL')).toBe(true);
  });

  it('packs compactly for the match view', () => {
    const p = TL.pack(games[0].match);
    expect(p.events.length).toBe(games[0].match.tl.events.length);
    expect(JSON.stringify(p).length).toBeLessThan(80_000);
  });
});
