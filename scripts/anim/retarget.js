// scripts/anim/retarget.js — puts clips made for another humanoid skeleton onto the Gaffer's
// footballer skeleton (Mesh2Motion: root, pelvis, spine_01…, thigh_l, calf_l, foot_l, ball_l …).
//
// Method (world-space rotation transfer with rest-pose alignment):
//   * Both skeletons are posed at rest and each mapped bone's direction (joint → its next joint)
//     is measured in world space. A[b] turns the target bone onto the source bone's rest direction,
//     so a T-pose target follows an A-pose source correctly.
//   * Every frame, each source bone's world rotation relative to its rest, D = S(t)·S0⁻¹, is
//     applied to the aligned target bone: T(t) = D·A·T0. Local rotations follow from the parents.
//   * The hips' movement is scaled by the ratio of the two leg lengths.
// Bones without a counterpart keep their rest pose. The result is three.js AnimationClip JSON.
// checkClip() replays a result on the target skeleton and measures how far each limb's direction is
// from the source's: scripts and tests use it to prove the transfer before a clip is shipped.
const THREE = require('three');

// Source (Mixamo-style names, as Ara 3D Gen's game rig) → target (Mesh2Motion / UE-style).
const MIXAMO_TO_M2M = {
  Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'head', HeadTop_End: 'head_leaf',
};
for (const [S, s] of [['Left', 'l'], ['Right', 'r']]) {
  Object.assign(MIXAMO_TO_M2M, {
    [`${S}Shoulder`]: `clavicle_${s}`, [`${S}Arm`]: `upperarm_${s}`, [`${S}ForeArm`]: `lowerarm_${s}`, [`${S}Hand`]: `hand_${s}`,
    [`${S}UpLeg`]: `thigh_${s}`, [`${S}Leg`]: `calf_${s}`, [`${S}Foot`]: `foot_${s}`, [`${S}ToeBase`]: `ball_${s}`, [`${S}Toe_End`]: `ball_leaf_${s}`,
  });
  for (const [F, f] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Pinky', 'pinky']]) {
    for (let k = 1; k <= 3; k++) MIXAMO_TO_M2M[`${S}Hand${F}${k}`] = `${f}_0${k}_${s}`;
    MIXAMO_TO_M2M[`${S}Hand${F}4`] = `${f}_04_leaf_${s}`;
  }
}
// The next joint along each target bone (its direction). Leaves have none.
const NEXT = { pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head', head: 'head_leaf' };
for (const s of ['l', 'r']) {
  Object.assign(NEXT, { [`clavicle_${s}`]: `upperarm_${s}`, [`upperarm_${s}`]: `lowerarm_${s}`, [`lowerarm_${s}`]: `hand_${s}`, [`hand_${s}`]: `middle_01_${s}`,
    [`thigh_${s}`]: `calf_${s}`, [`calf_${s}`]: `foot_${s}`, [`foot_${s}`]: `ball_${s}`, [`ball_${s}`]: `ball_leaf_${s}` });
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) { NEXT[`${f}_01_${s}`] = `${f}_02_${s}`; NEXT[`${f}_02_${s}`] = `${f}_03_${s}`; NEXT[`${f}_03_${s}`] = `${f}_04_leaf_${s}`; }
}
// Limbs measured by checkClip (bone → next joint).
const CHECK = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'spine_01', 'spine_03', 'neck_01'];

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const Q = (a, i = 0) => new THREE.Quaternion(a[i], a[i + 1], a[i + 2], a[i + 3]);

// rest: { name: { parent, t:[x,y,z], r:[x,y,z,w] } } → names in parent-first order
function order(rest) {
  const out = [], seen = new Set();
  const visit = n => { if (seen.has(n)) return; const p = rest[n].parent; if (p && rest[p]) visit(p); seen.add(n); out.push(n); };
  Object.keys(rest).forEach(visit);
  return out;
}
// World rotation and position of every joint for given local rotations/translations.
function pose(rest, names, rotOf, posOf) {
  const W = {}, P = {};
  for (const n of names) {
    const b = rest[n], q = rotOf(n), t = posOf(n);
    if (b.parent && W[b.parent]) { W[n] = W[b.parent].clone().multiply(q); P[n] = t.clone().applyQuaternion(W[b.parent]).add(P[b.parent]); }
    else { W[n] = q.clone(); P[n] = t.clone(); }
  }
  return { W, P };
}

// src: { rest, clip: { duration, frames, tracks: { bone: { r: [...], t?: [...] } } } } (scripts/anim/extract-ara.js)
// tgt: { rest } of the target skeleton. Returns { name, duration, tracks, loop } (three.js JSON).
// Fingers and leaf joints (no children, no skin) hardly move: they keep one pose, from mid-clip.
const HOLD = /^(thumb|index|middle|ring|pinky)_|_leaf/;
function retargetClip(srcRest, clip, tgtRest, { name, fps = 30, map = MIXAMO_TO_M2M, hips = ['Hips', 'pelvis'], hold = HOLD } = {}) {
  const sNames = order(srcRest), tNames = order(tgtRest);
  const inv = {}; for (const [s, t] of Object.entries(map)) if (srcRest[s] && tgtRest[t]) inv[t] = s;
  const s0 = pose(srcRest, sNames, n => Q(srcRest[n].r), n => V(srcRest[n].t));
  const t0 = pose(tgtRest, tNames, n => Q(tgtRest[n].r), n => V(tgtRest[n].t));
  // Rest alignment per mapped target bone.
  const A = {};
  for (const tb of tNames) {
    const sb = inv[tb], tn = NEXT[tb], sn = tn && inv[tn];
    A[tb] = new THREE.Quaternion();
    if (!sb || !tn || !sn || !t0.P[tn] || !s0.P[sn]) continue;
    const dt = t0.P[tn].clone().sub(t0.P[tb]), ds = s0.P[sn].clone().sub(s0.P[sb]);
    if (dt.lengthSq() < 1e-10 || ds.lengthSq() < 1e-10) continue;
    A[tb].setFromUnitVectors(dt.normalize(), ds.normalize());
  }
  const [sh, th] = hips;
  const legS = s0.P[sh].y, legT = t0.P[th].y, k = legT / legS;   // hip heights above the floor
  const frames = clip.frames, rot = {}, pelvisPos = [];
  for (const tb of tNames) rot[tb] = [];
  for (let f = 0; f < frames; f++) {
    const sp = pose(srcRest, sNames,
      n => { const tr = clip.tracks[n]; if (!tr || !tr.r) return Q(srcRest[n].r); return tr.r.length === 4 ? Q(tr.r) : Q(tr.r, f * 4); },
      n => { const tr = clip.tracks[n]; return tr && tr.t ? V(tr.t.slice(f * 3, f * 3 + 3)) : V(srcRest[n].t); });
    const TW = {};
    for (const tb of tNames) {
      const sb = inv[tb], par = tgtRest[tb].parent;
      if (sb && sp.W[sb]) TW[tb] = sp.W[sb].clone().multiply(s0.W[sb].clone().invert()).multiply(A[tb]).multiply(t0.W[tb]);
      else TW[tb] = par && TW[par] ? TW[par].clone().multiply(Q(tgtRest[tb].r)) : Q(tgtRest[tb].r);
      const local = par && TW[par] ? TW[par].clone().invert().multiply(TW[tb]) : TW[tb].clone();
      // keep the sign continuous so interpolation takes the short way
      const prev = rot[tb].length ? rot[tb].slice(-4) : null;
      if (prev && prev[0] * local.x + prev[1] * local.y + prev[2] * local.z + prev[3] * local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      rot[tb].push(local.x, local.y, local.z, local.w);
    }
    // The hips: the source's movement from rest, scaled, in the pelvis's parent space.
    const d = sp.P[sh].clone().sub(s0.P[sh]).multiplyScalar(k);
    const world = t0.P[th].clone().add(d);
    const par = tgtRest[th].parent;
    const parentW = par ? (TW[par] || t0.W[par]) : new THREE.Quaternion(), parentP = par ? t0.P[par] : new THREE.Vector3();
    const local = world.sub(parentP).applyQuaternion(parentW.clone().invert());
    pelvisPos.push(local.x, local.y, local.z);
  }
  const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const times = Array.from({ length: frames }, (_, f) => r(Math.min(clip.duration, f / fps), 4));
  const tracks = [];
  for (const tb of tNames) {
    const v = rot[tb];
    let still = true;
    for (let i = 4; i < v.length && still; i++) if (Math.abs(v[i] - v[i % 4]) > 5e-4) still = false;
    const mid = Math.floor(frames / 2) * 4;
    const one = hold && hold.test(tb) ? v.slice(mid, mid + 4) : still ? v.slice(0, 4) : null;
    tracks.push({ name: `${tb}.quaternion`, type: 'quaternion', times: one ? [0] : times, values: (one || v).map(x => r(x, 3)) });
  }
  tracks.push({ name: `${th}.position`, type: 'vector', times, values: pelvisPos.map(x => r(x, 4)) });
  return { name, duration: r(clip.duration, 4), tracks, loop: !!clip.loop };
}

// Replays `json` (three.js clip JSON) on a skeleton built from tgtRest and compares each checked
// limb's world direction with the source clip's at every frame. Returns the worst angle (degrees)
// per limb and overall, and where the feet and hands are at the contact moment.
function checkClip(srcRest, clip, tgtRest, json, { map = MIXAMO_TO_M2M, fps = 30 } = {}) {
  const bones = {};
  for (const n of order(tgtRest)) {
    const b = new THREE.Bone(); b.name = n;
    b.position.copy(V(tgtRest[n].t)); b.quaternion.copy(Q(tgtRest[n].r));
    bones[n] = b;
    if (tgtRest[n].parent && bones[tgtRest[n].parent]) bones[tgtRest[n].parent].add(b);
  }
  const rootName = order(tgtRest).find(n => !tgtRest[n].parent);
  const root = new THREE.Group(); root.add(bones[rootName]);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(THREE.AnimationClip.parse(json));
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;   // the last frame is the last frame, not the first again
  action.play();
  const inv = {}; for (const [s, t] of Object.entries(map)) inv[t] = s;
  const sNames = order(srcRest);
  let worst = 0; const per = {};
  const wp = (b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  for (let f = 0; f < clip.frames; f++) {
    const t = Math.min(clip.duration, f / fps);
    mixer.setTime(t); root.updateMatrixWorld(true);
    const sp = pose(srcRest, sNames,
      n => { const tr = clip.tracks[n]; if (!tr || !tr.r) return Q(srcRest[n].r); return tr.r.length === 4 ? Q(tr.r) : Q(tr.r, f * 4); },
      n => { const tr = clip.tracks[n]; return tr && tr.t ? V(tr.t.slice(f * 3, f * 3 + 3)) : V(srcRest[n].t); });
    for (const tb of CHECK) {
      const tn = NEXT[tb], sb = inv[tb], sn = inv[tn];
      if (!bones[tb] || !bones[tn] || !sp.P[sb] || !sp.P[sn]) continue;
      const a = wp(bones[tn]).sub(wp(bones[tb])).normalize(), b = sp.P[sn].clone().sub(sp.P[sb]).normalize();
      const deg = THREE.MathUtils.radToDeg(a.angleTo(b));
      per[tb] = Math.max(per[tb] || 0, deg); worst = Math.max(worst, deg);
    }
  }
  return { worst: Math.round(worst * 100) / 100, per };
}

// Rest pose of a GLB skeleton read with scripts/anim/glb.js: { name: { parent, t, r } }.
function restFromGLB(json) {
  const nodes = json.nodes, parent = new Map();
  nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
  const joints = new Set((json.skins || []).flatMap(s => s.joints));
  const rest = {};
  for (const i of joints) {
    const n = nodes[i], p = parent.get(i);
    rest[n.name] = { parent: p != null && joints.has(p) ? nodes[p].name : null, t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1] };
  }
  return rest;
}

module.exports = { retargetClip, checkClip, restFromGLB, MIXAMO_TO_M2M, NEXT, CHECK };
