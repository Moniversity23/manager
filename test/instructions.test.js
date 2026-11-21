// Team instructions (line height, width, tempo): 'normal' changes nothing; each choice has the
// effect and the price it should, in the engine and in the match timeline.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');
const ME = require('../src/engine/matchEngine');
const TL = require('../src/engine/timeline');

// Plays n matches of the same pairings in a fresh world, with the home side's instructions set.
function series(instructions, n = 60, seed = 909) {
  const w = new GameWorld({ seed, startCountry: 'England' });
  const clubs = w.clubs.filter(c => c.division === 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const home = clubs[i % 10], away = clubs[10 + (i % 10)];
    home.instructions = instructions;
    const { match, result } = ME.playMatch(w.matchCtx(), { id: `ins-${i}`, comp: 'league', compName: 'T', week: 1, home, away, recordShots: true });
    out.push({ match, result, home, away, w });
  }
  return out;
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('team instructions', () => {
  it("'normal' instructions give exactly the results of no instructions", () => {
    const a = series(undefined, 12), b = series({ line: 'normal', width: 'normal', tempo: 'normal' }, 12);
    for (let i = 0; i < a.length; i++) expect([b[i].result.hg, b[i].result.ag, b[i].result.hx, b[i].result.ax]).toEqual([a[i].result.hg, a[i].result.ag, a[i].result.hx, a[i].result.ax]);
  });

  it('fast tempo makes a more open game and tires players more than slow tempo', () => {
    const fast = series({ tempo: 'fast' }), slow = series({ tempo: 'slow' });
    const shots = s => mean(s.map(x => x.match.home.shots + x.match.away.shots));
    expect(shots(fast)).toBeGreaterThan(shots(slow));
    expect(mean(fast.map(x => x.match.home.shots))).toBeGreaterThan(mean(slow.map(x => x.match.home.shots)));
    // Slow tempo keeps the ball for longer (measured from the timeline).
    expect(mean(slow.map(x => x.result.pos))).toBeGreaterThan(mean(fast.map(x => x.result.pos)) + 2);
    // Tired legs: the home starters end the match with less condition under fast tempo.
    const cond = s => mean(s.flatMap(x => x.match.home.startXI.map(p => x.w.players.get(p.playerId).fitness)));
    expect(cond(fast)).toBeLessThan(cond(slow));
  });

  it('a high line is punished by quick forwards and works against slow ones', () => {
    const w = new GameWorld({ seed: 5, startCountry: 'Spain' });
    const [home, away] = w.clubs.filter(c => c.division === 1).slice(0, 2);
    const { match } = ME.playMatch(w.matchCtx(), { id: 'hl', comp: 'league', compName: 'T', week: 1, home, away });
    match.home.instr = ME.normInstr({ line: 'high' });
    const ctx = w.matchCtx();
    const setPace = v => { for (const s of match.away.onPitch) if (['ST', 'CF', 'LW', 'RW'].includes(s.slot)) ctx.getPlayer(s.playerId).attributes.pace = v; };
    setPace(95); const quick = ME.instrMods(match, 'home', ctx).concQual;
    setPace(35); const slowF = ME.instrMods(match, 'home', ctx).concQual;
    expect(quick).toBeGreaterThan(1);
    expect(slowF).toBeLessThan(1);
    match.home.instr = ME.normInstr({ line: 'deep' });
    expect(ME.instrMods(match, 'home', ctx).concQual).toBeLessThan(1);         // deep: fewer clear chances…
    expect(ME.instrMods(match, 'home', ctx).concVol).toBeGreaterThan(1);       // …but more pressure
  });

  it('wide play gets the ball to the wingers and full-backs, narrow play through the middle', () => {
    const share = s => {
      let wide = 0, all = 0;
      for (const { match } of s) for (const e of match.tl.events) if (e.type === 'PASS' && e.side === 'home' && e.out === 'complete') {
        all++; if (['LW', 'RW', 'LB', 'RB'].includes(TL.lineupAt(match, 'home', e.t).get(e.tid))) wide++;
      }
      return wide / all;
    };
    const wideS = series({ width: 'wide' }, 20), narrowS = series({ width: 'narrow' }, 20);
    expect(share(wideS)).toBeGreaterThan(share(narrowS) + 0.05);
    for (const { match } of [...wideS, ...narrowS]) expect(TL.validate(match), match.id).toEqual([]);
  });

  it('the manager sets them from the tactics screen and at half-time', () => {
    const w = new GameWorld({ seed: 12, startCountry: 'England' });
    w.applyDecisions({ line: 'high', tempo: 'fast' });
    expect(w.snapshot().instructions).toEqual({ line: 'high', width: 'normal', tempo: 'fast' });
    w.applyDecisions({ width: 'wide', line: 'nonsense' });
    expect(w.club().instructions).toEqual({ line: 'high', width: 'wide', tempo: 'fast' });
  });
});
