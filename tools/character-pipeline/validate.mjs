// Checks an optimised body against its Ara original, vertex by vertex, with CPU skinning in three.js:
//   1. rest pose: the rebound mesh sits where the original did (scaled to the Gaffer's hip height);
//   2. animated: the original on Ara's own skeleton with Ara's own clips, and the optimised body on the
//      Gaffer skeleton with the game's clips (footballer-anims.json, retargeted from the same Ara
//      clips). Each optimised vertex is compared with the original vertex it came from, relative to
//      the hips, at several moments of several clips.
//   Skin that optimise.mjs moved in under the kit on purpose, and the corners it added where it cut
//   the skin under the kit (both listed in its report, --moved), are hidden by the cloth: they are
//   matched by position and reported on their own, and every visible vertex is checked as before.
// Usage: node validate.mjs <original.glb> <optimised.glb> [--report out.json] [--moved optimise-report.json]
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readDoc } from './inspect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const THREE = require('three');
const GAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'models', 'footballer-anims.json'), 'utf8'));
const ARA = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'animations', 'source', 'ara3dgen', 'football-clips.json'), 'utf8'));
const [ORIG, OPT] = process.argv.slice(2);
const REPORT = (i => (i >= 0 ? process.argv[i + 1] : null))(process.argv.indexOf('--report'));
const MOVED_FILE = (i => (i >= 0 ? process.argv[i + 1] : null))(process.argv.indexOf('--moved'));
const OPT_REPORT = MOVED_FILE ? JSON.parse(fs.readFileSync(MOVED_FILE, 'utf8')) : {};
const COVERED = OPT_REPORT.covered || {};
const MOVED = COVERED.movedVertices || [], CUT = COVERED.cutVertices || [];
// Fingers are compared separately: the game holds each finger at one pose per clip, taken from the
// original Ara character's clip, so their small offset is a pose difference, not a skinning error.
const FINGER = /^(thumb|index|middle|ring|pinky)_/;
const CLIPS = [['shoot', [0.1, 0.3, 0.6]], ['receive', [0.2, 0.5]], ['headerJump', [0.48, 0.8]], ['gkDiveL', [0.3, 0.7, 1.2]], ['celJump', [0.6, 1.4, 2.2]], ['tackleA', [0.28]], ['throwIn', [0.4, 0.8]]];

// A skinned body read from a glTF document: joints with their rest transforms and hierarchy, inverse
// bind matrices, and every vertex (dequantised) with its joints and weights.
async function body(file) {
  const { doc } = await readDoc(file);
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const ibmA = skin.getInverseBindMatrices();
  const ibm = joints.map((_, i) => new THREE.Matrix4().fromArray(ibmA.getElement(i, new Array(16))));
  const parent = new Map(); for (const n of doc.getRoot().listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const verts = [];
  for (const p of doc.getRoot().listMeshes()[0].listPrimitives()) {
    const P = p.getAttribute('POSITION'), J = p.getAttribute('JOINTS_0'), Wt = p.getAttribute('WEIGHTS_0');
    for (let i = 0; i < P.getCount(); i++) verts.push({ p: P.getElement(i, [0, 0, 0]), j: J.getElement(i, [0, 0, 0, 0]), w: Wt.getElement(i, [0, 0, 0, 0]) });
  }
  return { joints, ibm, parent, verts, names: joints.map(j => j.getName()) };
}
// World matrices of the joints for local rotations (by name) and an optional root translation.
function worlds(B, rot, trans) {
  const W = new Map();
  const world = n => {
    if (W.has(n)) return W.get(n);
    const r = rot[n.getName()] || n.getRotation(), t = trans[n.getName()] || n.getTranslation();
    const L = new THREE.Matrix4().compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...n.getScale()));
    const par = B.parent.get(n);
    const M = par && par.listChildren ? world(par).clone().multiply(L) : L;
    W.set(n, M); return M;
  };
  return B.joints.map(world);
}
function skinAll(B, Wj) {
  const K = Wj.map((W, i) => W.clone().multiply(B.ibm[i]));
  const out = new Float32Array(B.verts.length * 3), v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  B.verts.forEach((x, i) => {
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) { const w = x.w[k]; if (!w) continue; tmp.set(...x.p).applyMatrix4(K[x.j[k]]); acc.addScaledVector(tmp, w); }
    const s = x.w[0] + x.w[1] + x.w[2] + x.w[3] || 1; acc.multiplyScalar(1 / s);
    out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
  });
  return out;
}
// Sampling: a game clip (three.js JSON) and an Ara source clip (frames at 30 fps).
function sampleGame(clip, t) {
  const rot = {}, trans = {};
  for (const tr of clip.tracks) {
    const [bone, prop] = tr.name.split('.'), size = prop === 'quaternion' ? 4 : 3, n = tr.times.length;
    let i = 0; while (i < n - 1 && tr.times[i + 1] <= t) i++;
    const j = Math.min(n - 1, i + 1), k = j === i ? 0 : Math.max(0, Math.min(1, (t - tr.times[i]) / (tr.times[j] - tr.times[i])));
    const a = tr.values.slice(i * size, i * size + size), b = tr.values.slice(j * size, j * size + size);
    if (size === 4) { const q = new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), k); rot[bone] = [q.x, q.y, q.z, q.w]; }
    else trans[bone] = a.map((x, c) => x + (b[c] - x) * k);
  }
  return { rot, trans };
}
function sampleAra(clip, t) {
  const f = Math.min(clip.frames - 1, Math.round(t * 30)), rot = {}, trans = {};
  for (const [bone, tr] of Object.entries(clip.tracks)) {
    if (tr.r) rot[bone] = tr.r.length === 4 ? tr.r : tr.r.slice(f * 4, f * 4 + 4);
    if (tr.t) trans[bone] = tr.t.slice(f * 3, f * 3 + 3);
  }
  return { rot, trans };
}

const O = await body(ORIG), N = await body(OPT);
// Rest pose of both, and the scale the pipeline used (from the hips).
const restO = skinAll(O, worlds(O, {}, {})), restN = skinAll(N, worlds(N, {}, {}));
const hipO = worlds(O, {}, {})[O.names.indexOf('Hips')], hipN = worlds(N, {}, {})[N.names.indexOf('pelvis')];
const pO = new THREE.Vector3().setFromMatrixPosition(hipO), pN = new THREE.Vector3().setFromMatrixPosition(hipN);
const scale = pN.y / pO.y;
// Each optimised vertex's origin: the nearest original vertex at rest (grid search).
const cell = 0.02, grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
for (let i = 0; i < O.verts.length; i++) { const k = key(restO[i * 3] * scale, restO[i * 3 + 1] * scale, restO[i * 3 + 2] * scale); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
// Listed skin (moved, or a new corner), by where it is stored: the listed positions times the exact
// scale the optimiser wrote the file with, found within 0.05 mm. Its old place, for finding its origin,
// uses this check's own scale (as the original's rest positions do).
const atScale = (OPT_REPORT.rebind && OPT_REPORT.rebind.scale) || scale;
const listed = [...MOVED.map(m => ({ at: [m[3], m[4], m[5]].map(v => v * atScale), was: [m[0], m[1], m[2]].map(v => v * scale), cut: false })),
  ...CUT.map(c => ({ at: c.map(v => v * atScale), was: c.map(v => v * scale), cut: true }))];
const LC = 0.001, lgrid = new Map(), lkey = (x, y, z) => `${Math.floor(x / LC)},${Math.floor(y / LC)},${Math.floor(z / LC)}`;
for (const e of listed) { const k = lkey(...e.at); (lgrid.get(k) || lgrid.set(k, []).get(k)).push(e); }
const listedAt = (x, y, z) => {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    for (const e of lgrid.get(`${Math.floor(x / LC) + dx},${Math.floor(y / LC) + dy},${Math.floor(z / LC) + dz}`) || []) if (!e.found && Math.hypot(e.at[0] - x, e.at[1] - y, e.at[2] - z) < 5e-5) { e.found = true; return e; }
  }
  return null;
};
const nearestOrig = (x, y, z) => {
  let best = -1, bd = 1e9;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const list = grid.get(`${Math.floor(x / cell) + dx},${Math.floor(y / cell) + dy},${Math.floor(z / cell) + dz}`); if (!list) continue;
    for (const o of list) { const d = (restO[o * 3] * scale - x) ** 2 + (restO[o * 3 + 1] * scale - y) ** 2 + (restO[o * 3 + 2] * scale - z) ** 2; if (d < bd) { bd = d; best = o; } }
  }
  return best;
};
const origin = new Int32Array(N.verts.length), hidden = new Uint8Array(N.verts.length);
let restMax = 0, restSum = 0, restN_ = 0, hiddenN = 0, hiddenMax = 0;
for (let i = 0; i < N.verts.length; i++) {
  const x = restN[i * 3], y = restN[i * 3 + 1], z = restN[i * 3 + 2];
  const e = listedAt(...N.verts[i].p);                              // listed skin is known by where it is stored
  if (e) hidden[i] = 1, hiddenN++;
  if (e && e.cut) { origin[i] = -1; continue; }                       // a new corner: no original vertex to compare with
  const o = e ? nearestOrig(...e.was) : nearestOrig(x, y, z);
  origin[i] = o; if (o < 0) continue;
  const d = Math.hypot(restO[o * 3] * scale - x, restO[o * 3 + 1] * scale - y, restO[o * 3 + 2] * scale - z);
  if (e) { hiddenMax = Math.max(hiddenMax, d); continue; }
  restMax = Math.max(restMax, d); restSum += d; restN_++;
}
const result = { scale: +scale.toFixed(4), vertices: { original: O.verts.length, optimised: N.verts.length }, rest: { meanMm: +(restSum / Math.max(1, restN_) * 1000).toFixed(3), maxMm: +(restMax * 1000).toFixed(3) },
  hiddenSkin: { moved: MOVED.length, newCorners: CUT.length, matched: hiddenN, movedMaxMm: +(hiddenMax * 1000).toFixed(1) }, clips: {} };
// Animated comparison, relative to the hips.
for (const [name, times] of CLIPS) {
  const g = GAME.clips[name], a = ARA.clips[name]; if (!g || !a) continue;
  let max = 0, sum = 0, n = 0; const errs = []; let fsum = 0, fn = 0, fmax = 0;
  for (const t of times) {
    const sg = sampleGame(g, t), sa = sampleAra(a, t);
    const WN = worlds(N, sg.rot, sg.trans), WO = worlds(O, sa.rot, sa.trans);
    const posN = skinAll(N, WN), posO = skinAll(O, WO);
    const hN = new THREE.Vector3().setFromMatrixPosition(WN[N.names.indexOf('pelvis')]), hO = new THREE.Vector3().setFromMatrixPosition(WO[O.names.indexOf('Hips')]);
    for (let i = 0; i < N.verts.length; i++) {
      const o = origin[i]; if (o < 0 || hidden[i]) continue;
      const d = Math.hypot(posN[i * 3] - hN.x - (posO[o * 3] - hO.x) * scale, posN[i * 3 + 1] - hN.y - (posO[o * 3 + 1] - hO.y) * scale, posN[i * 3 + 2] - hN.z - (posO[o * 3 + 2] - hO.z) * scale);
      { const x = N.verts[i]; let bj = 0; for (let k = 1; k < 4; k++) if (x.w[k] > x.w[bj]) bj = k; if (FINGER.test(N.names[x.j[bj]])) { fsum += d; fn++; fmax = Math.max(fmax, d); continue; } }
      max = Math.max(max, d); sum += d; n++; errs.push(d);
    }
  }
  errs.sort((x, y) => x - y);
  result.clips[name] = { meanMm: +(sum / n * 1000).toFixed(2), p95Mm: +(errs[Math.floor(errs.length * 0.95)] * 1000).toFixed(2), maxMm: +(max * 1000).toFixed(2), fingers: { meanMm: +(fsum / Math.max(1, fn) * 1000).toFixed(1), maxMm: +(fmax * 1000).toFixed(1) } };
}
// Listed but not found: how far the nearest vertex in the file is (a diagnosis for the report).
result.hiddenSkin.unmatched = listed.filter(e => !e.found).map(e => { let d = Infinity; for (let i = 0; i < N.verts.length; i++) d = Math.min(d, Math.hypot(restN[i * 3] - e.at[0], restN[i * 3 + 1] - e.at[1], restN[i * 3 + 2] - e.at[2])); return { cut: e.cut, at: e.at.map(v => +v.toFixed(4)), nearestMm: +(d * 1000).toFixed(3) }; });
const worstMean = Math.max(...Object.values(result.clips).map(c => c.meanMm)), worstP95 = Math.max(...Object.values(result.clips).map(c => c.p95Mm));
// At rest the mesh must sit where the original did: on average within 1 mm, and nowhere more than
// 6 mm (the socks are moved out by 4–5 mm on purpose so the leg does not poke through them).
// Every listed vertex must be found (else the list and the file disagree), and no skin moved more
// than 3 cm.
result.pass = result.rest.meanMm < 1 && result.rest.maxMm < 6 && worstMean < 5 && worstP95 < 15 && hiddenN === MOVED.length + CUT.length && hiddenMax < 0.03;
console.log(JSON.stringify(result, null, 1));
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(result, null, 1));
process.exit(result.pass ? 0 : 2);
