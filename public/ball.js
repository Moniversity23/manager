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
//  shot            — driven at goal; long shots rise and dip; any ball can curl
//
// Curl bends the ball sideways and brings it back onto its target (it still arrives where it was
// aimed); wind pushes a ball in the air sideways and does not bring it back. Both are in metres,
// sideways to the line of the ball (+ = to the left of the direction of travel).
(function (root) {
  const FRICTION = 0.06;                          // ground deceleration, units/s² (≈ 6 m/s²: grass plus drag)
  const ARRIVE = { short: 0.11, through: 0.16 };  // speed when it reaches the receiver, units/s
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function plan(kind, dist, opts = {}) {
    dist = Math.max(0.005, dist);
    const curl = opts.curl || 0;
    if (kind === 'long' || kind === 'cross') {
      const cross = kind === 'cross';
      const dur = cross ? 0.4 + dist * 3.2 : 0.45 + dist * 3.6;
      const peak = cross ? clamp(0.2 + dist * 0.6, 0.3, 0.55) : clamp(0.12 + dist * 0.75, 0.2, 0.55);
      // A long ball can also be played onto the receiver's chest (no bounce, arrives at ~1.1 m).
      const chest = !cross && opts.arrive === 'chest';
      return { kind, dist, dur, peak, land: cross || chest ? 1 : 0.88, zEnd: cross ? 0.32 : chest ? 0.19 : 0.1, lofted: true, curl, wind: opts.wind || 0, chest };
    }
    const vEnd = ARRIVE[kind] || ARRIVE.short;
    const v0 = Math.sqrt(vEnd * vEnd + 2 * FRICTION * dist);
    return { kind: kind === 'through' ? 'through' : 'short', dist, dur: (2 * dist) / (v0 + vEnd), v0, vEnd, peak: 0, zEnd: 0, lofted: false, curl, wind: 0 };
  }

  // Sideways offset (metres) at fraction u of the flight: curl comes back to the line, wind does not.
  const sideways = (pl, u) => (pl.curl || 0) * 4 * u * (1 - u) + (pl.wind || 0) * u * u;

  // Position along the pass (0..1), height and ground speed (units/s) at time t after the kick.
  function at(pl, t) {
    t = clamp(t, 0, pl.dur);
    if (!pl.lofted) {
      const s = pl.v0 * t - 0.5 * FRICTION * t * t, p = clamp(s / pl.dist, 0, 1);
      return { p, z: 0, speed: Math.max(pl.vEnd, pl.v0 - FRICTION * t), side: sideways(pl, p) };
    }
    // Lofted: constant ground speed (air drag ignored), a parabola to the landing point, then
    // for a long ball one bounce up to the receiver.
    const u = t / pl.dur, speed = pl.dist / pl.dur;
    if (u <= pl.land) {
      const w = u / pl.land;
      const end = pl.land < 1 ? 0 : pl.zEnd;
      return { p: u, z: 4 * pl.peak * w * (1 - w) + end * w, speed, side: sideways(pl, u) };
    }
    const w = (u - pl.land) / (1 - pl.land);
    return { p: u, z: 4 * pl.peak * 0.2 * w * (1 - w) + pl.zEnd * w, speed, side: sideways(pl, u) };
  }

  // A shot: its duration is set by the match (the shot must arrive on the event's second); its
  // path is not. It ends at height z1; a long shot rises then dips onto it; curl bends it back in.
  function shot(dist, { z1 = 0.15, curl = 0 } = {}) {
    const dip = clamp((dist - 0.16) * 1.1, 0, 0.22);                     // from about 17 m out
    return { kind: 'shot', dist, z1, curl, dip, wind: 0 };
  }
  function shotAt(pl, u) {
    u = clamp(u, 0, 1);
    return { p: u, z: pl.z1 * u + (0.08 + pl.dip) * Math.sin(u * Math.PI) * (1 - 0.35 * u), side: sideways(pl, u) };
  }

  // A blocked shot: from the block it loops off wide and over (a deflection), ending outside the
  // post at height zEnd. Returns the new target in pitch units and the height to end at.
  function deflection(goalX, dir, fromY, seed) {
    const r = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;           // deterministic per shot
    const side = fromY < 0.5 ? -1 : 1;
    return { to: [goalX + dir * 0.03, 0.5 + side * (0.06 + 0.07 * r)], z: 0.25 + 0.4 * r };
  }

  // Converts a sideways offset (metres) into pitch units for a ball travelling from a to b.
  function sidewaysUnits(a, b, metres) {
    const dx = (b[0] - a[0]) * 105, dy = (b[1] - a[1]) * 68, L = Math.hypot(dx, dy) || 1;
    return [(-dy / L) * metres / 105, (dx / L) * metres / 68];
  }

  // The pass type the view should play when the timeline did not say: by distance and position.
  function kindFor(dist, fromWide, toBox) {
    if (fromWide && toBox && dist > 0.12) return 'cross';
    return dist > 0.27 ? 'long' : 'short';
  }

  const api = { plan, at, kindFor, shot, shotAt, deflection, sidewaysUnits, FRICTION };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GafferBall = api;
})(typeof self !== 'undefined' ? self : this);
