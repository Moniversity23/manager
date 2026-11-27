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

  it('curl bends the ball and brings it back onto its target; wind pushes it and does not', () => {
    const pl = B.plan('cross', 0.25, { curl: 4 }), s = sample(pl, 100);
    expect(s[0].side).toBe(0);
    expect(s[100].side).toBeCloseTo(0, 6);                       // arrives where it was aimed
    expect(Math.max(...s.map(x => x.side))).toBeCloseTo(4, 1);   // 4 m of bend at the middle
    const windy = B.plan('long', 0.4, { wind: 2 });
    expect(B.at(windy, windy.dur).side).toBeCloseTo(2, 6);       // blown 2 m off line
    expect(B.at(B.plan('short', 0.2), 0.5).side).toBe(0);        // no curl asked, none given
    // Sideways metres convert to pitch units at right angles to the ball's line.
    const [ux, uy] = B.sidewaysUnits([0.5, 0.5], [0.7, 0.5], 3);
    expect(ux).toBeCloseTo(0, 9); expect(uy * 68).toBeCloseTo(3, 6);
  });

  it('shots end at their target height; long shots rise and dip, close ones are driven', () => {
    const long = B.shot(0.28, { z1: 0.1 }), close = B.shot(0.1, { z1: 0.1 });
    expect(B.shotAt(long, 1).z).toBeCloseTo(0.1, 6);
    expect(B.shotAt(close, 1).z).toBeCloseTo(0.1, 6);
    const peak = pl => Math.max(...Array.from({ length: 51 }, (_, i) => B.shotAt(pl, i / 50).z));
    expect(peak(long)).toBeGreaterThan(peak(close) + 0.1);       // the long one rises more…
    expect(peak(long) * 6).toBeLessThan(3);                      // …but stays under the bar's height plus a bit
    const curled = B.shot(0.2, { z1: 0.1, curl: 2.5 });
    expect(B.shotAt(curled, 0.5).side).toBeCloseTo(2.5, 6);
    expect(B.shotAt(curled, 1).side).toBeCloseTo(0, 6);
  });

  it('a blocked shot deflects wide of the post, the same way every time for the same shot', () => {
    for (const y of [0.3, 0.45, 0.55, 0.7]) {
      const d = B.deflection(1, 1, y, 17);
      expect(Math.abs(d.to[1] - 0.5)).toBeGreaterThan(0.055);   // outside the post (goal is ±0.054)
      expect(d.z).toBeGreaterThan(0.2);
      expect(B.deflection(1, 1, y, 17)).toEqual(d);
    }
  });

  it('is deterministic and chooses a kind when the timeline does not say', () => {
    expect(B.at(B.plan('long', 0.33), 0.7)).toEqual(B.at(B.plan('long', 0.33), 0.7));
    expect(B.kindFor(0.1, false, false)).toBe('short');
    expect(B.kindFor(0.35, false, false)).toBe('long');
    expect(B.kindFor(0.2, true, true)).toBe('cross');
  });
});

describe('ball flight: drag, bounces and the driven pass', () => {
  it('a lofted ball slows in the air, yet lands where and when it was planned', () => {
    const pl = B.plan('long', 0.4);
    const s = sample(pl, 80);
    expect(s[0].p).toBe(0);
    expect(s[80].p).toBeCloseTo(1, 6);                                  // arrives on time at the target
    expect(s[5].speed).toBeGreaterThan(s[60].speed * 1.3);              // fast off the boot, slower later
    // Drag makes the descent steeper than the rise: at the apex (half the time to landing) more than
    // half the ground to the landing point is already covered.
    const landT = pl.land * pl.dur, apex = B.at(pl, landT / 2), land = B.at(pl, landT);
    expect(apex.p / land.p).toBeGreaterThan(0.55);
  });

  it('a long ball bounces twice, each lower, and a cross does not bounce', () => {
    const pl = B.plan('long', 0.4), s = sample(pl, 400);
    const after = s.filter((_, i) => i / 400 > pl.land);
    let lows = 0;
    for (let i = 1; i < after.length - 1; i++) if (after[i].z < after[i - 1].z && after[i].z <= after[i + 1].z && after[i].z < 0.12) lows++;
    expect(lows).toBeGreaterThanOrEqual(1);                             // touches down between the two bounces
    const firstPeak = Math.max(...after.filter((_, i) => i < after.length * 0.6).map(x => x.z));
    const secondPeak = Math.max(...after.filter((_, i) => i > after.length * 0.66).map(x => x.z - pl.zEnd * 0.9));
    expect(firstPeak).toBeGreaterThan(secondPeak);
    const cr = B.plan('cross', 0.3);
    expect(cr.land).toBe(1);
  });

  it('a driven pass is quicker than a short one over the same distance and skims the grass', () => {
    const d = B.plan('driven', 0.22), sh = B.plan('short', 0.22);
    expect(d.dur).toBeLessThan(sh.dur);
    const s = sample(d, 60);
    expect(Math.max(...s.map(x => x.z))).toBeGreaterThan(0);
    expect(Math.max(...s.map(x => x.z)) * 6).toBeLessThan(0.3);        // under 30 cm: along the ground, not lofted
    expect(s[60].p).toBeCloseTo(1, 6);
    expect(s[60].z).toBeCloseTo(0, 9);
  });

  it('the same pass always flies the same way', () => {
    expect(sample(B.plan('long', 0.33, { curl: 2 }))).toEqual(sample(B.plan('long', 0.33, { curl: 2 })));
  });
});
