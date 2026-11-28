// The Gaffer — optimises an Ara 3D Gen footballer export for the game's close-up views.
//
//   node optimise.mjs <in.glb> <out.glb> [--report report.json] [--kit-ratio 0.5] [--boot-ratio 0.5] [--skin 1024]
//
// Steps (each one checked by validate.mjs before a body is used):
//   1. Drop the jersey-number geometry (every player has his own number) and anything not needed.
//   2. Give every part its own vertices, weld, and simplify the kit and the boots with meshoptimizer
//      (the skin, eyes, brows, lashes and the hair layer are left as they are: the face keeps its shape).
//   3. Rebind the mesh onto The Gaffer's footballer skeleton (Mesh2Motion joint names), posed at the
//      Ara body's own bind pose and scaled so the hips sit at the same height, so every game clip,
//      the body-shape bone scaling and the existing animation code drive it unchanged.
//   4. Four materials: skin (skin + eyes atlas), hair (scalp, brows and lashes atlas, made grey so
//      it can be tinted to the player's hair colour), kit (one white fabric texture, tiled; the part
//      is stored in COLOR_0 so the game paints shirt, collar, shorts and socks in club colours), boots.
//   5. Textures resized and written as WebP; normals, UVs, weights and colours quantised (positions
//      stay in metres: the game paints shirt patterns from them); unused data pruned.
import { Document } from '@gltf-transform/core';
import { compactPrimitive, weldPrimitive, simplifyPrimitive, joinPrimitives, prune, dedup, quantize } from '@gltf-transform/functions';
import { EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readDoc, stats } from './inspect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const THREE = require('three');
const RT = require('./scripts/anim/retarget.js');
const { readGLB } = require('./scripts/anim/glb.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [IN, OUT] = args;
const KIT_RATIO = +opt('kit-ratio', 0.5), BOOT_RATIO = +opt('boot-ratio', 0.45), SKIN_PX = +opt('skin', 1024);
// Athlete detail (athletes/build-athletes.mjs): how much of the head, the body's skin and the eyes is
// kept, and the simplifier's error allowed for each (a lighter match athlete allows more).
const HEAD_RATIO = +opt('head-ratio', 0.62), BODY_RATIO = +opt('body-ratio', 0.3), EYE_RATIO = +opt('eye-ratio', 0.42);
const HEAD_ERR = +opt('head-error', 0.0018), BODY_ERR = +opt('body-error', 0.006), PART_ERR = +opt('part-error', 0.004);
// MakeHuman's shoes come up over the ankle (24–26 cm) with a white ankle sock painted on their
// texture above about 10 cm. That part becomes sock (kit material, sock colour), so the club's socks
// run down into the boot. Heights in metres in Ara's own scale. --skin-under-sock 0.52 is the older,
// height-only removal of leg skin inside the sock; the cut under the whole kit (hideCoveredSkin)
// replaces it, so it is off unless asked for.
const SOCK_LINE = +opt('sock-line', 0.10), SKIN_UNDER_SOCK = +opt('skin-under-sock', 0);
const BOOT_CUT = +opt('boot-cut', 0);
// Skin under the kit (see hideCoveredSkin): cut away CUT inside the garments' open edges; the band
// left near the edges moved in until it sits PULL_MIN inside the cloth, rising to PULL_MAX at HEM.
// --cut 0 turns this off.
const CUT = +opt('cut', 0.012), HEM = +opt('hem', 0.03), PULL_MIN = +opt('pull-min', 0.004), PULL_MAX = +opt('pull-max', 0.015);
const REPORT = opt('report', null);
// --athlete: the base of the athletes (athletes/build-athletes.mjs). Medium detail, so the head is
// simplified gently and the body skin hard; every skin, eye, brow and lash vertex keeps the raw
// vertex it came from (_RAWA, _RAWB, _RAWT: a corner made by the cut under the kit lies between
// two), so morph targets can be computed after the optimisation; the skin is stylised; the mouth
// goes; quantising is left to the athlete build (after the morph targets are added).
const ATHLETE = args.includes('--athlete');
// --spine-rest (athlete builds): the pelvis, spine, neck and head keep the game skeleton's own rest
// orientation instead of being turned onto the body's bone directions. The mannequin's spine bones
// curve backwards inside its body; turning a straight torso's bones onto that curve made every clip
// tip the athletes' chest about 12 degrees back. Limbs are still turned (T-pose against A-pose arms).
const SPINE_REST = args.includes('--spine-rest');
// The legs and feet too: the athlete stands at his bind pose as the mannequin stands at rest, so the
// clips must turn his legs and feet exactly as they turn the mannequin's (turned onto the body's bone
// directions, his feet were pitched toes-up whenever the mannequin's were flat).
const SPINE = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'head_leaf', ...['thigh', 'calf', 'foot', 'ball', 'ball_leaf'].flatMap(b => [b + '_l', b + '_r'])]);
const PROVENANCE_PARTS = new Set(['Skin', 'Eyes', 'Eyebrows', 'Eyelashes', 'Skin details']);
const HEAD_JOINTS = /^(head|neck|neck1|headtop_end)$/i;

// Ara part → the Gaffer's group, and the kit region code kept in COLOR_0 (decoded in match3d.js).
const PARTS = {
  'Skin': { group: 'skin' }, 'Eyes': { group: 'skin' },
  'Skin details': { group: 'hair' }, 'Eyebrows': { group: 'hair' }, 'Eyelashes': { group: 'hair' }, 'Hair': { group: 'hair', simplify: 0.6 },
  'Shoes': { group: 'boots', simplify: BOOT_RATIO },
  'Football shirt': { group: 'kit', region: [1, 0, 0], simplify: KIT_RATIO },
  'Football shirt collar and cuffs': { group: 'kit', region: [1, 1, 0], simplify: KIT_RATIO },
  'Loose shorts fabric': { group: 'kit', region: [0, 1, 0], simplify: KIT_RATIO },
  'Loose shorts elastic waistband': { group: 'kit', region: [0, 1, 0], simplify: KIT_RATIO },
  'Loose shorts gathered stitching': { group: 'kit', region: [0, 0.5, 0], simplify: KIT_RATIO },
  'Loose shorts white drawstring': { group: 'kit', region: [1, 1, 1], simplify: 1 },
  'Sports socks': { group: 'kit', region: [0, 0, 1], simplify: KIT_RATIO, inflate: 0.004 },
  'Sports sock bands': { group: 'kit', region: [0, 0, 1], simplify: 1, inflate: 0.005 },   // most of the sock's length, not just a band: sock colour
  'Boot collar': { group: 'kit', region: [0, 0, 1] },
};
const DROP = new Set(['Jersey number', 'Jersey number outline', 'Teeth', 'Tongue', 'Mouth']);

const log = (...a) => console.log('[optimise]', ...a);

async function main() {
  const t0 = Date.now();
  const { io, doc } = await readDoc(IN);
  const root = doc.getRoot();
  const before = stats(doc, fs.statSync(IN).size);
  log('before', JSON.stringify(before));
  if (root.listAnimations().length) for (const a of root.listAnimations()) a.dispose();      // clips come from the game

  // 1–2. Parts: drop, compact, weld, simplify.
  const mesh = root.listMeshes()[0];
  const prims = mesh.listPrimitives().slice();
  if (ATHLETE) addProvenance(doc, prims);
  const covered = CUT > 0 ? hideCoveredSkin(prims) : null;
  const unknown = [];
  for (const p of prims) {
    const name = p.getMaterial() ? p.getMaterial().getName() : '';
    if (DROP.has(name)) { mesh.removePrimitive(p); p.dispose(); continue; }
    const part = PARTS[name];
    if (!part) { unknown.push(name); mesh.removePrimitive(p); p.dispose(); continue; }
    compactPrimitive(p);
    if (name === 'Skin' && SKIN_UNDER_SOCK > 0) {
      const P = p.getAttribute('POSITION'), I = p.getIndices(), ia = I.getArray(), keep = [], y = i => P.getElement(i, [0, 0, 0])[1];
      for (let t = 0; t < ia.length; t += 3) if (Math.max(y(ia[t]), y(ia[t + 1]), y(ia[t + 2])) >= SKIN_UNDER_SOCK) keep.push(ia[t], ia[t + 1], ia[t + 2]);
      log(`skin under the socks removed: ${ia.length / 3} → ${keep.length / 3} triangles`);
      I.setArray(new (ia.constructor)(keep)); compactPrimitive(p);
    }
    if (name === 'Shoes' && SOCK_LINE > 0) {
      // The boot's upper (above the sock line) becomes its own part, painted as sock.
      const P = p.getAttribute('POSITION'), ia = p.getIndices().getArray(), low = [], high = [], y = i => P.getElement(i, [0, 0, 0])[1];
      for (let t = 0; t < ia.length; t += 3) (Math.min(y(ia[t]), y(ia[t + 1]), y(ia[t + 2])) >= SOCK_LINE ? high : low).push(ia[t], ia[t + 1], ia[t + 2]);
      if (high.length) {
        const collar = p.clone(); collar.setIndices(p.getIndices().clone().setArray(new (ia.constructor)(high))); collar.setExtras({ part: 'Boot collar' });
        mesh.addPrimitive(collar); compactPrimitive(collar);
        p.getIndices().setArray(new (ia.constructor)(low)); compactPrimitive(p);
        log(`boot upper painted as sock: ${high.length / 3} of ${ia.length / 3} triangles`);
      }
    }
    if (name === 'Shoes' && BOOT_CUT > 0) {
      const P = p.getAttribute('POSITION'), I = p.getIndices(), ia = I.getArray(), keep = [], y = i => P.getElement(i, [0, 0, 0])[1];
      for (let t = 0; t < ia.length; t += 3) if (Math.min(y(ia[t]), y(ia[t + 1]), y(ia[t + 2])) < BOOT_CUT) keep.push(ia[t], ia[t + 1], ia[t + 2]);
      log(`boot cut below ${BOOT_CUT} m: ${ia.length / 3} → ${keep.length / 3} triangles`);
      I.setArray(new (ia.constructor)(keep)); compactPrimitive(p);
    }
    // Cloth that the leg's skin pokes through at low detail is moved out along its normals a little.
    if (part.inflate) {
      const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), pa = P.getArray().slice(), na = N.getArray();
      for (let i = 0; i < pa.length; i++) pa[i] += na[i] * part.inflate;
      P.setArray(pa);
    }
    if (ATHLETE && name === 'Skin') { await simplifySkinByRegion(doc, mesh, p); p.setExtras({ part: name }); continue; }
    if (ATHLETE && name === 'Eyes') { weldPrimitive(p, { tolerance: 0.0001 }); const n0 = p.getIndices().getCount() / 3; await simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: EYE_RATIO, error: Math.max(0.002, HEAD_ERR), lockBorder: true }); compactPrimitive(p); log(`simplified Eyes: ${n0} → ${p.getIndices().getCount() / 3} triangles`); p.setExtras({ part: name }); continue; }
    if (part.simplify && part.simplify < 1) {
      weldPrimitive(p, { tolerance: 0.0001 });
      const n0 = p.getIndices().getCount() / 3;
      await simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: part.simplify, error: PART_ERR, lockBorder: true });
      compactPrimitive(p);
      log(`simplified ${name}: ${n0} → ${p.getIndices().getCount() / 3} triangles`);
    }
    p.setExtras({ part: name });
  }
  if (unknown.length) log('left out (not in the part table):', unknown.join(', '));
  await MeshoptSimplifier.ready;

  // 3. Rebind onto the Gaffer skeleton.
  const rebind = await rebindToGaffer(doc, mesh);
  log(`rebound onto the Gaffer skeleton: ${rebind.joints} joints, scale ${rebind.scale.toFixed(4)}, hips ${rebind.hips.toFixed(3)} m`);

  // 4. Materials and atlases.
  await buildMaterials(doc, mesh);

  // 5. Join each group into one primitive, then tidy and quantise.
  joinGroups(doc, mesh);
  if (ATHLETE) await doc.transform(dedup(), prune({ keepAttributes: true }));
  else await doc.transform(dedup(), prune({ keepAttributes: true }), quantize({ pattern: /^(NORMAL|TEXCOORD|JOINTS|WEIGHTS|COLOR)/, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8, quantizeColor: 8, cleanup: true }));
  doc.createExtension(EXTTextureWebP).setRequired(true);
  if (!ATHLETE) doc.createExtension(KHRMeshQuantization).setRequired(true);   // 16-bit normals and UVs, 8-bit weights
  for (const t of root.listTextures()) {
    const img = await sharp(Buffer.from(t.getImage())).webp({ quality: t.getName().includes('normal') ? 90 : 86, alphaQuality: 90, effort: 6 }).toBuffer();
    t.setImage(new Uint8Array(img)).setMimeType('image/webp');
  }
  doc.getRoot().getAsset().generator = 'The Gaffer character pipeline (glTF Transform, meshoptimizer, sharp) from Ara 3D Gen';
  await io.write(OUT, doc);
  const after = stats(doc, fs.statSync(OUT).size);
  log('after', JSON.stringify(after), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ in: path.basename(IN), out: path.basename(OUT), before, after, rebind, covered, options: { KIT_RATIO, BOOT_RATIO, SKIN_PX, BOOT_CUT, CUT, HEM, PULL_MIN, PULL_MAX } }, null, 1));
}

// ── Skin under the kit ───────────────────────────────────────────────────────
// Ara leaves out most skin under its clothes, but at low detail the skin left around each garment's
// edge is coarse: a few big triangles that run from the visible arm or calf far in under the cloth.
// When the body moves, or simply where the cloth is tight, those flat triangles come through it: the
// upper arm through the sleeve when the arm is raised, the calf over the sock top. So, at the bind pose:
//   * "under the cloth": the nearest point on the garments' triangles (within 5 cm) is not on an open
//     edge of the cloth (so the forearm beyond the cuff, the calf above the sock and the neck above the
//     collar are not), the skin faces the same way as the cloth, and it is no more than 2 cm outside it
//     (so the other thigh, across the gap between the legs, is not taken for skin under the shorts);
//   * the skin is cut where it passes CUT inside a garment's open edges: triangles crossing that line
//     are split there (new corners with interpolated position, normal, UVs and joint weights) and the
//     part further under the cloth is removed. With no skin inside the sleeve, the arm cannot come
//     through it;
//   * the band of skin left under the cloth near its edges is moved in along the cloth's normal until
//     it sits PULL_MIN inside at the edge, rising to PULL_MAX at HEM from it. Skin already deep enough
//     stays where it is.
// Visible skin is never moved or cut. The open edges are the cloth's border edges once welded by
// position. Every moved vertex (before and after) and every new corner is listed, so validate.mjs can
// match them and report them on their own.
const COVERING = new Set(['Football shirt', 'Football shirt collar and cuffs', 'Loose shorts fabric', 'Loose shorts elastic waistband', 'Sports socks', 'Sports sock bands']);
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], lerp: (a, b, t) => a.map((x, k) => x + (b[k] - x) * t) };
// Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5), and the feature it
// lies on: 'in', an edge 'ab' | 'bc' | 'ca', or a corner 'a' | 'b' | 'c'.
function closestOnTriangle(p, a, b, c) {
  const { sub, add, mul, dot } = v3, ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return [a, 'a'];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return [b, 'b'];
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return [add(a, mul(ab, d1 / (d1 - d3))), 'ab'];
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return [c, 'c'];
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return [add(a, mul(ac, d2 / (d2 - d6))), 'ca'];
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return [add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))), 'bc'];
  const den = 1 / (va + vb + vc); return [add(add(a, mul(ab, vb * den)), mul(ac, vc * den)), 'in'];
}
function hideCoveredSkin(prims) {
  const { sub, mul, dot, cross, lerp } = v3;
  const nameOf = p => (p.getMaterial() ? p.getMaterial().getName() : '');
  const skin = prims.find(p => nameOf(p) === 'Skin');
  const cloth = prims.filter(p => COVERING.has(nameOf(p)));
  if (!skin || !cloth.length) return null;
  for (const p of [skin, ...cloth]) compactPrimitive(p);  // Ara's parts share one vertex buffer: each its own first
  // Cloth welded by position (0.05 mm), with averaged normals.
  const pos = [], nrm = [], ids = new Map(), tris = [], key = v => v.map(x => Math.round(x * 2e4)).join(',');
  for (const p of cloth) {
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), ia = p.getIndices().getArray(), local = new Int32Array(P.getCount());
    for (let i = 0; i < P.getCount(); i++) {
      const v = P.getElement(i, [0, 0, 0]), n = N.getElement(i, [0, 0, 0]), k = key(v);
      let id = ids.get(k);
      if (id == null) { id = pos.length; ids.set(k, id); pos.push(v); nrm.push([0, 0, 0]); }
      nrm[id][0] += n[0]; nrm[id][1] += n[1]; nrm[id][2] += n[2]; local[i] = id;
    }
    for (let t = 0; t < ia.length; t += 3) if (local[ia[t]] !== local[ia[t + 1]] && local[ia[t + 1]] !== local[ia[t + 2]] && local[ia[t]] !== local[ia[t + 2]]) tris.push([local[ia[t]], local[ia[t + 1]], local[ia[t + 2]]]);
  }
  const nV = pos.length;
  // Open edges: edges used by one triangle only. Each cloth vertex's distance to the nearest one.
  const ekey = (a, b) => (a < b ? a * nV + b : b * nV + a), edges = new Map();
  for (const [a, b, c] of tris) for (const k of [ekey(a, b), ekey(b, c), ekey(c, a)]) edges.set(k, (edges.get(k) || 0) + 1);
  const border = new Set(); for (const [k, c] of edges) if (c === 1) { border.add(Math.floor(k / nV)); border.add(k % nV); }
  const B = [...border], hemDist = new Float32Array(nV);
  for (let i = 0; i < nV; i++) { let d = Infinity; for (const j of B) { const q = dot(sub(pos[i], pos[j]), sub(pos[i], pos[j])); if (q < d) d = q; } hemDist[i] = Math.sqrt(d); }
  const onEdge = (t, feature) => {
    const [a, b, c] = tris[t], at = { a, b, c };
    if (feature.length === 1) return border.has(at[feature]);
    return edges.get(ekey(at[feature[0]], at[feature[1]])) === 1;
  };
  // Face normals, turned to agree with the cloth's vertex normals.
  const fn = tris.map(([a, b, c]) => { let n = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a])); const l = Math.hypot(...n) || 1; n = mul(n, 1 / l); const avg = [0, 1, 2].map(k => nrm[a][k] + nrm[b][k] + nrm[c][k]); return dot(n, avg) < 0 ? mul(n, -1) : n; });
  // Grid of cloth triangles (by bounding box) for nearest-point queries.
  const R = 0.05, CELL = 0.025, grid = new Map(), ck = (a, b, c) => `${a},${b},${c}`, fl = x => Math.floor(x / CELL);
  tris.forEach(([a, b, c], t) => {
    const lo = [0, 1, 2].map(k => fl(Math.min(pos[a][k], pos[b][k], pos[c][k]))), hi = [0, 1, 2].map(k => fl(Math.max(pos[a][k], pos[b][k], pos[c][k])));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = ck(x, y, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
  });
  let stamp = 0; const seen = new Int32Array(tris.length);
  // Where a point of skin (position v, normal sn) is: null when not under the cloth, else the cloth's
  // normal there, the signed distance (> 0 outside the cloth) and the distance from the cloth's edges.
  function under(v, sn) {
    const r = Math.ceil(R / CELL); stamp++;
    let best = -1, bd = R * R, bp = null, bf = null;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const list = grid.get(ck(fl(v[0]) + a, fl(v[1]) + b, fl(v[2]) + c)); if (!list) continue;
      for (const t of list) {
        if (seen[t] === stamp) continue; seen[t] = stamp;
        const [q, feature] = closestOnTriangle(v, pos[tris[t][0]], pos[tris[t][1]], pos[tris[t][2]]), w = sub(v, q), d = dot(w, w);
        if (d < bd) { bd = d; best = t; bp = q; bf = feature; }
      }
    }
    if (best < 0 || onEdge(best, bf)) return null;                                // no cloth near, or past its edge
    const ng = fn[best], s = dot(sub(v, bp), ng);
    if (dot(sn, ng) < 0.3 || s > 0.02) return null;                                // facing another way, or well outside
    return { ng, s, hem: Math.min(...tris[best].map(k => hemDist[k])) };
  }
  // Every skin attribute as plain elements, so cut corners can be appended.
  const sems = skin.listSemantics(), el = {}, n0 = skin.getAttribute('POSITION').getCount();
  for (const sem of sems) { const acc = skin.getAttribute(sem), es = acc.getElementSize(); el[sem] = []; for (let i = 0; i < n0; i++) el[sem].push(acc.getElement(i, new Array(es).fill(0))); }
  const sets = sems.filter(s => /^JOINTS_\d+$/.test(s)).map(j => [j, j.replace('JOINTS', 'WEIGHTS')]).filter(([, w]) => el[w]);
  const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l, ...a.slice(3)]; };
  const deepUnder = (v, sn) => { const u = under(v, sn); return !!u && u.hem >= CUT; };
  const covered = el.POSITION.map((v, i) => deepUnder(v, el.NORMAL[i]));
  // A corner on edge i→j (i visible, j covered) where the skin passes the cut line: found by bisection.
  const cutAt = new Map(), cutList = [];
  function corner(i, j) {
    const k = i < j ? `${i},${j}` : `${j},${i}`;
    if (cutAt.has(k)) return cutAt.get(k);
    let lo = 0, hi = 1;
    for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (deepUnder(lerp(el.POSITION[i], el.POSITION[j], m), unit(lerp(el.NORMAL[i], el.NORMAL[j], m)))) hi = m; else lo = m; }
    const t = (lo + hi) / 2, id = el.POSITION.length;
    for (const sem of sems) {
      if (/^(JOINTS|WEIGHTS)_/.test(sem)) continue;
      if (sem === '_RAWA') { el[sem].push([el._RAWA[i][0]]); continue; }
      if (sem === '_RAWB') { el[sem].push([el._RAWA[j][0]]); continue; }
      if (sem === '_RAWT') { el[sem].push([t]); continue; }
      const e = lerp(el[sem][i], el[sem][j], t);
      el[sem].push(sem === 'NORMAL' || sem === 'TANGENT' ? unit(e) : e);
    }
    // Joint weights: both corners' joints blended, the strongest kept, normalised.
    const w = new Map();
    for (const [idx, f] of [[i, 1 - t], [j, t]]) for (const [J, W] of sets) for (let q = 0; q < 4; q++) if (el[W][idx][q] > 0) w.set(el[J][idx][q], (w.get(el[J][idx][q]) || 0) + el[W][idx][q] * f);
    const top = [...w].sort((a, b) => b[1] - a[1]).slice(0, sets.length * 4), sum = top.reduce((a, x) => a + x[1], 0) || 1;
    sets.forEach(([J, W], s) => { const part = top.slice(s * 4, s * 4 + 4); while (part.length < 4) part.push([0, 0]); el[J].push(part.map(x => x[0])); el[W].push(part.map(x => x[1] / sum)); });
    cutAt.set(k, id); cutList.push(id);
    return id;
  }
  const I = skin.getIndices(), ia = I.getArray(), out = [];
  let dropped = 0, split = 0;
  for (let t = 0; t < ia.length; t += 3) {
    const tri = [ia[t], ia[t + 1], ia[t + 2]], c = tri.map(i => covered[i]), nc = c.filter(Boolean).length;
    if (nc === 0) { out.push(...tri); continue; }
    if (nc === 3) { dropped++; continue; }
    split++;
    // Turn the triangle (keeping its winding) so the corner on its own side comes first.
    const odd = nc === 1 ? c.indexOf(true) : c.indexOf(false), [a, b, d] = [tri[odd], tri[(odd + 1) % 3], tri[(odd + 2) % 3]];
    if (nc === 2) out.push(a, corner(a, b), corner(a, d));                                   // one visible corner
    else { const p = corner(b, a), q = corner(d, a); out.push(b, d, q, b, q, p); }           // two visible corners, a covered
  }
  // The band left under the cloth near its edges, and the new corners, moved in.
  const used = new Set(out), moved = [], cutDone = [];
  let band = 0, maxMove = 0;
  for (const i of used) {
    const v = el.POSITION[i], u = under(v, el.NORMAL[i]);
    if (!u) { if (i >= n0) cutDone.push(i); continue; }
    band++;
    const depth = PULL_MIN + (PULL_MAX - PULL_MIN) * Math.min(1, u.hem / HEM);
    if (u.s > -depth) {
      const m = u.s + depth, before = v.slice();
      el.POSITION[i] = [v[0] - u.ng[0] * m, v[1] - u.ng[1] * m, v[2] - u.ng[2] * m];
      if (i < n0) moved.push([...before.map(x => +x.toFixed(6)), ...el.POSITION[i].map(x => Math.fround(x))]);
      maxMove = Math.max(maxMove, m);
    }
    if (i >= n0) cutDone.push(i);
  }
  // Write the attributes back (old vertices, then the new corners) and the new triangles.
  for (const sem of sems) {
    const acc = skin.getAttribute(sem), arr = el[sem];
    acc.setArray(new (acc.getArray().constructor)(arr.length * acc.getElementSize()));
    arr.forEach((e, i) => acc.setElement(i, e));
  }
  I.setArray(new Uint32Array(out));
  const cut = cutDone.map(i => el.POSITION[i].map(x => Math.fround(x)));
  const res = { skinTriangles: ia.length / 3, removed: dropped, split, newCorners: cut.length, nearEdges: band, moved: moved.length, maxMoveMm: +(maxMove * 1000).toFixed(1), clothEdgeVertices: B.length, movedVertices: moved, cutVertices: cut };
  log(`skin under the kit: ${dropped} triangles removed and ${split} cut along the line ${CUT * 100} cm inside the kit's edges (${cut.length} new corners); ${moved.length} vertices near the edges moved in (at most ${res.maxMoveMm} mm)`);
  return res;
}

// ── Rebinding ────────────────────────────────────────────────────────────────
// Every Gaffer joint takes the world position of its Ara counterpart at Ara's bind pose (scaled) and
// the Gaffer rest orientation turned onto the Ara bone's direction (as scripts/anim/retarget.js
// does). Vertices keep their bind-pose positions, joint indices are remapped, and new inverse bind
// matrices are written, so the mesh is unchanged at rest and follows the Gaffer skeleton in motion.
async function rebindToGaffer(doc, mesh, { spineRest = SPINE_REST } = {}) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const araJoints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const araWorld = new Map();
  araJoints.forEach((j, i) => { const m = new THREE.Matrix4().fromArray(ibm, i * 16).invert(); const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); araWorld.set(j.getName(), { p, q, i }); });

  const gaf = RT.restFromGLB((await readGLB(path.join(ROOT, 'assets', 'animations', 'source', 'mesh2motion', 'model.glb'))).json);
  const order = []; { const seen = new Set(); const visit = n => { if (seen.has(n)) return; if (gaf[n].parent) visit(gaf[n].parent); seen.add(n); order.push(n); }; Object.keys(gaf).forEach(visit); }
  const T0W = {}, T0P = {};
  for (const n of order) {
    const b = gaf[n], q = new THREE.Quaternion().fromArray(b.r), t = new THREE.Vector3().fromArray(b.t);
    if (b.parent) { T0W[n] = T0W[b.parent].clone().multiply(q); T0P[n] = t.applyQuaternion(T0W[b.parent]).add(T0P[b.parent]); } else { T0W[n] = q; T0P[n] = t; }
  }
  const toAra = {}; for (const [a, g] of Object.entries(RT.MIXAMO_TO_M2M)) toAra[g] = a;
  const hipsAra = araWorld.get('Hips'); if (!hipsAra) throw new Error('no Hips joint');
  const scale = T0P.pelvis.y / hipsAra.p.y;

  // World transform of every Gaffer joint at the Ara bind pose.
  const W = {};
  for (const n of order) {
    const a = toAra[n] && araWorld.get(toAra[n]);
    if (!a) { const par = gaf[n].parent; W[n] = par ? { p: W[par].p.clone().add(new THREE.Vector3().fromArray(gaf[n].t).applyQuaternion(W[par].q)), q: W[par].q.clone().multiply(new THREE.Quaternion().fromArray(gaf[n].r)) } : { p: T0P[n].clone(), q: T0W[n].clone() }; continue; }
    if (spineRest && SPINE.has(n)) { W[n] = { p: a.p.clone().multiplyScalar(scale), q: T0W[n].clone(), A: new THREE.Quaternion() }; continue; }
    const nx = RT.NEXT[n], an = nx && toAra[nx] && araWorld.get(toAra[nx]);
    const A = new THREE.Quaternion();
    if (an) { const dt = T0P[nx].clone().sub(T0P[n]).normalize(), ds = an.p.clone().sub(a.p).normalize(); if (dt.lengthSq() > 0 && ds.lengthSq() > 0) A.setFromUnitVectors(dt, ds); }
    else if (gaf[n].parent && W[gaf[n].parent] && W[gaf[n].parent].A) A.copy(W[gaf[n].parent].A);
    W[n] = { p: a.p.clone().multiplyScalar(scale), q: A.clone().multiply(T0W[n]), A };
  }
  // New joint nodes, parent-first.
  const nodes = {};
  for (const n of order) {
    const par = gaf[n].parent, w = W[n];
    let lq = w.q.clone(), lt = w.p.clone();
    if (par) { const pq = W[par].q.clone().invert(); lq = pq.clone().multiply(w.q); lt = w.p.clone().sub(W[par].p).applyQuaternion(pq); }
    nodes[n] = doc.createNode(n).setTranslation(lt.toArray()).setRotation(lq.normalize().toArray());
    if (par) nodes[par].addChild(nodes[n]);
  }
  const armature = doc.createNode('Armature').addChild(nodes[order[0]]);
  root.listScenes()[0].addChild(armature);
  // Joint remap and inverse bind matrices.
  const newOrder = order.slice();
  const index = Object.fromEntries(newOrder.map((n, i) => [n, i]));
  const remap = araJoints.map(j => { const g = RT.MIXAMO_TO_M2M[j.getName()]; if (g != null && index[g] != null) return index[g]; if (j.getName() === 'WeaponR') return index.hand_r; return index.head; });
  const ibmOut = new Float32Array(newOrder.length * 16);
  newOrder.forEach((n, i) => new THREE.Matrix4().compose(W[n].p, W[n].q, new THREE.Vector3(1, 1, 1)).invert().toArray(ibmOut, i * 16));
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'), jt = p.getAttribute('JOINTS_0');
    const pa = pos.getArray().slice(); for (let i = 0; i < pa.length; i++) pa[i] *= scale; pos.setArray(pa);
    const ja = jt.getArray(); const out = new (ja.constructor)(ja.length); for (let i = 0; i < ja.length; i++) out[i] = remap[ja[i]]; jt.setArray(out);
  }
  const buf = root.listBuffers()[0];
  const ibmAcc = doc.createAccessor('inverseBindMatrices').setType('MAT4').setArray(ibmOut).setBuffer(buf);
  for (const j of araJoints) skin.removeJoint(j);
  for (const n of newOrder) skin.addJoint(nodes[n]);
  skin.setInverseBindMatrices(ibmAcc).setSkeleton(nodes[order[0]]);
  // The old Ara skeleton goes.
  for (const c of root.listScenes()[0].listChildren()) if (c !== armature && !c.getMesh()) { c.traverse(x => { if (x !== c) x.dispose(); }); c.dispose(); }
  return { joints: newOrder.length, scale, hips: T0P.pelvis.y, araHips: hipsAra.p.y };
}

// ── Materials and atlases ───────────────────────────────────────────────────
async function imageOf(tex) { return sharp(Buffer.from(tex.getImage())); }
async function buildMaterials(doc, mesh) {
  const byPart = {};
  for (const p of mesh.listPrimitives()) byPart[p.getExtras().part] = p;   // includes 'Boot collar'
  const tex = name => byPart[name] && byPart[name].getMaterial().getBaseColorTexture();
  const mats = {};
  // Skin atlas: skin on top (SKIN_PX square), eyes in a strip below.
  {
    const S = SKIN_PX, E = Math.round(S / 4), H = S + E;
    // Ara's skin tint is a material colour (linear); it is baked into the texture (sRGB) so the body
    // carries its own tone and the game's per-player tint starts from it.
    const f = byPart['Skin'].getMaterial().getBaseColorFactor().slice(0, 3).map(v => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));
    let skinPipe = (await imageOf(tex('Skin'))).resize(S, S);
    if (f.some(v => v < 0.999)) skinPipe = skinPipe.removeAlpha().linear(f, [0, 0, 0]);
    const skinImg = ATHLETE ? await stylisedSkin(await skinPipe.png().toBuffer(), S) : await skinPipe.toBuffer();
    const eyeImg = tex('Eyes') ? await (await imageOf(tex('Eyes'))).resize(E, E).toBuffer() : null;
    const atlas = await sharp({ create: { width: S, height: H, channels: 3, background: '#000' } }).composite([{ input: skinImg, left: 0, top: 0 }, ...(eyeImg ? [{ input: eyeImg, left: 0, top: S }] : [])]).png().toBuffer();
    remapUV(byPart['Skin'], 0, 0, 1, S / H);
    if (byPart['Eyes']) remapUV(byPart['Eyes'], 0, S / H, E / S, E / H);
    mats.skin = doc.createMaterial('skin').setBaseColorTexture(doc.createTexture('skin').setImage(new Uint8Array(atlas)).setMimeType('image/png')).setRoughnessFactor(0.62).setMetallicFactor(0);
  }
  // Hair atlas: the hair layer (scalp, stubble), then brows and lashes; grey so it can be tinted.
  {
    const D = 512, B = 256, H = D + B, WID = tex('Hair') ? 2 * D : D;
    const grey = async (t, w, h) => { const im = (await imageOf(t)).resize(w, h).ensureAlpha(); const { data, info } = await im.raw().toBuffer({ resolveWithObject: true }); let mx = 1; for (let i = 0; i < data.length; i += 4) { const l = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; if (data[i + 3] > 20) mx = Math.max(mx, l); } if (ATHLETE) { const lum = []; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) lum.push(0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]); lum.sort((a, b) => a - b); mx = Math.max(8, lum.length ? lum[lum.length >> 1] : 128) / 190 * 255; } for (let i = 0; i < data.length; i += 4) { const l = Math.min(255, Math.round((0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / mx * 255)); data[i] = data[i + 1] = data[i + 2] = l; } return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(); };
    const comp = [];
    const fx = D / WID;   // atlas width in cells of D
    if (tex('Skin details')) { comp.push({ input: await grey(tex('Skin details'), D, D), left: 0, top: 0 }); remapUV(byPart['Skin details'], 0, 0, fx, D / H); }
    if (tex('Eyebrows')) { comp.push({ input: await grey(tex('Eyebrows'), B, B), left: 0, top: D }); remapUV(byPart['Eyebrows'], 0, D / H, B / WID, B / H); }
    if (tex('Eyelashes')) { comp.push({ input: await grey(tex('Eyelashes'), B, B), left: B, top: D }); remapUV(byPart['Eyelashes'], B / WID, D / H, B / WID, B / H); }
    if (tex('Hair')) { comp.push({ input: await grey(tex('Hair'), D, D), left: D, top: 0 }); remapUV(byPart['Hair'], fx, 0, fx, D / H); }
    const atlas = await sharp({ create: { width: WID, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).png().toBuffer();
    mats.hair = doc.createMaterial('hair').setBaseColorTexture(doc.createTexture('hair').setImage(new Uint8Array(atlas)).setMimeType('image/png')).setAlphaMode('BLEND').setRoughnessFactor(0.8).setMetallicFactor(0).setDoubleSided(true);
  }
  // Kit: one white fabric texture and its normal map, tiled as before; the part in COLOR_0.
  {
    const shirt = byPart['Football shirt'] && byPart['Football shirt'].getMaterial();
    const fab = shirt && shirt.getBaseColorTexture(), nrm = shirt && shirt.getNormalTexture();
    const m = doc.createMaterial('kit').setRoughnessFactor(0.85).setMetallicFactor(0);
    if (fab) { const g = await (await imageOf(fab)).resize(256, 256).grayscale().png().toBuffer(); m.setBaseColorTexture(doc.createTexture('kit').setImage(new Uint8Array(g)).setMimeType('image/png')); }
    if (nrm) { const g = await (await imageOf(nrm)).resize(256, 256).png().toBuffer(); m.setNormalTexture(doc.createTexture('kit-normal').setImage(new Uint8Array(g)).setMimeType('image/png')).setNormalScale(0.6); }
    mats.kit = m;
    for (const [name, part] of Object.entries(PARTS)) {
      const p = byPart[name]; if (!p || part.group !== 'kit') continue;
      const n = p.getAttribute('POSITION').getCount(), c = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) c.set([...part.region, 1], i * 4);
      p.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(c).setBuffer(doc.getRoot().listBuffers()[0]));
    }
  }
  // Boots.
  {
    const b = tex('Shoes');
    const m = doc.createMaterial('boots').setRoughnessFactor(0.5).setMetallicFactor(0);
    if (b) m.setBaseColorTexture(doc.createTexture('boots').setImage(new Uint8Array(await (await imageOf(b)).resize(512, 512).png().toBuffer())).setMimeType('image/png'));
    mats.boots = m;
  }
  for (const [name, part] of Object.entries(PARTS)) { const p = byPart[name]; if (p) p.setMaterial(mats[part.group]); }
  // Primitives without COLOR_0 cannot join those with it; kit parts all have it.
}

// uv' = offset + uv * scale (for an atlas cell). Every part has its own accessor after compactPrimitive.
function remapUV(p, ox, oy, sx, sy) {
  if (!p) return;
  const uv = p.getAttribute('TEXCOORD_0'), a = uv.getArray().slice();
  for (let i = 0; i < a.length; i += 2) { a[i] = ox + a[i] * sx; a[i + 1] = oy + a[i + 1] * sy; }
  uv.setArray(a);
}

function joinGroups(doc, mesh) {
  const groups = {};
  for (const p of mesh.listPrimitives()) { const k = p.getMaterial().getName(); (groups[k] = groups[k] || []).push(p); }
  for (const [k, list] of Object.entries(groups)) {
    if (list.length < 2) continue;
    const joined = joinPrimitives(list);
    joined.setMaterial(list[0].getMaterial());
    for (const p of list) { mesh.removePrimitive(p); p.dispose(); }
    mesh.addPrimitive(joined);
  }
}

// ── Athlete mode ──────────────────────────────────────────────────────────────
// Provenance: which raw vertex each vertex came from. Ara's parts share one vertex buffer, so one
// accessor per shared buffer gives every part its raw indices; compaction carries them along.
function addProvenance(doc, prims) {
  const made = new Map(), buf = doc.getRoot().listBuffers()[0];
  for (const p of prims) {
    const name = p.getMaterial() ? p.getMaterial().getName() : '';
    if (!PROVENANCE_PARTS.has(name)) continue;
    const P = p.getAttribute('POSITION');
    if (!made.has(P)) {
      const n = P.getCount(), a = new Float32Array(n), t = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = i;
      made.set(P, [doc.createAccessor('_RAWA').setType('SCALAR').setArray(a).setBuffer(buf), doc.createAccessor('_RAWB').setType('SCALAR').setArray(a.slice()).setBuffer(buf), doc.createAccessor('_RAWT').setType('SCALAR').setArray(t).setBuffer(buf)]);
    }
    const [A, B, T] = made.get(P);
    p.setAttribute('_RAWA', A).setAttribute('_RAWB', B).setAttribute('_RAWT', T);
  }
}
// The skin at medium detail: the head (skin weighted to the head and neck) keeps its shape with a
// gentle simplification; the body's skin (mostly hidden by the kit, and cut away beneath it) is
// simplified hard. The two pieces are simplified with their borders locked and joined again.
async function simplifySkinByRegion(doc, mesh, p) {
  const skin = doc.getRoot().listSkins()[0], names = skin.listJoints().map(j => j.getName());
  const J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'), n = J.getCount(), headW = new Float32Array(n), j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { J.getElement(i, j4); W.getElement(i, w4); for (let k = 0; k < 4; k++) if (HEAD_JOINTS.test(names[j4[k]] || '')) headW[i] += w4[k]; }
  const ia = p.getIndices().getArray(), head = [], body = [];
  for (let t = 0; t < ia.length; t += 3) ((headW[ia[t]] + headW[ia[t + 1]] + headW[ia[t + 2]]) / 3 >= 0.5 ? head : body).push(ia[t], ia[t + 1], ia[t + 2]);
  const n0 = ia.length / 3, pieces = [];
  for (const [list, ratio, error] of [[head, HEAD_RATIO, HEAD_ERR], [body, BODY_RATIO, BODY_ERR]]) {
    if (!list.length) continue;
    const q = p.clone(); q.setIndices(p.getIndices().clone().setArray(new Uint32Array(list))); compactPrimitive(q);
    weldPrimitive(q, { tolerance: 0.0001 });
    await simplifyPrimitive(q, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: true });
    compactPrimitive(q); pieces.push(q);
  }
  const joined = joinPrimitives(pieces);
  for (const q of pieces) q.dispose();
  for (const sem of p.listSemantics()) p.setAttribute(sem, joined.getAttribute(sem));
  p.setIndices(joined.getIndices()); joined.dispose();
  weldPrimitive(p, { tolerance: 0.0001 });
  log(`simplified the skin: ${n0} → ${p.getIndices().getCount() / 3} triangles (head ${head.length / 3} kept finer, body ${body.length / 3} simplified hard)`);
}
// A stylised skin: photographic detail (pores, blotches, hair) is smoothed away and colour
// variation is evened out, keeping the soft shape of the features (lips, lids, cheeks). The game
// tints it to each player's own tone.
async function stylisedSkin(png, S) {
  const soft = await sharp(png).resize(S, S).median(5).blur(3.2).toBuffer();
  const { data, info } = await sharp(soft).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 3) { const l = (data[i] + data[i + 1] + data[i + 2]) / 3; if (l > 30 && l < 235) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; } }
  r /= n; g /= n; b /= n;
  const out = Buffer.alloc(data.length);
  // One base serves every skin tone (the game multiplies the texture by each player's tone over this
  // one), so the texture is moved to a light neutral tone: a multiply can darken it to any tone but
  // could not lighten a dark texture.
  const REF = [214, 176, 152], f = [REF[0] / r, REF[1] / g, REF[2] / b];
  for (let i = 0; i < data.length; i += 3) {
    // Pull every pixel two thirds of the way to the average tone, keeping its brightness shape.
    const lum = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / (r * 0.3 + g * 0.59 + b * 0.11);
    const k = Math.max(0.55, Math.min(1.3, lum));
    out[i] = Math.min(255, Math.round((data[i] * 0.34 + r * k * 0.66) * f[0]));
    out[i + 1] = Math.min(255, Math.round((data[i + 1] * 0.34 + g * k * 0.66) * f[1]));
    out[i + 2] = Math.min(255, Math.round((data[i + 2] * 0.34 + b * k * 0.66) * f[2]));
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

export { hideCoveredSkin, rebindToGaffer, buildMaterials, joinGroups, PARTS, DROP };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
