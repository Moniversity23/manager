// The dribble drawn in the match view (public/index.html, simDribble): the ball is pushed ahead of
// the carrier in touches and rolls out between them, never trailing behind him, at walking pace and
// at a sprint, through a turn, at 4× speed; and when the ball changes hands (a tackle, a pass
// received) it carries on from where it is, without jumping. The engine and timeline decide who has
// the ball; this only draws it.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';
import * as THREE from '../public/vendor/three.module.min.js';
import { dribbleLegIK, plantFeet, shapeBody, warpClip } from '../public/match3d.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { readGLB } = require('../scripts/anim/glb.js');
const FOOTBALLER_ANIMS = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../public/models/footballer-anims.json', import.meta.url)), 'utf8'));
const TEST_CLIPS = new Map();
function testClip(name) {
  if (!TEST_CLIPS.has(name)) { const c = FOOTBALLER_ANIMS.clips[name]; TEST_CLIPS.set(name, THREE.AnimationClip.parse({ name, duration: c.duration, tracks: c.tracks })); }
  return TEST_CLIPS.get(name);
}
const GAITS = [
  { key: 'walk', threshold: 1.3, rate: 0.915, offset: 0.092, source: 'walk' },
  { key: 'jogShort', threshold: 2.5, rate: 1.6, offset: 0.876, source: 'jog', warp: 0.32 },
  { key: 'run', threshold: 4.0, rate: 2.5, offset: 0.883, source: 'jog', warp: 0.42 },
  { key: 'sprintRun', threshold: 5.5, rate: 4.52, offset: 0.89, source: 'sprint', warp: 0.66 },
  { key: 'sprintFull', threshold: 7.5, rate: 5.49, offset: 0.891, source: 'sprint', warp: 0.74 },
];
const gaitAt = (speed, heightScale = 1) => {
  let i = 0; while (i < GAITS.length - 2 && speed > GAITS[i + 1].threshold) i++;
  const a = GAITS[i], b = GAITS[Math.min(i + 1, GAITS.length - 1)], x = Math.max(0, Math.min(1, (speed - a.threshold) / (b.threshold - a.threshold)));
  const clips = [{ ...a, weight: 1 - x }, { ...b, weight: x }].filter(c => c.weight > 0.001);
  const stride = clips.reduce((n, c) => n + c.weight * c.rate * testClip(c.source).duration, 0) * heightScale;
  const offset = clips.reduce((n, c) => n + c.weight * c.offset, 0);
  return { clips, stride, offset, cycles: speed / stride };
};

// The page's scripts in a sandbox (as in ui.test.js), for their pure functions.
function loadUI() {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf-8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, appendChild() {}, remove() {}, querySelectorAll() { return []; }, querySelector() { return null; } });
  const els = new Map();
  const document = { getElementById: id => { if (!els.has(id)) els.set(id, el()); return els.get(id); }, querySelectorAll: () => [], createElement: el, addEventListener() {}, documentElement: { dataset: {} } };
  const ctx = vm.createContext({ document, window: { location: { origin: 'http://test' }, addEventListener() {}, innerWidth: 1200 }, navigator: { sendBeacon() {} }, location: { protocol: 'file:' },
    localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ json: async () => ({}) }), setTimeout: () => 0, clearTimeout() {}, console, URL, Blob: class {}, confirm: () => true, prompt: () => null });
  for (const s of scripts) vm.runInContext(s, ctx);
  return ctx;
}
const ctx = loadUI();
const M = [105, 68];

// Runs a carrier along path(t) → [x, y] metres (heading for where he will be in a second), drawing
// the dribble every frame. hand(t) may give the ball to someone else: { side, idx, at: [x, y] }.
function run({ path, secs = 6, fps = 60, speed = 1, hand = null, foot = 'right', id = 1, heightCm = 181 }) {
  const v = { ball: { x: 0, y: 0, z: 0 }, dots: { home: [{}], away: [{}] } };
  const s = { poss: 'home', holder: 0, t: 0, phase: 'play' };
  const dt = speed / fps, out = [];
  const [x0, y0] = path(0); v.ball.x = (x0 + 0.4) / M[0]; v.ball.y = y0 / M[1];
  let prev = null;
  for (let i = 0; i <= secs * fps / speed; i++) {
    const t = i * dt; s.t = t;
    const h = hand && hand(t);
    if (h && (s.poss !== h.side || s.holder !== h.idx)) { s.poss = h.side; s.holder = h.idx; }
    const who = s.poss === 'home' ? path : (h && h.path) || path;
    const [x, y] = who(t), [x1, y1] = who(t + 1 / 60), [xa, ya] = who(t + 1), [xw, yw] = who(t + 0.5), [xw1, yw1] = who(t + 0.5 + 1 / 60);
    const d = v.dots[s.poss][s.holder];
    Object.assign(d, { x: x / M[0], y: y / M[1], vx: (x1 - x) * 60 / M[0], vy: (y1 - y) * 60 / M[1], wantVx: (xw1 - xw) * 60 / M[0], wantVy: (yw1 - yw) * 60 / M[1], accelRate: 7, tx: xa / M[0], ty: ya / M[1], foot, id, heightCm });
    ctx.simDribble(v, s, dt);
    const bx = v.ball.x * M[0], by = v.ball.y * M[1], vx = (x1 - x) * 60, vy = (y1 - y) * 60, sp = Math.hypot(vx, vy);
    const along = sp > 0.3 ? ((bx - x) * vx + (by - y) * vy) / sp : null;
    const across = sp > 0.3 ? (-(bx - x) * vy + (by - y) * vx) / sp : null;
    out.push({ t, bx, by, x, y, sp, along, across, dist: Math.hypot(bx - x, by - y), jump: prev ? Math.hypot(bx - prev[0], by - prev[1]) / dt : 0, touch: s.touch ? s.touch.t0 : null, foot: s.touch ? s.touch.foot : null, next: s.drib ? s.drib.next : null, recover: !!(s.drib && s.drib.recovering), meetGap: s.drib ? s.drib.meetGap : null, owner: s.drib ? `${s.drib.side}:${s.drib.idx}` : null });
    prev = [bx, by];
  }
  return out;
}
const straight = mps => t => [20 + mps * t, 34];
const settled = (rows, from = 0.8) => rows.filter(r => r.t >= from && r.along != null);
const share = (rows, f) => rows.filter(f).length / Math.max(1, rows.length);
const touches = rows => [...new Set(rows.map(r => r.touch).filter(x => x != null))];

async function footballerRig(heightCm, build = 7) {
  const glb = await readGLB(fileURLToPath(new URL('../public/models/footballer.glb', import.meta.url)));
  const nodes = glb.json.nodes, joints = new Set(glb.json.skins[0].joints);
  const objects = nodes.map((n, i) => {
    const o = joints.has(i) ? new THREE.Bone() : new THREE.Group(); o.name = n.name || '';
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
    return o;
  });
  const parented = new Set();
  nodes.forEach((n, i) => (n.children || []).forEach(j => { objects[i].add(objects[j]); parented.add(j); }));
  const model = new THREE.Group(); model.rotation.y = Math.PI / 2;
  objects.forEach((o, i) => { if (!parented.has(i)) model.add(o); });
  const by = name => objects.find(o => o.name === name);
  const body = { shoulders: 0.35 + build / 15 * 0.35, chest: 0.4 + build / 15 * 0.25, waist: 0.45 + build / 15 * 0.15, arms: 0.5, legs: 0.5, muscle: 0.3 + build / 15 * 0.45 };
  body.muscle = 0.5 + (body.muscle - 0.5) * 0.35;
  shapeBody(model, by, { heightCm, build, body });
  const root = new THREE.Group(), holder = new THREE.Group(); holder.scale.setScalar(1.2 * heightCm / 181); root.add(holder); holder.add(model);
  const bones = { thl: by('thigh_l'), thr: by('thigh_r'), cal: by('calf_l'), car: by('calf_r'), ftl: by('foot_l'), ftr: by('foot_r'), toel: by('ball_l'), toer: by('ball_r') };
  const rest = Object.fromEntries(Object.entries(bones).map(([k, b]) => [k, b.quaternion.clone()]));
  const mixer = new THREE.AnimationMixer(model); let actions = [];
  const useGait = speed => {
    for (const x of actions) x.action.stop();
    const gait = gaitAt(speed, heightCm / 181);
    actions = gait.clips.map(c => {
      const src = testClip(c.source), clip = c.warp ? warpClip(src, `test-${c.key}`, c.warp) : src;
      const action = mixer.clipAction(clip); action.reset().play(); action.setEffectiveWeight(c.weight);
      return { action, offset: c.offset };
    });
    return gait;
  };
  const useClip = name => { for (const x of actions) x.action.stop(); const action = mixer.clipAction(testClip(name)); action.reset().play(); actions = [{ action, offset: 0 }]; };
  const poseClip = phase => { for (const x of actions) x.action.time = ((phase + x.offset) % 1) * x.action.getClip().duration; if (actions.length) { mixer.update(0); root.updateMatrixWorld(true); } };
  const setPose = (x, z, face, phase, speed) => {
    root.position.set(x, 0, z); root.rotation.y = face;
    for (const k of Object.keys(rest)) bones[k].quaternion.copy(rest[k]);
    const swing = Math.sin(phase * Math.PI * 2) * Math.min(0.34, speed * 0.035);
    bones.thl.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), swing));
    bones.thr.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -swing));
    bones.cal.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.max(0.08, speed * 0.045)));
    bones.car.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.max(0.08, speed * 0.045)));
    root.updateMatrixWorld(true);
  };
  return { root, holder, bones, rest, setPose, useClip, useGait, poseClip };
}

describe('dribbling in the match view', () => {
  it('at walking pace the ball stays just ahead of him, touched about every half second', () => {
    const rows = run({ path: straight(2) }), s = settled(rows);
    expect(share(s, r => r.along > 0)).toBeGreaterThan(0.97);
    const lead = s.reduce((a, r) => a + r.along, 0) / s.length;
    expect(lead).toBeGreaterThan(0.35); expect(lead).toBeLessThan(1.3);
    expect(Math.max(...s.map(r => r.dist))).toBeLessThan(2.2);
    const T = touches(rows), gaps = T.slice(1).map((t, i) => t - T[i]);
    expect(T.length).toBeGreaterThan(8);
    expect(Math.min(...gaps.slice(2))).toBeGreaterThan(0.25);
    expect(Math.max(...gaps.slice(2))).toBeLessThan(0.75);
  });

  it('at a sprint the ball is pushed further ahead and still never trails him', () => {
    const rows = run({ path: straight(8) }), s = settled(rows);
    expect(share(s, r => r.along > 0)).toBeGreaterThan(0.95);
    const lead = s.reduce((a, r) => a + r.along, 0) / s.length;
    expect(lead).toBeGreaterThan(1.0); expect(lead).toBeLessThan(3.2);
    expect(Math.max(...s.map(r => r.dist))).toBeLessThan(4.5);
    expect(Math.max(...rows.slice(1).map(r => r.jump))).toBeLessThan(30);          // no teleport
  });

  it('follows him through a turn: ahead again in the new direction within a second', () => {
    // East at 5 m/s for 2 s, a tight U-turn over 0.6 s, then west.
    const path = t => (t < 2 ? [20 + 5 * t, 34] : t < 2.6 ? [30 + 1.5 * Math.sin((t - 2) / 0.6 * Math.PI), 34 + 1.5 * (1 - Math.cos((t - 2) / 0.6 * Math.PI))] : [30 - 5 * (t - 2.6), 37]);
    const rows = run({ path, secs: 5 });
    const after = rows.filter(r => r.t > 3.5 && r.along != null);
    expect(after.some(r => r.recover)).toBe(true);
    expect(Math.max(...rows.slice(1).map(r => r.jump))).toBeLessThan(30);
  });

  it('at 4× speed (fewer, longer frames) the ball is still ahead of him', () => {
    for (const mps of [2, 7]) {
      const s = settled(run({ path: straight(mps), speed: 4, secs: 12 }));
      expect(share(s, r => r.along > 0), `${mps} m/s`).toBeGreaterThan(0.9);
    }
  });

  it('a tackle: the defender takes it from where it is, with no jump, and dribbles it his way', () => {
    const def = t => [36 - 3 * Math.max(0, t - 3), 34];                         // waiting, then carrying it back
    const rows = run({ path: straight(4), secs: 6, hand: t => (t >= 3 ? { side: 'away', idx: 0, path: def } : { side: 'home', idx: 0 }) });
    const at = rows.findIndex(r => r.t >= 3);
    expect(rows[at + 1].owner).toBe('away:0');
    expect(Math.max(...rows.slice(at - 2, at + 20).map(r => r.jump))).toBeLessThan(30);
    const later = rows.filter(r => r.t > 4.5 && r.along != null);
    expect(share(later, r => r.along > 0)).toBeGreaterThan(0.9);                // ahead of the new carrier
  });

  it('receiving: the ball starts from where it arrived and is then carried on', () => {
    // The ball arrives 1.2 m away from a team-mate standing still; he then runs with it.
    const rec = t => (t < 0.5 ? [50, 30] : [50 + 4 * (t - 0.5), 30]);
    const rows = run({ path: rec, secs: 3 });
    expect(rows[1].jump).toBeLessThan(30);
    expect(share(rows.filter(r => r.t > 1.4 && r.along != null), r => r.along > 0)).toBeGreaterThan(0.95);
  });

  it('every touch is made at his feet, when he gets to the ball, about when it was planned', () => {
    for (const mps of [1, 2.5, 4.5, 7.5]) {
      const rows = run({ path: straight(mps), secs: 8 });
      const at = rows.filter((r, i) => i > 0 && r.touch != null && r.touch !== rows[i - 1].touch && r.t > 0.6);
      expect(at.length, `${mps} m/s touches`).toBeGreaterThan(3);
      // The ball as he plays it: just ahead of his body (within his reach, 0.5 m; at most 0.2 m past it),
      // a little to one side, never behind him.
      for (const r of at) {
        const prev = r;
        expect(prev.along, `${mps} m/s at ${r.t.toFixed(2)}`).toBeGreaterThan(-0.1);
        expect(prev.along, `${mps} m/s at ${r.t.toFixed(2)}`).toBeLessThan(0.72);
        expect(Math.abs(prev.across), `${mps} m/s at ${r.t.toFixed(2)}`).toBeLessThan(0.45);
      }
      // Planned: each touch comes within a tenth of a second of when the last one aimed it to.
      for (let i = 1; i < at.length; i++) { const plan = rows[rows.indexOf(at[i]) - 1].next; expect(Math.abs(at[i].t - plan), `${mps} m/s plan`).toBeLessThan(0.12 + 1 / 60); }
    }
  });

  it('keeps the ball within normal carrier control reach across pace changes, turns and playback rates', () => {
    const turn = sign => t => {
      if (t < 2) return [20 + 5 * t, 34];
      const u = t - 2, radius = 20 / Math.PI, v = 5 / Math.SQRT2;
      if (u < 1) {
        const a = Math.min(Math.PI / 4, u * Math.PI / 4);
        return [30 + radius * Math.sin(a), 34 + sign * radius * (1 - Math.cos(a))];
      }
      return [30 + radius * Math.sin(Math.PI / 4) + v * (u - 1), 34 + sign * radius * (1 - Math.cos(Math.PI / 4)) + sign * v * (u - 1)];
    };
    const profiles = [
      { name: 'accelerate', path: t => [20 + 2 * t + 0.28 * t * t, 34] },
      { name: 'decelerate', path: t => t < 1 ? [20 + 7 * t, 34] : [27 + 2.8 * (t - 1), 34] },
      { name: 'left turn', path: turn(1) },
      { name: 'right turn', path: turn(-1) },
    ];
    const reports = [];
    for (const profile of profiles) for (const playback of [1, 2, 4, 8]) for (const foot of ['left', 'right']) {
      const label = profile.name + ', ' + playback + 'x, ' + foot;
      const rows = run({ path: profile.path, secs: 6, speed: playback, foot, id: foot === 'left' ? 41 : 42, heightCm: foot === 'left' ? 164 : 198 });
      const at = rows.filter((r, i) => i > 0 && r.touch != null && r.touch !== rows[i - 1].touch && r.t > 0.6);
      expect(at.length, label + ': contact count').toBeGreaterThan(1);
      const gaps = at.map(r => r.dist).sort((a, b) => a - b);
      const aligned = gaps.filter(d => d <= 0.85).length;
      const p95 = gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)];
      reports.push({ profile: profile.name, playback, foot, events: gaps.length, aligned, misses: gaps.length - aligned,
        median: +gaps[Math.floor((gaps.length - 1) * 0.5)].toFixed(3), p95: +p95.toFixed(3), max: +gaps[gaps.length - 1].toFixed(3) });
      expect(aligned / gaps.length, label + ': player-ball control reach').toBeGreaterThanOrEqual(0.98);
    }
    console.log('Player-ball control reach matrix:', JSON.stringify(reports));
  });
  it('measures selected-boot contact on the shipped footballer skeleton with IK', async () => {
    const turn = sign => t => {
      if (t < 2) return [20 + 5 * t, 34];
      const u = t - 2, radius = 20 / Math.PI, v = 5 / Math.SQRT2;
      if (u < 1) { const a = Math.min(Math.PI / 4, u * Math.PI / 4); return [30 + radius * Math.sin(a), 34 + sign * radius * (1 - Math.cos(a))]; }
      return [30 + radius * Math.sin(Math.PI / 4) + v * (u - 1), 34 + sign * radius * (1 - Math.cos(Math.PI / 4)) + sign * v * (u - 1)];
    };
    const profiles = [
      { name: 'accelerate', path: t => [20 + 2 * t + 0.28 * t * t, 34] },
      { name: 'decelerate', path: t => t < 1 ? [20 + 7 * t, 34] : [27 + 2.8 * (t - 1), 34] },
      { name: 'left turn', path: turn(1) }, { name: 'right turn', path: turn(-1) },
    ];
    const rigs = new Map(), gaps = [], byGroup = {};
    for (const profile of profiles) for (const playback of [1, 2, 4, 8]) for (const build of [1, 14]) for (const preferred of ['left', 'right']) {
      const heightCm = preferred === 'left' ? 164 : 198, rows = run({ path: profile.path, secs: 6, speed: playback, foot: preferred, id: preferred === 'left' ? 41 : 42, heightCm });
      const contacts = rows.filter((r, i) => i > 0 && r.touch != null && r.touch !== rows[i - 1].touch && r.t > 0.6);
      const label = `${profile.name}/${playback}x/${heightCm}cm/build${build}/${preferred}`;
      for (const row of contacts) {
        const foot = row.foot < 0 ? 'left' : 'right', rigKey = `${heightCm}/${build}/${foot}`;
        if (!rigs.has(rigKey)) rigs.set(rigKey, await footballerRig(heightCm, build));
        const rig = rigs.get(rigKey), lookAhead = profile.path(row.t + 0.002), lookBack = profile.path(Math.max(0, row.t - 0.002));
        const face = Math.atan2(-(lookAhead[1] - lookBack[1]), lookAhead[0] - lookBack[0]);
        const gait = rig.useGait(row.sp), phase = (row.t * gait.cycles) % 1;
        rig.root.position.set(row.x - M[0] / 2, 0, row.y - M[1] / 2); rig.root.rotation.y = face; rig.poseClip(phase);
        dribbleLegIK({ holder: rig.holder, bones: rig.bones, face }, { foot: row.foot, w: 1 }, { bx: row.bx - M[0] / 2, bz: row.by - M[1] / 2 });
        const toe = rig.bones[row.foot < 0 ? 'toel' : 'toer'].getWorldPosition(new THREE.Vector3());
        const centerX = toe.x + Math.cos(face) * 0.19, centerZ = toe.z - Math.sin(face) * 0.19;
        const gap = Math.hypot(centerX - (row.bx - M[0] / 2), centerZ - (row.by - M[1] / 2));
        gaps.push(gap); (byGroup[label] ||= []).push(gap);
      }
    }
    const sorted = gaps.slice().sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const aligned = gaps.filter(g => g <= 0.12).length;
    console.log('Actual skeleton boot contact:', JSON.stringify({ events: gaps.length, aligned, misses: gaps.length - aligned,
      median: +sorted[Math.floor((sorted.length - 1) * 0.5)].toFixed(3), p95: +p95.toFixed(3), max: +sorted[sorted.length - 1].toFixed(3),
      failures: Object.fromEntries(Object.entries(byGroup).filter(([, xs]) => xs.some(g => g > 0.12)).map(([k, xs]) => [k, { events: xs.length, max: +Math.max(...xs).toFixed(3) }])) }));
    expect(gaps.length).toBeGreaterThan(50);
    expect(aligned / gaps.length).toBeGreaterThanOrEqual(0.98);
  });
  it('anchors planted feet in world space across walk, jog and sprint speeds', async () => {
    const reports = [], slips = [];
    const gaits = [{ speed: 1.1 }, { speed: 3.5 }, { speed: 7.5 }];
    for (const gait of gaits) {
      const speed = gait.speed;
      const rig = await footballerRig(181), u = { holder: rig.holder, bones: rig.bones, spd: speed };
      const animation = rig.useGait(speed), stride = animation.stride, cycles = animation.cycles;
      u.gaitPeriod = 1 / cycles;
      const dt = 1 / 60, frames = Math.ceil(120 / dt), previous = { left: null, right: null }, contactFrames = { left: 0, right: 0 }, phaseDurations = { left: [], right: [] }, currentPhase = { left: 0, right: 0 }, rawCycle = { left: [], right: [] };
      for (let i = 0; i < frames; i++) {
        const t = i * dt, basePhase = (t * cycles) % 1, phase = basePhase + animation.offset;
        rig.root.position.set(speed * t, 0, 0); rig.root.rotation.y = 0; rig.poseClip(basePhase);
        if (i < Math.ceil(u.gaitPeriod / dt)) for (const [name, bone] of [['left', rig.bones.toel], ['right', rig.bones.toer]]) rawCycle[name].push(bone.getWorldPosition(new THREE.Vector3()).y);
        plantFeet(u, phase % 1, dt);
        for (const [name, bone] of [['left', rig.bones.toel], ['right', rig.bones.toer]]) {
          const active = u.planted && u.planted[name].active, p = bone.getWorldPosition(new THREE.Vector3());
          if (active) contactFrames[name]++;
          if (active) currentPhase[name] += dt;
          else if (currentPhase[name] > 0) { phaseDurations[name].push(currentPhase[name]); currentPhase[name] = 0; }
          const groundBand = u.planted && u.planted[name].contactHeight;
          if (active && previous[name] && previous[name].active && Number.isFinite(groundBand) && p.y < groundBand + 0.06) slips.push({ speed, foot: name, value: p.distanceTo(previous[name].p) / dt, p: p.toArray(), anchor: u.planted[name].anchor.toArray() });
          previous[name] = { active, p };
        }
      }
      for (const name of ['left', 'right']) if (currentPhase[name] > 0) phaseDurations[name].push(currentPhase[name]);
      const rawContactShare = Object.fromEntries(['left', 'right'].map(name => { const xs = rawCycle[name], lo = Math.min(...xs); return [name, +(xs.filter(y => y <= lo + 0.025).length / xs.length).toFixed(3)]; }));
      const phaseStats = Object.fromEntries(['left', 'right'].map(name => { const xs = phaseDurations[name].sort((a, b) => a - b); return [name, { count: xs.length, median: xs.length ? +xs[Math.floor((xs.length - 1) * 0.5)].toFixed(3) : null, p95: xs.length ? +xs[Math.ceil(xs.length * 0.95) - 1].toFixed(3) : null, max: xs.length ? +xs.at(-1).toFixed(3) : null }]; }));
      reports.push({ speed, clip: animation.clips.map(c => `${c.key}:${c.weight.toFixed(2)}`).join('+'), cycleStride: +stride.toFixed(3), rawContactShare, contactSeconds: { left: +(contactFrames.left * dt).toFixed(2), right: +(contactFrames.right * dt).toFixed(2) }, unreachable: { left: u.planted.left.unreachable || 0, right: u.planted.right.unreachable || 0 }, phaseSeconds: phaseStats });
    }
    const ordered = slips.map(x => x.value).sort((a, b) => a - b), p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
    const bySpeed = Object.fromEntries(reports.map(r => { const xs = slips.filter(x => x.speed === r.speed).map(x => x.value).sort((a, b) => a - b); return [r.speed, { samples: xs.length, p95: xs.length ? +xs[Math.ceil(xs.length * 0.95) - 1].toFixed(3) : null, max: xs.length ? +xs.at(-1).toFixed(3) : null }]; }));
    console.log('World planted-foot slip:', JSON.stringify({ gaitContact: reports, measuredFrames: slips.length,
      median: +ordered[Math.floor((ordered.length - 1) * 0.5)].toFixed(3), p95: +p95.toFixed(3), max: +ordered.at(-1).toFixed(3), bySpeed }));
    expect(slips.length).toBeGreaterThan(100);
    for (const stats of Object.values(bySpeed)) { expect(stats.samples).toBeGreaterThan(10); expect(stats.p95).toBeLessThan(0.15); }
    expect(p95).toBeLessThan(0.15);
  });
  it('between touches the ball rolls and only slows down (friction on the grass); a touch speeds it up again', () => {
    const rows = run({ path: straight(4.5), secs: 6 }), s = rows.filter(r => r.t > 0.6);
    let rises = 0, n = 0;
    for (let i = 2; i < s.length; i++) {
      if (s[i].touch !== s[i - 1].touch || s[i - 1].touch !== s[i - 2].touch) continue;   // a touch in between
      n++; if (s[i].jump > s[i - 1].jump + 0.05) rises++;
    }
    expect(n).toBeGreaterThan(200);
    expect(rises / n).toBeLessThan(0.01);
  });

  it('close control alternates the feet; running with it he mostly uses his stronger foot', () => {
    const feet = mps => { const rows = run({ path: straight(mps), secs: 8 }); return rows.filter((r, i) => i > 0 && r.touch != null && r.touch !== rows[i - 1].touch && r.t > 0.6).map(r => r.foot); };
    const slow = feet(1.5), fast = feet(7);
    const alt = slow.slice(1).filter((f, i) => f !== slow[i]).length / (slow.length - 1);
    expect(alt).toBeGreaterThan(0.8);
    const main = Math.max(fast.filter(f => f === 1).length, fast.filter(f => f === -1).length) / fast.length;
    expect(main).toBeGreaterThan(0.7);
  });
});
