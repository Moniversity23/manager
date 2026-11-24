// Changes while the manager's match is being watched (GameWorld.liveChange / liveResume /
// liveFinish): what was already played never changes, the change applies from the next
// five-minute mark, the result stays deterministic, and the timeline stays valid.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index.js');
const ME = require('../src/engine/matchEngine.js');
const TL = require('../src/engine/timeline.js');
const { stateHash } = require('../src/saveStore.js');

function toHalfTime(seed = 208, country = 'Brazil') {
  const w = new GameWorld({ seed, startCountry: country });
  for (let i = 0; i < 6; i++) {
    w.beginWeek();
    let r;
    do { r = w.advanceWeek({}, true); } while (!r.halftime && !r.out);
    if (r.halftime) return { w, h: r.halftime };
  }
  throw new Error('no interactive match found');
}
const played = (m, upTo) => JSON.stringify(m.events.filter(e => e.min <= upTo && !(e.type === 'sub' && e.reason === 'manager')));

describe('live match changes', () => {
  it('the first half is played in five-minute segments with a mark at each one', () => {
    const { w, h } = toHalfTime();
    expect(h.phase).toBe('halftime');
    expect(h.live).toBe(true);
    expect(w._liveSnaps.map(s => s.minute)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);
    expect(ME.segmentsOf({ interactiveSide: 'home' }, 0, 45)).toHaveLength(9);
    expect(ME.segmentsOf({ interactiveSide: null, recordShots: true }, 0, 45)).toEqual([[0, 15], [15, 30], [30, 45]]);
  });

  it('a change applies at the next mark and leaves everything already played as it was', () => {
    const { w } = toHalfTime();
    const before = played(w.liveMatch.match, 20);
    const st = w.liveState(17.4);
    expect(st.ok).toBe(true);
    expect(st.minute).toBe(20);
    const off = st.onPitch.find(p => p.slot !== 'GK').playerId, on = st.bench.find(p => p.position !== 'GK').playerId;
    const r = w.liveChange(17.4, { tactic: 'high_press', instructions: { tempo: 90 }, subs: [{ offId: off, onId: on }] });
    expect(r.ok).toBe(true);
    expect(r.minute).toBe(20);
    expect(r.applied.subs).toBe(1);
    const m = w.liveMatch.match;
    expect(played(m, 20)).toBe(before);
    expect(m.events.some(e => e.type === 'sub' && e.reason === 'manager' && e.min === 20 && e.offId === off && e.onId === on)).toBe(true);
    expect(m[m.interactiveSide].tactic).toBe('high_press');
    expect(m[m.interactiveSide].windowsUsed).toBe(1);
    expect(TL.validate(m)).toEqual([]);
    // The player who came off no longer appears after the change; the one who came on does.
    expect(m.events.filter(e => e.min > 20 && e.side === m.interactiveSide && e.playerId === off)).toHaveLength(0);
  });

  it('the same change on the same career gives the same world', () => {
    const run = () => {
      const { w } = toHalfTime(311, 'Spain');
      const st = w.liveState(22);
      w.liveChange(22, { formation: '4-4-2', subs: [{ offId: st.onPitch.find(p => p.slot !== 'GK').playerId, onId: st.bench.find(p => p.position !== 'GK').playerId }] });
      w.liveResume({ talk: 'encourage' });
      w.liveChange(61, { tactic: 'low_block' });
      w.liveFinish();
      let r; do { r = w.advanceWeek({}, true); } while (r.halftime);
      return stateHash(w.toSave());
    };
    expect(run()).toBe(run());
  });

  it('the second half stays open until full time and can be changed while it is watched', () => {
    const { w } = toHalfTime();
    const lv = w.liveResume({});
    expect(lv.phase).toBe('full');
    expect(w.liveMatch).not.toBeNull();
    const before = played(w.liveMatch.match, 65);
    const r = w.liveChange(62.5, { instructions: { line: 85 } });
    expect(r.ok).toBe(true);
    expect(r.minute).toBe(65);
    expect(played(w.liveMatch.match, 65)).toBe(before);
    expect(TL.validate(w.liveMatch.match)).toEqual([]);
    const report = w.liveFinish();
    expect(report).toBeTruthy();
    expect(w.liveMatch).toBeNull();
    let out; do { out = w.advanceWeek({}, true); } while (out.halftime);
    expect(out.out).toBeTruthy();
  });

  it('no changes after the last mark of a half, and only three in-play substitution windows', () => {
    const { w } = toHalfTime();
    expect(w.liveState(41).ok).toBe(false);
    expect(w.liveChange(42, { tactic: 'counter' }).ok).toBe(false);
    for (const minute of [6, 11, 16]) {
      const st = w.liveState(minute);
      const used = new Set();
      const off = st.onPitch.find(p => p.slot !== 'GK' && !used.has(p.playerId)).playerId;
      const on = st.bench.find(p => p.position !== 'GK').playerId;
      expect(w.liveChange(minute, { subs: [{ offId: off, onId: on }] }).applied.subs).toBe(1);
    }
    const st = w.liveState(21);
    expect(st.windowsUsed).toBe(3);
    const r = w.liveChange(21, { subs: [{ offId: st.onPitch.find(p => p.slot !== 'GK').playerId, onId: st.bench.find(p => p.position !== 'GK').playerId }] });
    expect(r.applied.subs).toBe(0);
    expect(r.applied.errors[0]).toMatch(/windows/);
  });

  it('five-minute segments keep the scoring rates of fifteen-minute ones', () => {
    const w = new GameWorld({ seed: 77, startCountry: 'England' });
    const ctx = w.matchCtx();
    const clubs = w.clubs.filter(c => c.squad.length >= 16).slice(0, 40);
    const goals = { 5: 0, 15: 0 }, cards = { 5: 0, 15: 0 };
    let n = 0;
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i + 1 < clubs.length; i += 2) {
        for (const live of [true, false]) {
          for (const c of [clubs[i], clubs[i + 1]]) for (const p of c.squad) { p.fitness = 100; p.injury = null; }
          const { match: m } = ME.playMatch(ctx, { id: `t-${round}-${i}-${live}`, comp: 'x', week: 1, home: clubs[i], away: clubs[i + 1], recordShots: true, interactiveSide: live ? 'home' : null });
          const k = live ? 5 : 15;
          goals[k] += m.home.goals + m.away.goals;
          cards[k] += m.events.filter(e => e.type === 'yellow').length;
        }
        n++;
      }
    }
    const g5 = goals[5] / n, g15 = goals[15] / n;
    expect(Math.abs(g5 - g15)).toBeLessThan(0.45);
    expect(Math.abs(cards[5] / n - cards[15] / n)).toBeLessThan(0.8);
  });
});
