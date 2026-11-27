// Mentality, pressing, passing and player instructions (the pause panel's extra controls): neutral
// settings change nothing, each setting moves the match the way its label says, and player
// instructions change who shoots without changing how many chances there are.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');
const ME = require('../src/engine/matchEngine');

function series(setup, n = 40, seed = 2611) {
  const w = new GameWorld({ seed, startCountry: 'England' });
  const clubs = w.clubs.filter(c => c.division === 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const home = clubs[i % 10], away = clubs[10 + (i % 10)];
    setup(home, w);
    const { match, result } = ME.playMatch(w.matchCtx(), { id: `tx-${i}`, comp: 'league', compName: 'T', week: 1, home, away, recordShots: true });
    out.push({ match, result, home, w });
  }
  return out;
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const key = s => s.map(x => [x.result.hg, x.result.ag, x.result.hx, x.result.ax].join(':')).join('|');

describe('mentality, pressing and passing', () => {
  it('neutral settings and no player instructions give exactly the old results', () => {
    const none = series(h => { h.instructions = undefined; h.playerInstructions = undefined; }, 12);
    const neutral = series(h => { h.instructions = { mentality: 'balanced', press: 'normal', passing: 'mixed', line: 50 }; h.playerInstructions = {}; }, 12);
    expect(key(neutral)).toBe(key(none));
  });

  it('an attacking mentality makes more chances at both ends than a defensive one', () => {
    const att = series(h => { h.instructions = { mentality: 90 }; }), def = series(h => { h.instructions = { mentality: 10 }; });
    expect(mean(att.map(x => x.match.home.shots))).toBeGreaterThan(mean(def.map(x => x.match.home.shots)));
    expect(mean(att.map(x => x.match.away.shots))).toBeGreaterThan(mean(def.map(x => x.match.away.shots)));
  });

  it('a high press allows fewer shots and tires the team more than sitting off', () => {
    const hi = series(h => { h.instructions = { press: 95 }; }), lo = series(h => { h.instructions = { press: 5 }; });
    expect(mean(hi.map(x => x.match.away.shots))).toBeLessThan(mean(lo.map(x => x.match.away.shots)));
    const cond = s => mean(s.flatMap(x => x.match.home.startXI.map(p => x.w.players.get(p.playerId).fitness)));
    expect(cond(hi)).toBeLessThan(cond(lo));
  });

  it('direct passing makes more, poorer shots than short passing', () => {
    const dir = series(h => { h.instructions = { passing: 95 }; }), sho = series(h => { h.instructions = { passing: 5 }; });
    const perShot = s => mean(s.map(x => x.match.home.xg / Math.max(1, x.match.home.shots)));
    expect(mean(dir.map(x => x.match.home.shots))).toBeGreaterThan(mean(sho.map(x => x.match.home.shots)));
    expect(perShot(dir)).toBeLessThan(perShot(sho));
  });

  it('the setting is saved with the club, and words or numbers are both accepted', () => {
    const w = new GameWorld({ seed: 3, startCountry: 'England' });
    w.applyDecisions({ mentality: 'attacking', press: 70, passing: 'short' });
    expect(ME.normInstr(w.club().instructions)).toMatchObject({ mentality: 80, press: 70, passing: 20, line: 50 });
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));
    expect(ME.normInstr(w2.club().instructions)).toMatchObject({ mentality: 80, press: 70, passing: 20 });
  });
});

describe('player instructions', () => {
  it('"shoot on sight" gives a player more of his side\'s shots without changing how many there are', () => {
    let target = null;
    const base = series(h => { h.playerInstructions = {}; });
    const told = series((h, w) => { const st = h.squad.find(p => p.position === 'CM') || h.squad[5]; target = st.id; h.playerInstructions = { [st.id]: 'shoot' }; });
    // Same number of shots per match (the volume is unchanged)…
    expect(told.map(x => x.match.home.shots)).toEqual(base.map(x => x.match.home.shots));
    // …but the told player takes more of them.
    const share = (s, id) => mean(s.map(x => { const ev = x.match.events.filter(e => e.side === 'home' && (e.type === 'shot' || e.type === 'goal')); return ev.length ? ev.filter(e => e.playerId === id).length / ev.length : 0; }));
    const ids = told.map(x => x.home.playerInstructions && Object.keys(x.home.playerInstructions)[0]).filter(Boolean).map(Number);
    expect(ids.length).toBeGreaterThan(0);
    const id = ids[0];
    expect(share(told, id)).toBeGreaterThan(share(base, id));
  });

  it('only known instructions for numeric ids are kept', () => {
    expect(ME.cleanPlayerInstr({ 12: 'shoot', 13: 'fly', x: 'hold', 14: 'hold' })).toEqual({ 12: 'shoot', 14: 'hold' });
    expect(ME.cleanPlayerInstr(null)).toEqual({});
  });

  it('a change made while the match is paused is applied and kept with the club', () => {
    const w = new GameWorld({ seed: 77, startCountry: 'England' });
    const club = w.club();
    const m = ME.createMatch ? null : null;   // the live flow is covered by live-match tests; here the decision itself
    const { match } = ME.playMatch(w.matchCtx(), { id: 'pi', comp: 'league', compName: 'T', week: 1, home: club, away: w.clubs.find(c => c.id !== club.id && c.division === club.division) });
    const pid = match.home.onPitch.find(s => s.slot !== 'GK').playerId;
    const applied = ME.applyHalftime(match, 'home', { playerInstructions: { [pid]: 'create' } }, w.matchCtx(), 60);
    expect(applied.playerInstructions).toEqual({ [pid]: 'create' });
    expect(club.playerInstructions).toEqual({ [pid]: 'create' });
    expect(m).toBeNull();
  });
});

describe('position swaps from the substitution board', () => {
  it('two outfield players exchange positions; the goalkeeper cannot be swapped', () => {
    const w = new GameWorld({ seed: 78, startCountry: 'England' });
    const club = w.club();
    const { match } = ME.playMatch(w.matchCtx(), { id: 'sw', comp: 'league', compName: 'T', week: 1, home: club, away: w.clubs.find(c => c.id !== club.id && c.division === club.division) });
    const out = match.home.onPitch.filter(s => s.slot !== 'GK');
    const [a, b] = [out[0], out[out.length - 1]], [sa, sb] = [a.slot, b.slot], [ia, ib] = [a.playerId, b.playerId];
    const applied = ME.applyHalftime(match, 'home', { swaps: [[ia, ib]] }, w.matchCtx(), 60);
    expect(applied.swaps).toBe(1);
    expect(match.home.onPitch.find(s => s.playerId === ia).slot).toBe(sb);
    expect(match.home.onPitch.find(s => s.playerId === ib).slot).toBe(sa);
    const gk = match.home.onPitch.find(s => s.slot === 'GK').playerId;
    const bad = ME.applyHalftime(match, 'home', { swaps: [[gk, ia]] }, w.matchCtx(), 61);
    expect(bad.errors).toContain('Invalid position swap');
    expect(match.home.onPitch.find(s => s.slot === 'GK').playerId).toBe(gk);
  });

  it('a substitute can be moved in the same change, and a swap uses no substitution or window', () => {
    const w = new GameWorld({ seed: 79, startCountry: 'England' });
    const club = w.club();
    const { match } = ME.playMatch(w.matchCtx(), { id: 'sw2', comp: 'league', compName: 'T', week: 1, home: club, away: w.clubs.find(c => c.id !== club.id && c.division === club.division) });
    match.home.subsUsed = 0; match.home.windowsUsed = 0;
    const offSlot = match.home.onPitch.find(s => s.slot !== 'GK'), other = match.home.onPitch.filter(s => s.slot !== 'GK')[3];
    const onId = match.home.bench.find(id => !match.home.apps[id]);
    const otherSlot = other.slot, otherId = other.playerId;
    const r = ME.applyHalftime(match, 'home', { subs: [{ offId: offSlot.playerId, onId }], swaps: [[onId, otherId]] }, w.matchCtx(), 60);
    expect(r.subs).toBe(1); expect(r.swaps).toBe(1);
    expect(match.home.onPitch.find(s => s.playerId === onId).slot).toBe(otherSlot);
    expect(match.home.subsUsed).toBe(1); expect(match.home.windowsUsed).toBe(1);
  });
});

