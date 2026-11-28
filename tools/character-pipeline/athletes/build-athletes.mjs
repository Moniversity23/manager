// Builds The Gaffer's athletes: one base footballer with morph targets for faces, heritage, build
// and age; beard and goalkeeper-glove shells; and one small file per hairstyle. Every player's
// look (src/look.js, the Player Studio) picks the targets' weights, the hairstyle, the beard and the
// colours, so a whole league is drawn from these few files with a distinct face for everyone.
//   node athletes/build-athletes.mjs            (after: node athletes/variants.mjs)
// Steps:
//   1. optimise.mjs --athlete on the base export (medium detail, provenance kept);
//   2. beard shells (where each of Ara's beard styles grows, made as a thin textured layer over the
//      face) and goalkeeper gloves (a padded layer over the hands), as extra parts of the base;
//   3. morph targets: (variant − base) for each export of variants.mjs, mapped to every optimised
//      vertex through its provenance (kit and boots: their nearest raw vertex); heritage and age only
//      reshape the head, build only the body;
//   4. hairstyles: each style's hair rebound onto the game skeleton, made grey (tinted in the game)
//      and given the same targets (copied from the scalp under it), one file per style;
//   5. quantised, textures in WebP, written to public/models/athletes with an index.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { compactPrimitive, weldPrimitive, simplifyPrimitive, dedup, prune, quantize } from '@gltf-transform/functions';
import { EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readDoc, stats } from '../inspect.mjs';
import { rebindToGaffer } from '../optimise.mjs';
import { FACE, HERITAGE, BODY, HAIR, BEARDS, RAW, ROOT, rawFile } from './variants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(ROOT, 'package.json'));
const THREE = require('three');
const OUT = path.join(ROOT, 'public', 'models', 'athletes');
const WORK = path.join(RAW, 'work');
// --lod match: the athlete for the pitch, where 22 are drawn at once and a head is a few dozen pixels
// tall: the head, skin, kit, boots and hair simplified much further, a 512 px skin. The full athlete
// (no option) is for close-ups (Player Studio, award ceremonies). Both share the same targets.
const LOD = process.argv.includes('--lod') ? process.argv[process.argv.indexOf('--lod') + 1] : 'full';
if (!['full', 'match'].includes(LOD)) throw new Error('--lod full|match');
const SUFFIX = LOD === 'match' ? '-match' : '';
const OPT_ARGS = LOD === 'match'
  ? ['--kit-ratio', '0.2', '--boot-ratio', '0.25', '--head-ratio', '0.34', '--body-ratio', '0.14', '--eye-ratio', '0.3', '--head-error', '0.004', '--body-error', '0.015', '--part-error', '0.008', '--skin', '512']
  : ['--kit-ratio', '0.4'];
const HAIR_LOD = LOD === 'match' ? 0.42 : 1;            // share of each hairstyle's triangles kept
const REPORT = path.join(ROOT, 'assets', 'characters', `athletes-report${SUFFIX}.json`);
const log = (...a) => console.log('[athletes]', ...a);
const HEAD_ARA = /^(head|neck|neck1|headtop_end)$/i;
const HAND_GAF = /^(hand|thumb|index|middle|ring|pinky)_/;
const KIT_PARTS = new Set(['Football shirt', 'Football shirt collar and cuffs', 'Loose shorts fabric', 'Loose shorts elastic waistband', 'Loose shorts gathered stitching', 'Loose shorts white drawstring', 'Sports socks', 'Sports sock bands', 'Shoes']);
const HAIR_PARTS = new Set(['Hair', 'Hair spikes', 'Braids']);
const PROVENANCE_RAW = new Set(['Skin', 'Eyes', 'Eyebrows', 'Eyelashes', 'Skin details']);
// Targets that reshape the whole head or body keep their normal changes (for the shading); the small
// features (nose, mouth, eyes, ears, brows) do without.
const BROAD = new Set(['headSquare', 'headRound', 'headVJaw', 'headWide', 'headNarrow', 'jawStrong', 'afr', 'asi', 'cau', 'muscular', 'lean', 'heavy', 'slim', 'older', 'younger']);
// Heavy hairstyles are simplified (Ara's cornrows are 28,000 triangles of braids).
const HAIR_RATIO = { cornrows: 0.16, ponytail01: 0.6, braid01: 0.6, long01: 0.7 };

fs.mkdirSync(WORK, { recursive: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const report = { built: new Date().toISOString(), base: null, targets: [], hair: {}, shells: {} };

// ── Raw exports ──────────────────────────────────────────────────────────────
// Ara's parts share one vertex buffer: positions, normals and the part each vertex belongs to.
async function rawOf(file) {
  const { doc } = await readDoc(file);
  const prims = doc.getRoot().listMeshes()[0].listPrimitives();
  const P = prims[0].getAttribute('POSITION'), N = prims[0].getAttribute('NORMAL');
  const part = new Array(P.getCount()).fill('');
  for (const p of prims) { const nm = p.getMaterial() ? p.getMaterial().getName() : ''; if (p.getAttribute('POSITION') !== P) continue; const ia = p.getIndices().getArray(); for (let i = 0; i < ia.length; i++) part[ia[i]] = part[ia[i]] || nm; }
  const UV = prims[0].getAttribute('TEXCOORD_0');
  return { doc, prims, pos: P.getArray(), nrm: N.getArray(), uv: UV ? UV.getArray() : null, count: P.getCount(), part };
}

// ── 1. The base ──────────────────────────────────────────────────────────────
const baseOpt = path.join(WORK, `base-opt${SUFFIX}.glb`), baseRep = path.join(WORK, `base-opt${SUFFIX}.json`);
execFileSync(process.execPath, [path.join(HERE, '..', 'optimise.mjs'), rawFile('base'), baseOpt, '--report', baseRep, '--athlete', ...OPT_ARGS], { stdio: 'inherit' });
const optRep = JSON.parse(fs.readFileSync(baseRep, 'utf8')), SCALE = optRep.rebind.scale;
const { io, doc } = await readDoc(baseOpt);
const root = doc.getRoot(), mesh = root.listMeshes()[0], buf = root.listBuffers()[0];
const byMat = Object.fromEntries(mesh.listPrimitives().map(p => [p.getMaterial().getName(), p]));
const rawBase = await rawOf(rawFile('base'));
log(`base: ${rawBase.count} raw vertices, scale ${SCALE.toFixed(4)}`);

// Head weight of each raw vertex (Ara skeleton), for masking targets.
const rawHead = new Float32Array(rawBase.count);
{
  const names = rawBase.doc.getRoot().listSkins()[0].listJoints().map(j => j.getName());
  const J = rawBase.prims[0].getAttribute('JOINTS_0'), W = rawBase.prims[0].getAttribute('WEIGHTS_0'), j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  for (let i = 0; i < rawBase.count; i++) { J.getElement(i, j4); W.getElement(i, w4); for (let k = 0; k < 4; k++) if (HEAD_ARA.test(names[j4[k]] || '')) rawHead[i] += w4[k]; }
}

// ── 2. Shells: beards and goalkeeper gloves ──────────────────────────────────
// A shell copies a region of the optimised skin (keeping provenance, skinning and UVs), moved out
// along the normals; it is its own primitive with its own material, shown per player.
function shellFrom(skin, keepTri, offsetOf, name, material) {
  const P = skin.getAttribute('POSITION'), N = skin.getAttribute('NORMAL'), ia = skin.getIndices().getArray(), sems = skin.listSemantics();
  const map = new Map(), tris = [];
  for (let t = 0; t < ia.length; t += 3) if (keepTri(ia[t], ia[t + 1], ia[t + 2])) for (const k of [ia[t], ia[t + 1], ia[t + 2]]) { if (!map.has(k)) map.set(k, map.size); tris.push(map.get(k)); }
  if (!tris.length) return null;
  const src = [...map.keys()], prim = doc.createPrimitive().setMaterial(material);
  for (const sem of sems) {
    const a = skin.getAttribute(sem), es = a.getElementSize(), arr = new (a.getArray().constructor)(src.length * es), e = new Array(es).fill(0);
    src.forEach((k, i) => { a.getElement(k, e); if (sem === 'POSITION') { const n = N.getElement(k, [0, 0, 0]), o = offsetOf(k); e[0] += n[0] * o; e[1] += n[1] * o; e[2] += n[2] * o; } for (let c = 0; c < es; c++) arr[i * es + c] = e[c]; });
    prim.setAttribute(sem, doc.createAccessor(`${name}-${sem}`).setType(a.getType()).setArray(arr).setBuffer(buf).setNormalized(a.getNormalized()));
  }
  prim.setIndices(doc.createAccessor(`${name}-idx`).setType('SCALAR').setArray(new Uint32Array(tris)).setBuffer(buf));
  prim.setExtras({ part: name });
  mesh.addPrimitive(prim);
  return prim;
}
// Beard texture: a soft layer of colour (base alpha) with strands over it; tinted in the game.
async function strandTexture(density, seed, base = 0, maxLen = 10) {
  const S = 256, data = Buffer.alloc(S * S * 4);
  let r = seed; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < S * S; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 200; data[i * 4 + 3] = base; }
  const strands = Math.round(S * S * density / 30);
  for (let s = 0; s < strands; s++) {
    let x = rnd() * S, y = rnd() * S; const a = Math.PI / 2 + (rnd() - 0.5) * 0.9, len = 2 + rnd() * maxLen, g = 150 + rnd() * 105;
    for (let k = 0; k < len; k++) { const xi = ((Math.round(x) % S) + S) % S, yi = ((Math.round(y) % S) + S) % S, o = (yi * S + xi) * 4; data[o] = data[o + 1] = data[o + 2] = g; data[o + 3] = Math.min(255, data[o + 3] + 150); x += Math.cos(a); y += Math.sin(a); }
  }
  return sharp(data, { raw: { width: S, height: S, channels: 4 } }).blur(0.5).png().toBuffer();
}
const skin = byMat.skin;
let beardTex = null;
// A beard fades towards its edges: each vertex's alpha (COLOR_0) grows with its distance over the
// shell from the shell's border, to 1 at `radius`. Vertices are joined by position first (the skin
// is split along its texture seams, which are not edges of the beard).
function fadeEdges(prim, radius) {
  const P = prim.getAttribute('POSITION'), n = P.getCount(), ia = prim.getIndices().getArray(), e = [0, 0, 0];
  const pos = new Float32Array(n * 3), canon = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++) { P.getElement(i, e); pos.set(e, i * 3); const k = e.map(v => Math.round(v * 1e5)).join(','); if (!seen.has(k)) seen.set(k, i); canon[i] = seen.get(k); }
  const uses = new Map(), adj = new Map(), key = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  for (let t = 0; t < ia.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = canon[ia[t + j]], b = canon[ia[t + (j + 1) % 3]]; if (a === b) continue;
    const k = key(a, b); uses.set(k, (uses.get(k) || 0) + 1);
    (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); (adj.get(b) || adj.set(b, new Set()).get(b)).add(a);
  }
  const dist = new Float32Array(n).fill(Infinity), queue = [];
  for (const [k, u] of uses) if (u === 1) for (const v of k.split(',').map(Number)) if (dist[v] !== 0) { dist[v] = 0; queue.push(v); }
  // Dijkstra over the edges (a simple sorted queue: shells are small).
  while (queue.length) {
    let bi = 0; for (let q = 1; q < queue.length; q++) if (dist[queue[q]] < dist[queue[bi]]) bi = q;
    const v = queue[bi]; queue[bi] = queue[queue.length - 1]; queue.pop();
    for (const w of adj.get(v) || []) { const d = dist[v] + Math.hypot(pos[v * 3] - pos[w * 3], pos[v * 3 + 1] - pos[w * 3 + 1], pos[v * 3 + 2] - pos[w * 3 + 2]); if (d < dist[w]) { if (dist[w] === Infinity) queue.push(w); dist[w] = d; } }
  }
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const t = Math.min(1, (Number.isFinite(dist[canon[i]]) ? dist[canon[i]] : radius) / radius); c.set([1, 1, 1, t * t * (3 - 2 * t)], i * 4); }
  prim.setAttribute('COLOR_0', doc.createAccessor(`${prim.getExtras().part}-fade`).setType('VEC4').setArray(c).setBuffer(buf));
}
const skinRawA = skin.getAttribute('_RAWA');
// Goalkeeper gloves: the hands and fingers, padded (6 mm, a little more on the palm side).
{
  const names = root.listSkins()[0].listJoints().map(j => j.getName());
  const J = skin.getAttribute('JOINTS_0'), W = skin.getAttribute('WEIGHTS_0'), n = J.getCount(), hw = new Float32Array(n), j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { J.getElement(i, j4); W.getElement(i, w4); for (let k = 0; k < 4; k++) if (HAND_GAF.test(names[j4[k]] || '')) hw[i] += w4[k]; }
  const mat = doc.createMaterial('gloves').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  const g = shellFrom(skin, (a, b, c) => hw[a] > 0.5 && hw[b] > 0.5 && hw[c] > 0.5, () => 0.0065 * SCALE, 'gloves', mat);
  report.shells.gloves = g ? g.getIndices().getCount() / 3 : 0;
}
// Beards: where Ara grows each style (its beard cards' roots on the skin), with a thickness from
// the cards' length there; a stubble layer from the short beard's area, almost flat.
{
  const P = skin.getAttribute('POSITION'), n = P.getCount();
  for (const [id] of BEARDS) {
    if (id === 'b_stubble') continue;
    const v = await rawOf(rawFile(id));
    const beard = v.prims.find(p => p.getMaterial() && p.getMaterial().getName() === 'Beard');
    if (!beard) { log(`${id}: no beard part`); continue; }
    const bP = beard.getAttribute('POSITION').getArray(), bi = beard.getIndices().getArray(), used = new Set(bi);
    const C = 0.01, grid = new Map(), key = (x, y, z) => `${Math.floor(x / C)},${Math.floor(y / C)},${Math.floor(z / C)}`;
    for (const k of used) { const g = key(bP[k * 3], bP[k * 3 + 1], bP[k * 3 + 2]); (grid.get(g) || grid.set(g, []).get(g)).push(k); }
    // For each skin vertex: nearest card vertex (is it in the beard?) and the cards' reach out of the skin nearby.
    const inside = new Uint8Array(n), thick = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ra = skinRawA.getScalar(i), x = rawBase.pos[ra * 3], y = rawBase.pos[ra * 3 + 1], z = rawBase.pos[ra * 3 + 2], nx = rawBase.nrm[ra * 3], ny = rawBase.nrm[ra * 3 + 1], nz = rawBase.nrm[ra * 3 + 2];
      let near = 1, reach = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) for (const k of grid.get(`${Math.floor(x / C) + a},${Math.floor(y / C) + b},${Math.floor(z / C) + c}`) || []) {
        const dx = bP[k * 3] - x, dy = bP[k * 3 + 1] - y, dz = bP[k * 3 + 2] - z, d = Math.hypot(dx, dy, dz);
        if (d < near) near = d;
        if (d < 0.02) reach = Math.max(reach, dx * nx + dy * ny + dz * nz);
      }
      if (near < 0.008 && rawHead[ra] > 0.3) { inside[i] = 1; thick[i] = Math.max(0.0015, Math.min(0.014, reach * 0.55)); }
    }
    const style = id.slice(2), tex = beardTex || (beardTex = await strandTexture(1.6, 11, 150, 8));
    const mat = doc.createMaterial(`beard-${style}`).setBaseColorTexture(doc.createTexture(`beard-${style}`).setImage(new Uint8Array(tex)).setMimeType('image/png')).setAlphaMode('BLEND').setRoughnessFactor(0.9).setMetallicFactor(0);
    const sh = shellFrom(skin, (a, b, c) => inside[a] && inside[b] && inside[c], k => thick[k] * SCALE, `beard-${style}`, mat);
    if (sh) fadeEdges(sh, style === 'mustache' || style === 'goatee' ? 0.004 : 0.008);
    report.shells[`beard-${style}`] = sh ? sh.getIndices().getCount() / 3 : 0;
    if (style === 'short') {
      const tx = await strandTexture(0.9, 3, 95, 3);
      const sm = doc.createMaterial('beard-stubble').setBaseColorTexture(doc.createTexture('beard-stubble').setImage(new Uint8Array(tx)).setMimeType('image/png')).setAlphaMode('BLEND').setRoughnessFactor(0.9).setMetallicFactor(0);
      const st = shellFrom(skin, (a, b, c) => inside[a] && inside[b] && inside[c], () => 0.0007 * SCALE, 'beard-stubble', sm);
      if (st) fadeEdges(st, 0.01);
      report.shells['beard-stubble'] = st ? st.getIndices().getCount() / 3 : 0;
    }
    log(`beard ${style}: ${report.shells[`beard-${style}`]} triangles`);
  }
  // Beard UVs: the skin's UVs tiled, so the strands are fine. Shells keep TEXCOORD_0 from the skin.
  for (const p of mesh.listPrimitives()) {
    const nm = p.getMaterial().getName(); if (!nm.startsWith('beard-')) continue;
    const uv = p.getAttribute('TEXCOORD_0'), a = uv.getArray().slice(); for (let i = 0; i < a.length; i++) a[i] *= 9; uv.setArray(a);
  }
}

// ── 3. Morph targets ─────────────────────────────────────────────────────────
// Raw kit and boot vertices on a grid (scaled), for the kit and boots' nearest-vertex mapping.
const kitGrid = new Map(), KC = 0.02, kkey = (x, y, z) => `${Math.floor(x / KC)},${Math.floor(y / KC)},${Math.floor(z / KC)}`;
for (let i = 0; i < rawBase.count; i++) if (KIT_PARTS.has(rawBase.part[i])) { const g = kkey(rawBase.pos[i * 3] * SCALE, rawBase.pos[i * 3 + 1] * SCALE, rawBase.pos[i * 3 + 2] * SCALE); (kitGrid.get(g) || kitGrid.set(g, []).get(g)).push(i); }
const nearestKit = (x, y, z) => { let best = -1, bd = 0.02 * 0.02; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const k of kitGrid.get(`${Math.floor(x / KC) + a},${Math.floor(y / KC) + b},${Math.floor(z / KC) + c}`) || []) { const d = (rawBase.pos[k * 3] * SCALE - x) ** 2 + (rawBase.pos[k * 3 + 1] * SCALE - y) ** 2 + (rawBase.pos[k * 3 + 2] * SCALE - z) ** 2; if (d < bd) { bd = d; best = k; } } return best; };
// Each optimised vertex: the raw vertices it comes from, [a, b, t].
const prov = new Map();
for (const p of mesh.listPrimitives()) {
  const P = p.getAttribute('POSITION'), n = P.getCount(), A = p.getAttribute('_RAWA'), B = p.getAttribute('_RAWB'), T = p.getAttribute('_RAWT'), out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (A) out[i] = [A.getScalar(i), B.getScalar(i), T.getScalar(i)];
    else { const e = P.getElement(i, [0, 0, 0]), k = nearestKit(e[0], e[1], e[2]); out[i] = k >= 0 ? [k, k, 0] : null; }
  }
  prov.set(p, out);
}
const TARGETS = [...FACE.map(([id]) => [id, 'face']), ...HERITAGE.map(([id]) => [id, 'head']), ...BODY.map(([id]) => [id, id === 'older' || id === 'younger' ? 'head' : 'body'])];
const deltasFor = new Map();       // target id → { dP, dN } on raw vertices (masked)
const targetScale = {};            // target id → metres per unit of its stored (−1..1) deltas
for (const [id, region] of TARGETS) {
  const v = await rawOf(rawFile(id));
  // Which variant vertex each base vertex is: the same index when the exports match, otherwise part
  // by part (Ara rebuilds its garments on a changed body, so a garment can differ in size; a part
  // that differs gets no deltas).
  const corr = new Int32Array(rawBase.count).fill(-1), skippedParts = [];
  if (v.count === rawBase.count) for (let i = 0; i < rawBase.count; i++) corr[i] = i;
  else {
    const listOf = r => { const m = new Map(); for (let i = 0; i < r.count; i++) { const k = r.part[i]; if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(i); } return m; };
    const a = listOf(rawBase), b = listOf(v);
    // MakeHuman's skin and face parts: Ara deletes the skin under the clothes, and how much depends on
    // the body, so they are matched by their texture coordinates (unique per MakeHuman vertex).
    const uvKey = (r, i) => `${Math.round(r.uv[i * 2] * 1e5)},${Math.round(r.uv[i * 2 + 1] * 1e5)}`;
    for (const [k, list] of a) {
      const o = b.get(k);
      if (o && o.length === list.length) { list.forEach((x, i) => { corr[x] = o[i]; }); continue; }
      if (o && PROVENANCE_RAW.has(k) && rawBase.uv && v.uv) {
        const at = new Map(); for (const j of o) at.set(uvKey(v, j), j);
        let hit = 0; for (const x of list) { const j = at.get(uvKey(rawBase, x)); if (j != null) { corr[x] = j; hit++; } }
        if (hit < list.length * 0.9) skippedParts.push(`${k} (${hit}/${list.length} matched)`);
        continue;
      }
      skippedParts.push(k);
    }
  }
  // A garment matched by index must really be the same mesh: Ara can rebuild a garment with the
  // same number of vertices in another order. If its typical movement is implausible for a change
  // of build (over 2 cm), each vertex takes the nearest vertex of the same garment instead.
  const over = new Map();             // raw vertex → its position in the variant, when not a variant vertex
  if (v.count !== rawBase.count && region === 'body') {
    const byPart = new Map(); for (let i = 0; i < rawBase.count; i++) { const k = rawBase.part[i]; if (KIT_PARTS.has(k)) (byPart.get(k) || byPart.set(k, []).get(k)).push(i); }
    for (const [k, list] of byPart) {
      if (list.every(i => corr[i] >= 0)) {
        const d = list.map(i => { const j = corr[i]; return Math.hypot(v.pos[j * 3] - rawBase.pos[i * 3], v.pos[j * 3 + 1] - rawBase.pos[i * 3 + 1], v.pos[j * 3 + 2] - rawBase.pos[i * 3 + 2]); }).sort((a, b) => a - b);
        if (d[Math.floor(d.length / 2)] <= 0.02 && d[Math.floor(d.length * 0.99)] <= 0.06) continue;   // the same mesh: index correspondence
      }
      const G = 0.03, grid = new Map(), key = (x, y, z) => `${Math.floor(x / G)},${Math.floor(y / G)},${Math.floor(z / G)}`;
      for (let j = 0; j < v.count; j++) if (v.part[j] === k) { const g = key(v.pos[j * 3], v.pos[j * 3 + 1], v.pos[j * 3 + 2]); (grid.get(g) || grid.set(g, []).get(g)).push(j); }
      // Normal offset to the nearest variant vertex, then smoothed over the garment's own edges.
      const off = new Map();
      for (const i of list) {
        const x = rawBase.pos[i * 3], y = rawBase.pos[i * 3 + 1], z = rawBase.pos[i * 3 + 2]; let best = -1, bd = 0.05 * 0.05;
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) for (const j of grid.get(`${Math.floor(x / G) + a},${Math.floor(y / G) + b},${Math.floor(z / G) + c}`) || []) { const dd = (v.pos[j * 3] - x) ** 2 + (v.pos[j * 3 + 1] - y) ** 2 + (v.pos[j * 3 + 2] - z) ** 2; if (dd < bd) { bd = dd; best = j; } }
        if (best < 0) { off.set(i, 0); continue; }
        off.set(i, (v.pos[best * 3] - x) * rawBase.nrm[i * 3] + (v.pos[best * 3 + 1] - y) * rawBase.nrm[i * 3 + 1] + (v.pos[best * 3 + 2] - z) * rawBase.nrm[i * 3 + 2]);
      }
      const nb = new Map(); for (const i of list) nb.set(i, new Set());
      for (const q of rawBase.prims) { if (!q.getMaterial() || q.getMaterial().getName() !== k) continue; const ia = q.getIndices().getArray(); for (let t = 0; t < ia.length; t += 3) for (let e = 0; e < 3; e++) { const a = ia[t + e], b = ia[t + (e + 1) % 3]; if (nb.has(a) && nb.has(b)) { nb.get(a).add(b); nb.get(b).add(a); } } }
      for (let it = 0; it < 4; it++) { const next = new Map(); for (const i of list) { let sum = 0, n = 0; for (const j of nb.get(i)) { sum += off.get(j); n++; } next.set(i, n ? off.get(i) * 0.4 + sum / n * 0.6 : off.get(i)); } for (const [i, o] of next) off.set(i, o); }
      let mx = 0; for (const i of list) { const o = off.get(i); mx = Math.max(mx, Math.abs(o)); over.set(i, [0, 1, 2].map(c => rawBase.pos[i * 3 + c] + rawBase.nrm[i * 3 + c] * o)); }
      log(`${id}: ${k} follows the body along its normals (up to ${(mx * 1000).toFixed(0)} mm)`);
    }
  }
  // Heritage and age change the height too: the head's own movement and size are removed, so only
  // its shape changes (the face of the heritage or age on this body).
  const sim = { s: 1, cv: [0, 0, 0], cb: [0, 0, 0] };
  if (region === 'head') {
    let n = 0; const cb = [0, 0, 0], cv = [0, 0, 0];
    for (let i = 0; i < rawBase.count; i++) if (rawHead[i] > 0.9 && rawBase.part[i] === 'Skin' && corr[i] >= 0) { n++; for (let c = 0; c < 3; c++) { cb[c] += rawBase.pos[i * 3 + c]; cv[c] += v.pos[corr[i] * 3 + c]; } }
    for (let c = 0; c < 3; c++) { cb[c] /= n; cv[c] /= n; }
    let rb = 0, rv = 0;
    for (let i = 0; i < rawBase.count; i++) if (rawHead[i] > 0.9 && rawBase.part[i] === 'Skin' && corr[i] >= 0) { const j = corr[i]; rb += Math.hypot(rawBase.pos[i * 3] - cb[0], rawBase.pos[i * 3 + 1] - cb[1], rawBase.pos[i * 3 + 2] - cb[2]); rv += Math.hypot(v.pos[j * 3] - cv[0], v.pos[j * 3 + 1] - cv[1], v.pos[j * 3 + 2] - cv[2]); }
    Object.assign(sim, { s: rb / rv, cv, cb });
    log(`${id}: head moved ${cv.map((x, c) => ((x - cb[c]) * 1000).toFixed(0)).join(',')} mm and scaled ${(rv / rb).toFixed(3)} (removed)`);
  }
  const vAt = (j, c) => (v.pos[j * 3 + c] - sim.cv[c]) * sim.s + sim.cb[c];
  const dP = new Float32Array(rawBase.count * 3), dN = new Float32Array(rawBase.count * 3);
  let moved = 0;
  for (let i = 0; i < rawBase.count; i++) {
    const j = corr[i], o = over.get(i); if (j < 0 && !o) continue;
    const h = Math.min(1, rawHead[i] * 1.6), w = region === 'head' ? h : region === 'body' ? 1 - h : 1;
    for (let c = 0; c < 3; c++) { dP[i * 3 + c] = ((o ? o[c] : vAt(j, c)) - rawBase.pos[i * 3 + c]) * SCALE * w; dN[i * 3 + c] = o ? 0 : (v.nrm[j * 3 + c] - rawBase.nrm[i * 3 + c]) * w; }
    if (Math.abs(dP[i * 3]) + Math.abs(dP[i * 3 + 1]) + Math.abs(dP[i * 3 + 2]) > 0.0005) moved++;
  }
  const still = skippedParts.filter(k => !(region === 'body' && KIT_PARTS.has(k)) && !(region === 'head' && KIT_PARTS.has(k)));
  if (still.length) log(`${id}: no deltas for ${still.join(', ')}`);
  deltasFor.set(id, { dP, dN });
  const per = mesh.listPrimitives().map(p => {
    const pv = prov.get(p), n = pv.length, tp = new Float32Array(n * 3), tn = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const q = pv[i]; if (!q) continue; const [a, b, t] = q; for (let c = 0; c < 3; c++) { tp[i * 3 + c] = dP[a * 3 + c] * (1 - t) + dP[b * 3 + c] * t; tn[i * 3 + c] = dN[a * 3 + c] * (1 - t) + dN[b * 3 + c] * t; } }
    return [p, tp, tn];
  });
  let mx = 0.0005; for (const [, tp] of per) for (let i = 0; i < tp.length; i++) mx = Math.max(mx, Math.abs(tp[i]));
  targetScale[id] = +mx.toFixed(5);
  for (const [p, tp, tn] of per) {
    const tgt = doc.createPrimitiveTarget(id).setAttribute('POSITION', qAccessor(doc, `${id}-P`, tp.map(x => x / targetScale[id]), buf));
    if (BROAD.has(id)) tgt.setAttribute('NORMAL', qAccessor(doc, `${id}-N`, tn, buf));
    p.addTarget(tgt);
  }
  report.targets.push({ id, region, rawVerticesMoved: moved, scaleMm: +(targetScale[id] * 1000).toFixed(1) });
  log(`target ${id} (${region}): ${moved} raw vertices move`);
}
const targetNames = report.targets.map(t => t.id);
// A target accessor in 8-bit integers: value / 127 of the target's scale (positions, metres; see
// index.targetScale) or of a unit normal change. Stored as plain integers (KHR_mesh_quantization
// allows them in targets) rather than normalised ones: glTF Transform writes a sparse accessor from
// its denormalised values, which an 8-bit array truncates to 0. Sparse when under 40% move.
function qAccessor(d, name, f, b) {
  const q = new Int8Array(f.length); let nz = 0;
  for (let i = 0; i < f.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(f[i] * 127)));
  for (let i = 0; i < f.length; i += 3) if (q[i] || q[i + 1] || q[i + 2]) nz++;
  return d.createAccessor(name).setType('VEC3').setArray(q).setNormalized(false).setBuffer(b).setSparse(nz < f.length / 3 * 0.4);
}
mesh.setWeights(new Array(targetNames.length).fill(0)).setExtras({ targetNames });
for (const p of mesh.listPrimitives()) for (const s of ['_RAWA', '_RAWB', '_RAWT']) if (p.getAttribute(s)) p.setAttribute(s, null);

// ── 5 (base). Finish and write ───────────────────────────────────────────────
async function finish(d, file) {
  await d.transform(dedup(), prune({ keepAttributes: true }), quantize({ pattern: /^(NORMAL|TEXCOORD|JOINTS|WEIGHTS|COLOR)/, patternTargets: /^$/, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8, quantizeColor: 8, cleanup: false }), prune({ keepAttributes: true }));   // the second prune drops the pre-quantisation copies
  d.createExtension(EXTTextureWebP).setRequired(true);
  d.createExtension(KHRMeshQuantization).setRequired(true);
  for (const t of d.getRoot().listTextures()) {
    if (t.getMimeType() === 'image/webp') continue;
    const img = await sharp(Buffer.from(t.getImage())).webp({ quality: t.getName().includes('normal') ? 90 : 86, alphaQuality: 90, effort: 6 }).toBuffer();
    t.setImage(new Uint8Array(img)).setMimeType('image/webp');
  }
  d.getRoot().getAsset().generator = 'The Gaffer athlete pipeline (Ara 3D Gen, glTF Transform, meshoptimizer, sharp)';
  await io.write(file, d);
  return stats(d, fs.statSync(file).size);
}
report.base = await finish(doc, path.join(OUT, `athlete${SUFFIX}.glb`));
log('base written', JSON.stringify(report.base));

// ── 4. Hairstyles ────────────────────────────────────────────────────────────
// Skin vertices of the finished base (head only), for hair to follow.
const finalSkin = await (async () => { const { doc: fdoc } = await readDoc(path.join(OUT, `athlete${SUFFIX}.glb`)); const sk = fdoc.getRoot().listMeshes()[0].listPrimitives().find(q => q.getMaterial().getName() === 'skin'); const P = sk.getAttribute('POSITION'), n = P.getCount(), out = new Float32Array(n * 3); for (let i = 0; i < n; i++) P.getElement(i, [0, 0, 0]).forEach((v, c) => { out[i * 3 + c] = v; }); return out; })();
const fsGrid = new Map(), FC = 0.02;
for (let i = 0; i < finalSkin.length / 3; i++) if (finalSkin[i * 3 + 1] > 1.35) { const g = `${Math.floor(finalSkin[i * 3] / FC)},${Math.floor(finalSkin[i * 3 + 1] / FC)},${Math.floor(finalSkin[i * 3 + 2] / FC)}`; (fsGrid.get(g) || fsGrid.set(g, []).get(g)).push(i); }
const nearestFinalSkin = (x, y, z) => { let best = 0, bd = 1; for (let r = 1; r <= 5 && bd === 1; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) for (const k of fsGrid.get(`${Math.floor(x / FC) + a},${Math.floor(y / FC) + b},${Math.floor(z / FC) + c}`) || []) { const d = (finalSkin[k * 3] - x) ** 2 + (finalSkin[k * 3 + 1] - y) ** 2 + (finalSkin[k * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = k; } } return best; };
// Nearest raw scalp/head vertex for copying targets onto hair.
const headGrid = new Map(), HC = 0.02;
for (let i = 0; i < rawBase.count; i++) if (rawHead[i] > 0.5 && rawBase.part[i] === 'Skin') { const g = `${Math.floor(rawBase.pos[i * 3] / HC)},${Math.floor(rawBase.pos[i * 3 + 1] / HC)},${Math.floor(rawBase.pos[i * 3 + 2] / HC)}`; (headGrid.get(g) || headGrid.set(g, []).get(g)).push(i); }
const nearestHead = (x, y, z) => { let best = -1, bd = 1; for (let r = 1; r <= 4 && best < 0; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) for (const k of headGrid.get(`${Math.floor(x / HC) + a},${Math.floor(y / HC) + b},${Math.floor(z / HC) + c}`) || []) { const d = (rawBase.pos[k * 3] - x) ** 2 + (rawBase.pos[k * 3 + 1] - y) ** 2 + (rawBase.pos[k * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = k; } } return best; };
for (const [style] of HAIR) {
  const file = rawFile(style);
  const { io: hio, doc: hd } = await readDoc(file);
  const hr = hd.getRoot(), hm = hr.listMeshes()[0];
  // Keep the hair (and, for shaved styles, the painted scalp of the overlay); drop the rest.
  const keep = new Set([...HAIR_PARTS, ...(style === 'buzz' || style === 'mohawk' || style === 'cornrows' ? ['Skin details'] : [])]);
  const keepPrims = [];
  for (const p of hm.listPrimitives().slice()) { const nm = p.getMaterial() ? p.getMaterial().getName() : ''; if (!keep.has(nm)) { hm.removePrimitive(p); p.dispose(); } else keepPrims.push(p); }
  if (!keepPrims.length) { log(`${style}: no hair found`); continue; }
  // Targets copied from the scalp under each hair vertex (raw space, before the rebind scales it).
  const pv = new Map();
  for (const p of keepPrims) {
    compactPrimitive(p);
    const ratio = (HAIR_RATIO[style] || 1) * HAIR_LOD;
    if (ratio < 1) { weldPrimitive(p, { tolerance: 0.0001 }); await simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: HAIR_LOD < 1 ? 0.008 : 0.004, lockBorder: false }); compactPrimitive(p); }
    pv.set(p, true);
  }
  await rebindToGaffer(hd, hm);
  // Grey hair textures (luminance, alpha kept) so the game tints them.
  for (const p of keepPrims) {
    const m = p.getMaterial(), t = m.getBaseColorTexture();
    if (t) {
      const { data, info } = await sharp(Buffer.from(t.getImage())).resize(256, 256, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      // The median of the visible hair becomes a light grey (190): the game multiplies it by his hair
      // colour, so blond, ginger and brown show as such and black stays black; strands keep their range.
      const lum = []; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) lum.push((data[i] + data[i + 1] + data[i + 2]) / 3);
      lum.sort((a, b) => a - b); const med = Math.max(8, lum.length ? lum[lum.length >> 1] : 128);
      for (let i = 0; i < data.length; i += 4) { const l = Math.min(255, Math.round((data[i] + data[i + 1] + data[i + 2]) / 3 / med * 190)); data[i] = data[i + 1] = data[i + 2] = l; }
      const png = await sharp(data, { raw: info }).png().toBuffer();
      t.setImage(new Uint8Array(png)).setMimeType('image/png');
    }
    m.setBaseColorFactor([1, 1, 1, 1]).setName(m.getName() === 'Skin details' ? 'hair-scalp' : 'hair');
    if (m.getAlphaMode() === 'OPAQUE') m.setAlphaMode('MASK').setAlphaCutoff(0.4);
    // The head's shape reaches the hair at run time: each hair vertex follows the movement of the
    // finished base's nearest skin vertex (_SKINREF), so no targets are stored per hairstyle.
    const P = p.getAttribute('POSITION'), n = P.getCount(), ref = new Float32Array(n);
    for (let i = 0; i < n; i++) { const e = P.getElement(i, [0, 0, 0]); ref[i] = nearestFinalSkin(e[0], e[1], e[2]); }
    p.setAttribute('_SKINREF', hd.createAccessor('_SKINREF').setType('SCALAR').setArray(ref).setBuffer(hr.listBuffers()[0]));
  }
  for (const a of hr.listAnimations()) a.dispose();
  const st = await finish(hd, path.join(OUT, `hair-${style}${SUFFIX}.glb`));
  report.hair[style] = { triangles: st.triangles, bytes: st.bytes };
  log(`hair ${style}: ${st.triangles} triangles, ${(st.bytes / 1024).toFixed(0)} KB`);
}

// ── Index ────────────────────────────────────────────────────────────────────
// Skin colour of the base (for tinting) and the chest's depth (for the shirt badges).
const { doc: fd } = await readDoc(path.join(OUT, `athlete${SUFFIX}.glb`));
const sm = fd.getRoot().listMaterials().find(m => m.getName() === 'skin');
let skinHex = '#b98a6c';
if (sm && sm.getBaseColorTexture()) {
  const t = sm.getBaseColorTexture(), [w] = t.getSize();
  const { data, info } = await sharp(Buffer.from(t.getImage())).extract({ left: 0, top: 0, width: w, height: w }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < data.length; i += info.channels) { const l = (data[i] + data[i + 1] + data[i + 2]) / 3; if (l > 25 && l < 240) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; } }
  skinHex = '#' + [r, g, b].map(v => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0')).join('');
}
let minY = 9, maxY = -9; for (const p of fd.getRoot().listMeshes()[0].listPrimitives()) { const P = p.getAttribute('POSITION'); for (let i = 0; i < P.getCount(); i++) { const y = P.getElement(i, [0, 0, 0])[1]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
const prevIndex = fs.existsSync(path.join(OUT, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')) : null;
const hairIndex = Object.fromEntries(Object.entries(report.hair).map(([k, v]) => [k, { file: `hair-${k}${SUFFIX}.glb`, bytes: v.bytes, triangles: v.triangles }]));
const index = LOD === 'match' ? { ...prevIndex, lods: { ...(prevIndex && prevIndex.lods), match: { base: `athlete${SUFFIX}.glb`, bytes: report.base.bytes, triangles: report.base.triangles, targetScale, skin: skinHex, hair: hairIndex } } } : {
  version: 2, lods: prevIndex && prevIndex.lods, note: 'The Gaffer athletes: one base with face, heritage, build and age targets, beard and glove shells, and one file per hairstyle (Ara 3D Gen and MakeHuman, CC0; built by tools/character-pipeline/athletes)',
  base: 'athlete.glb', bytes: report.base.bytes, triangles: report.base.triangles, targets: targetNames, targetScale, targetEncoding: 'int8/127', skin: skinHex, heightM: +(maxY - minY).toFixed(3),
  chest: { front: 0.15, back: -0.05 },
  hair: hairIndex,
  beards: Object.keys(report.shells).filter(k => k.startsWith('beard-')).map(k => k.slice(6)),
};
if (LOD === 'match' && !prevIndex) throw new Error('build the full athlete first (its index carries the match one)');
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
log(`wrote ${path.relative(ROOT, OUT)} (${LOD}): base ${(report.base.bytes / 1e6).toFixed(2)} MB, ${Object.keys(report.hair).length} hairstyles, ${targetNames.length} targets`);
