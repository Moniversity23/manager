// public/ball.js — ball flight for the match view (2D and 3D), deterministic and dependency-free.
//
// Units are the view's: x and y are pitch fractions (1 unit of x ≈ 105 m), z is height (1 ≈ 6 m),
// time in seconds of match-view time. Each pass gets a plan from its kind and distance; at(plan, t)
// gives how far along it is (0..1), its height and its ground speed. The same plan always gives
// the same flight, so a replay of the same pass is identical.
//
//  short / through — along the ground, slowing under rolling friction (a through ball is hit harder
//                    so it is still running when it reaches the receiver's stride)
//  long            — lofted: flies, lands short of the receiver and bounces up to him
//  cross           — lofted from wide, still at head height when it reaches the man in the box
(function (root) {
  const FRICTION = 0.06;                          // ground deceleration, units/s² (≈ 6 m/s²: grass plus drag)
  const ARRIVE = { short: 0.11, through: 0.16 };  // speed when it reaches the receiver, units/s
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function plan(kind, dist) {
    dist = Math.max(0.005, dist);
    if (kind === 'long' || kind === 'cross') {
      const cross = kind === 'cross';
      const dur = cross ? 0.4 + dist * 3.2 : 0.45 + dist * 3.6;
      const peak = cross ? clamp(0.2 + dist * 0.6, 0.3, 0.55) : clamp(0.12 + dist * 0.75, 0.2, 0.55);
      return { kind, dist, dur, peak, land: cross ? 1 : 0.88, zEnd: cross ? 0.32 : 0.1, lofted: true };
    }
    const vEnd = ARRIVE[kind] || ARRIVE.short;
    const v0 = Math.sqrt(vEnd * vEnd + 2 * FRICTION * dist);
    return { kind: kind === 'through' ? 'through' : 'short', dist, dur: (2 * dist) / (v0 + vEnd), v0, vEnd, peak: 0, zEnd: 0, lofted: false };
  }

  // Position along the pass (0..1), height and ground speed (units/s) at time t after the kick.
  function at(pl, t) {
    t = clamp(t, 0, pl.dur);
    if (!pl.lofted) {
      const s = pl.v0 * t - 0.5 * FRICTION * t * t;
      return { p: clamp(s / pl.dist, 0, 1), z: 0, speed: Math.max(pl.vEnd, pl.v0 - FRICTION * t) };
    }
    // Lofted: constant ground speed (air drag ignored), a parabola to the landing point, then
    // for a long ball one bounce up to the receiver.
    const u = t / pl.dur, speed = pl.dist / pl.dur;
    if (u <= pl.land) {
      const w = u / pl.land;
      const end = pl.land < 1 ? 0 : pl.zEnd;
      return { p: u, z: 4 * pl.peak * w * (1 - w) + end * w, speed };
    }
    const w = (u - pl.land) / (1 - pl.land);
    return { p: u, z: 4 * pl.peak * 0.2 * w * (1 - w) + pl.zEnd * w, speed };
  }

  // The pass type the view should play when the timeline did not say: by distance and position.
  function kindFor(dist, fromWide, toBox) {
    if (fromWide && toBox && dist > 0.12) return 'cross';
    return dist > 0.27 ? 'long' : 'short';
  }

  const api = { plan, at, kindFor, FRICTION };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GafferBall = api;
})(typeof self !== 'undefined' ? self : this);
