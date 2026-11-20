// Ball flight for the match view (public/ball.js).
import { describe, it, expect } from 'vitest';
const B = require('../public/ball.js');

const M = 105;                                    // metres per pitch-length unit
const sample = (pl, n = 60) => Array.from({ length: n + 1 }, (_, i) => B.at(pl, (pl.dur * i) / n));

describe('ball flight', () => {
  it('ground passes start at the passer, end at the receiver, slow down and never leave the ground', () => {
    for (const kind of ['short', 'through']) for (const d of [0.05, 0.15, 0.25]) {
      const pl = B.plan(kind, d), s = sample(pl);
      expect(s[0].p).toBe(0);
      expect(s[s.length - 1].p).toBeCloseTo(1, 5);
      for (let i = 1; i < s.length; i++) { expect(s[i].p).toBeGreaterThanOrEqual(s[i - 1].p); expect(s[i].z).toBe(0); expect(s[i].speed).toBeLessThanOrEqual(s[i - 1].speed + 1e-9); }
      expect(s[0].speed * M).toBeLessThan(30);                   // under 30 m/s off the foot
    }
  });

  it('takes realistic times: about a second for a 15 m pass, two for a 40 m ball', () => {
    expect(B.plan('short', 15 / M).dur).toBeGreaterThan(0.7);
    expect(B.plan('short', 15 / M).dur).toBeLessThan(1.4);
    expect(B.plan('long', 40 / M).dur).toBeGreaterThan(1.5);
    expect(B.plan('long', 40 / M).dur).toBeLessThan(2.6);
    expect(B.plan('through', 0.2).dur).toBeLessThan(B.plan('short', 0.2).dur);   // hit harder
  });

  it('long balls fly, land short of the receiver and bounce up to him', () => {
    const pl = B.plan('long', 0.4), s = sample(pl, 100);
    const top = Math.max(...s.map(x => x.z));
    expect(top * 6).toBeGreaterThan(2);                          // above head height
    const landIdx = Math.round(pl.land * 100);
    expect(s[landIdx].z).toBeLessThan(0.01);                     // touches down
    expect(s[100].z).toBeGreaterThan(0);                         // and comes up to the receiver
    for (const x of s) expect(x.z).toBeGreaterThanOrEqual(0);
  });

  it('crosses reach the box at head height', () => {
    const pl = B.plan('cross', 0.25), end = B.at(pl, pl.dur);
    expect(end.p).toBeCloseTo(1, 5);
    expect(end.z * 6).toBeGreaterThan(1.5);
    expect(end.z * 6).toBeLessThan(3);
  });

  it('is deterministic and chooses a kind when the timeline does not say', () => {
    expect(B.at(B.plan('long', 0.33), 0.7)).toEqual(B.at(B.plan('long', 0.33), 0.7));
    expect(B.kindFor(0.1, false, false)).toBe('short');
    expect(B.kindFor(0.35, false, false)).toBe('long');
    expect(B.kindFor(0.2, true, true)).toBe('cross');
  });
});
