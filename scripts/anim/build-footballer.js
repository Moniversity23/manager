// scripts/anim/build-footballer.js — turns the CC0 Mesh2Motion mannequin and clips into the two
// files the 3D match view loads:
//   public/models/footballer.glb         the skinned mannequin, its mesh split into kit regions
//                                        (shirt, shorts, socks, boots, skin, hands, head) so each
//                                        player can wear his club's colours; texture dropped.
//   public/models/footballer-anims.json  the football clips in three.js AnimationClip format:
//                                        rotations for every bone, the pelvis translation, static
//                                        tracks collapsed to one key, values rounded; each kick
//                                        carries the moment and the foot that meet the ball.
// Sources stay untouched in assets/animations/source/; a report goes to
// assets/animations/processed/build-report.json. Fails loudly if any clip is missing or broken.
// Usage: node scripts/anim/build-footballer.js
const fs = require('fs');
const path = require('path');
const { readGLB, accessor, writeGLB } = require('./glb');
const RT = require('./retarget');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'assets', 'animations', 'source', 'mesh2motion');
const OUT = path.join(ROOT, 'public', 'models');
const REPORT = path.join(ROOT, 'assets', 'animations', 'processed', 'build-report.json');
// Football clips from Ara 3D Gen (scripts/anim/extract-ara.js), retargeted onto the same skeleton.
const ARA = path.join(ROOT, 'assets', 'animations', 'source', 'ara3dgen', 'football-clips.json');
const MAX_RETARGET_DEG = 1;     // a clip whose limbs end up further than this from the source fails the build

// Game clip → source file. loop: plays continuously; kick: has a ball-contact moment to find.
const CLIPS = {
  idle: { file: 'idle-subtle', loop: true }, idle2: { file: 'idle-a', loop: true },
  walk: { file: 'walk', loop: true }, jog: { file: 'jog', loop: true }, sprint: { file: 'sprint', loop: true },
  back: { file: 'walk-backwards', loop: true }, strafeL: { file: 'strafe-left', loop: true }, strafeR: { file: 'strafe-right', loop: true },
  ready: { file: 'fighting-idle', loop: true }, crouch: { file: 'crouch-idle', loop: true }, injuredWalk: { file: 'walk-injured', loop: true },
  kickFront: { file: 'kick-front', kick: true }, kickSide: { file: 'kick-side', kick: true },
  slide: { file: 'slide' }, header: { file: 'jump-2' }, jumpStart: { file: 'jump-start' }, jumpAir: { file: 'jump-air' }, jumpLand: { file: 'jump-land' },
  diveL: { file: 'dodge-left' }, diveR: { file: 'dodge-right' }, block: { file: 'defend' }, pickUp: { file: 'pick-up' }, chest: { file: 'hit-chest' },
  celFist: { file: 'victory-fist-pump' }, celVictory: { file: 'victory' }, celFlip: { file: 'backflip' }, celDab: { file: 'dab' }, celPower: { file: 'power-up' },
  clap: { file: 'clapping' }, angry: { file: 'angry' }, reject: { file: 'reject' }, call: { file: 'greeting' }, nod: { file: 'head-nod' }, yes: { file: 'yes' },
  tired: { file: 'tired-hunched', loop: true }, sitCry: { file: 'sit-ground-crying', loop: true },
  fall: { file: 'hit-knockback' }, getUp: { file: 'laytoidle' },
};
const KEEP_TRANSLATION = new Set(['pelvis']);
const round = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

// ── small 4×4 matrix helpers (column-major, as glTF) ──
function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
function mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; } return o; }
const nodeMatrix = n => n.matrix || compose(n.translation, n.rotation, n.scale);

function worldMatrices(nodes, local) {
  const parent = new Map(); nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
  const world = new Array(nodes.length);
  const get = i => { if (world[i]) return world[i]; const p = parent.get(i); world[i] = p == null ? local[i] : mul(get(p), local[i]); return world[i]; };
  nodes.forEach((n, i) => get(i));
  return world;
}

async function buildModel(report) {
  const g = await readGLB(path.join(SRC, 'model.glb'));
  const j = g.json, nodes = j.nodes;
  const meshNode = nodes.findIndex(n => n.mesh != null);
  const prim = j.meshes[nodes[meshNode].mesh].primitives[0];
  const skin = j.skins[nodes[meshNode].skin];
  const pos = accessor(g, prim.attributes.POSITION), nrm = accessor(g, prim.attributes.NORMAL);
  const joints = accessor(g, prim.attributes.JOINTS_0), weights = accessor(g, prim.attributes.WEIGHTS_0);
  const idx = accessor(g, prim.indices);
  const ibm = accessor(g, skin.inverseBindMatrices);
  // Bind-pose joint positions in the mesh's space (the inverse of each inverse bind matrix).
  const jointPos = name => { const k = skin.joints.findIndex(x => nodes[x].name === name); const m = ibm.subarray(k * 16, k * 16 + 16);
    // invert a rigid transform: position = -R^T t
    return [-(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]), -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]), -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14])]; };
  const J = n => jointPos(n);
  const neck = J('neck_01'), head = J('head'), hip = J('thigh_l'), knee = J('calf_l'), ankle = J('foot_l'), shoulder = J('upperarm_l'), elbow = J('lowerarm_l'), wrist = J('hand_l'), spine1 = J('spine_01');
  const up = Math.abs(neck[1] - ankle[1]) > Math.abs(neck[2] - ankle[2]) ? 1 : 2;           // which mesh axis is up
  const side = Math.abs(shoulder[0]) > Math.abs(shoulder[1 + (up === 1 ? 1 : 0)]) ? 0 : (up === 1 ? 2 : 1);
  report.model = { vertices: pos.length / 3, triangles: idx.length / 3, up: 'xyz'[up], side: 'xyz'[side], heights: { ankle: ankle[up], knee: knee[up], hip: hip[up], spine: spine1[up], neck: neck[up], head: head[up] }, armX: { shoulder: shoulder[side], elbow: elbow[side], wrist: wrist[side] } };
  // Kit regions from the bind (T) pose: arms reach sideways, so anything beyond the shoulder is arm.
  const sleeveEnd = Math.abs(shoulder[side]) + (Math.abs(elbow[side]) - Math.abs(shoulder[side])) * 0.62;
  const shortsEnd = knee[up] + (hip[up] - knee[up]) * 0.42, sockTop = ankle[up] + (knee[up] - ankle[up]) * 0.78;
  const waist = hip[up] + (spine1[up] - hip[up]) * 0.25, neckCut = neck[up] + (head[up] - neck[up]) * 0.35;

  // Each vertex belongs to the bone that moves it most; a triangle takes the region most of its
  // vertices are in. Bone boundaries follow the mesh's own edge loops, so seams stay clean.
  const NAMES = ['shirt', 'shorts', 'skin', 'socks', 'boots', 'hands', 'head'];
  const boneRegion = name => /^(spine|clavicle)/.test(name) ? 'shirt' : /^upperarm/.test(name) ? 'shirt' : /^(lowerarm|neck)/.test(name) ? 'skin'
    : /^(hand|index|middle|pinky|ring|thumb)/.test(name) ? 'hands' : /^head/.test(name) ? 'head' : /^(pelvis|root|thigh)/.test(name) ? 'shorts'
    : /^calf/.test(name) ? 'socks' : /^(foot|ball)/.test(name) ? 'boots' : 'skin';
  const jointRegion = skin.joints.map(x => boneRegion(nodes[x].name));
  const vRegion = new Array(pos.length / 3);
  for (let v = 0; v < vRegion.length; v++) { let best = 0; for (let k = 1; k < 4; k++) if (weights[v * 4 + k] > weights[v * 4 + best]) best = k; vRegion[v] = jointRegion[joints[v * 4 + best]]; }
  // Shorts end mid-thigh and socks below the knee. Each cut runs along the ring of mesh edges
  // nearest the wanted height (the most common vertex height there), so the hem is a clean line.
  const ring = (reg, target, span) => {
    const counts = new Map();
    for (let v = 0; v < vRegion.length; v++) { if (vRegion[v] !== reg) continue; const y = Math.round(pos[v * 3 + up] * 200) / 200; if (Math.abs(y - target) < span) counts.set(y, (counts.get(y) || 0) + 1); }
    let best = target, bestScore = -1;
    for (const [y, c] of counts) { const sc = c - Math.abs(y - target) * 400; if (sc > bestScore) { bestScore = sc; best = y; } }
    return best;
  };
  const hem = ring('shorts', knee[up] + (hip[up] - knee[up]) * 0.45, 0.08), sockLine = ring('socks', ankle[up] + (knee[up] - ankle[up]) * 0.8, 0.06);
  report.model.hems = { shorts: hem, socks: sockLine };
  const tris = Object.fromEntries(NAMES.map(n => [n, []]));
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]], r = vs.map(v => vRegion[v]);
    let pick = r[0] === r[1] || r[0] === r[2] ? r[0] : r[1] === r[2] ? r[1] : r[0];
    const ys = vs.map(v => pos[v * 3 + up]);
    if (pick === 'shorts' && Math.min(...ys) < hem - 0.004 && Math.max(...ys) < hip[up] - 0.05) pick = 'skin';
    if (pick === 'socks' && Math.max(...ys) > sockLine + 0.004) pick = 'skin';
    tris[pick].push(vs[0], vs[1], vs[2]);
  }
  report.model.regions = Object.fromEntries(NAMES.map(n => [n, tris[n].length / 3]));
  // Write a fresh, uncompressed GLB: shared vertex attributes, one primitive per region.
  const parts = [], views = [], accs = [];
  let offset = 0;
  const addView = (typed, target) => { const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); const pad = (4 - (b.length % 4)) % 4; views.push({ buffer: 0, byteOffset: offset, byteLength: b.length, ...(target ? { target } : {}) }); parts.push(b); if (pad) parts.push(Buffer.alloc(pad)); offset += b.length + pad; return views.length - 1; };
  const addAcc = (typed, componentType, type, count, extra = {}) => { accs.push({ bufferView: addView(typed, extra.target), componentType, type, count, ...(extra.min ? { min: extra.min, max: extra.max } : {}), ...(extra.normalized ? { normalized: true } : {}) }); return accs.length - 1; };
  const n = pos.length / 3;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
  const aPos = addAcc(new Float32Array(pos), 5126, 'VEC3', n, { target: 34962, min: mn, max: mx });
  const aNrm = addAcc(new Float32Array(nrm), 5126, 'VEC3', n, { target: 34962 });
  const aJ = addAcc(Uint8Array.from(joints), 5121, 'VEC4', n, { target: 34962 });
  const w8 = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { let s = 0; const q = [0, 1, 2, 3].map(k => Math.round(weights[i * 4 + k] * 255)); s = q.reduce((a, b) => a + b, 0); q[q.indexOf(Math.max(...q))] += 255 - s; for (let k = 0; k < 4; k++) w8[i * 4 + k] = q[k]; }
  const aW = addAcc(w8, 5121, 'VEC4', n, { target: 34962, normalized: true });
  const aIbm = addAcc(new Float32Array(ibm), 5126, 'MAT4', skin.joints.length);
  const prims = NAMES.filter(r => tris[r].length).map((r, mi) => ({ attributes: { POSITION: aPos, NORMAL: aNrm, JOINTS_0: aJ, WEIGHTS_0: aW }, indices: addAcc(Uint16Array.from(tris[r]), 5123, 'SCALAR', tris[r].length, { target: 34963 }), material: NAMES.indexOf(r) }));
  const out = {
    asset: { version: '2.0', generator: 'The Gaffer animation pipeline (from Mesh2Motion CC0 mannequin)' },
    scene: 0, scenes: [{ nodes: j.scenes[j.scene || 0].nodes }],
    nodes: nodes.map(nd => { const c = { ...nd }; delete c.extensions; return c; }),
    meshes: [{ name: 'Footballer', primitives: prims }],
    skins: [{ joints: skin.joints, inverseBindMatrices: aIbm, ...(skin.skeleton != null ? { skeleton: skin.skeleton } : {}) }],
    materials: NAMES.map(r => ({ name: r, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.8 } })),
    accessors: accs, bufferViews: views, buffers: [{ byteLength: offset }],
  };
  out.nodes[meshNode].mesh = 0; out.nodes[meshNode].skin = 0;
  fs.mkdirSync(OUT, { recursive: true });
  writeGLB(path.join(OUT, 'footballer.glb'), out, Buffer.concat(parts));
  report.model.bytes = fs.statSync(path.join(OUT, 'footballer.glb')).size;
  return { nodes, skin };
}

// Forward kinematics on one clip to find when the kicking foot moves fastest (ball contact).
function kickContact(nodes, tracks, duration) {
  const byName = new Map(nodes.map((n, i) => [n.name, i]));
  const sample = (tr, t) => { const { times, values, size } = tr; let i = 0; while (i < times.length - 1 && times[i + 1] < t) i++; const a = Math.min(i, times.length - 1), b = Math.min(i + 1, times.length - 1); const k = times[b] > times[a] ? (t - times[a]) / (times[b] - times[a]) : 0; return Array.from({ length: size }, (_, c) => values[a * size + c] + (values[b * size + c] - values[a * size + c]) * k); };
  const footAt = (t) => {
    const local = nodes.map((n, i) => { const tr = tracks.get(i) || {}; const T = tr.translation ? sample(tr.translation, t) : n.translation; const R = tr.rotation ? sample(tr.rotation, t) : n.rotation; let q = R || [0, 0, 0, 1]; const L = Math.hypot(...q); q = q.map(x => x / L); return compose(T, q, n.scale); });
    const w = worldMatrices(nodes, local);
    return ['ball_l', 'ball_r'].map(nm => { const m = w[byName.get(nm)]; return [m[12], m[13], m[14]]; });
  };
  const fps = 60, frames = Math.max(2, Math.round(duration * fps));
  let prev = footAt(0), best = { v: 0, t: 0, foot: 'r' };
  for (let f = 1; f <= frames; f++) {
    const t = f / fps, cur = footAt(t);
    ['l', 'r'].forEach((s, k) => { const v = Math.hypot(cur[k][0] - prev[k][0], cur[k][1] - prev[k][1], cur[k][2] - prev[k][2]) * fps; if (v > best.v) best = { v, t, foot: s }; });
    prev = cur;
  }
  return { contact: round(best.t, 3), foot: best.foot, footSpeed: round(best.v, 2) };
}

async function buildClips(model, report) {
  const out = { source: 'Mesh2Motion human animation library (CC0 1.0)', clips: {} };
  report.clips = []; report.failed = [];
  for (const [key, def] of Object.entries(CLIPS)) {
    const file = path.join(SRC, 'animations', def.file + '.glb');
    try {
      const g = await readGLB(file);
      const a = g.json.animations && g.json.animations[0];
      if (!a) throw new Error('no animation in file');
      const nodes = g.json.nodes;
      const tracks = [], fk = new Map();
      let duration = 0, kept = 0, collapsed = 0;
      for (const ch of a.channels) {
        const nd = nodes[ch.target.node], p = ch.target.path;
        if (!nd || p === 'scale' || (p === 'translation' && !KEEP_TRANSLATION.has(nd.name))) continue;
        const s = a.samplers[ch.sampler];
        const times = Array.from(accessor(g, s.input)), vals = accessor(g, s.output), size = p === 'rotation' ? 4 : 3;
        duration = Math.max(duration, times[times.length - 1]);
        const fkEntry = fk.get(ch.target.node) || {}; fkEntry[p] = { times, values: vals, size }; fk.set(ch.target.node, fkEntry);
        let still = true;
        for (let i = size; i < vals.length && still; i++) if (Math.abs(vals[i] - vals[i % size]) > 2e-4) still = false;
        // Fingers barely move in these clips: hold each one at its pose from the middle of the clip.
        const finger = /^(index|middle|pinky|ring|thumb)_/.test(nd.name);
        const mid = Math.floor(times.length / 2) * size;
        const T = still || finger ? [0] : times.map(t => round(t, 3));
        const V = still ? Array.from(vals.slice(0, size)) : finger ? Array.from(vals.slice(mid, mid + size)) : Array.from(vals);
        if (still || finger) collapsed++; else kept++;
        tracks.push({ name: `${nd.name}.${p === 'rotation' ? 'quaternion' : 'position'}`, type: p === 'rotation' ? 'quaternion' : 'vector', times: T, values: V.map(v => round(v, p === 'rotation' ? 3 : 4)) });
      }
      if (!tracks.length) throw new Error('no usable tracks');
      const clip = { name: key, duration: round(duration, 4), tracks, loop: !!def.loop };
      if (def.kick) Object.assign(clip, kickContact(nodes, fk, duration));
      out.clips[key] = clip;
      report.clips.push({ key, source: def.file + '.glb', sourceName: a.name, duration: clip.duration, tracks: tracks.length, animated: kept, staticCollapsed: collapsed, ...(def.kick ? { contact: clip.contact, foot: clip.foot } : {}) });
    } catch (e) { report.failed.push({ key, file: def.file + '.glb', error: e.message }); }
  }
  // Ara 3D Gen's football clips (passes with the inside of the foot, first touch, chest control,
  // headers, tackles, the keeper's catch, punch and dives, throws): retargeted from Ara's skeleton,
  // checked limb by limb against the source, and given the moment they meet the ball.
  if (fs.existsSync(ARA)) {
    const src = JSON.parse(fs.readFileSync(ARA, 'utf8'));
    const tgt = RT.restFromGLB((await readGLB(path.join(SRC, 'model.glb'))).json);
    report.retarget = [];
    for (const [key, c] of Object.entries(src.clips)) {
      try {
        if (out.clips[key]) throw new Error('name already used by a Mesh2Motion clip');
        const clip = RT.retargetClip(src.rest, c, tgt, { name: key, fps: src.source.fps || 30 });
        const check = RT.checkClip(src.rest, c, tgt, clip, { fps: src.source.fps || 30 });
        if (!(check.worst <= MAX_RETARGET_DEG)) throw new Error(`retarget error ${check.worst}° (limit ${MAX_RETARGET_DEG}°)`);
        clip.src = 'ara';
        if (c.contact != null) { clip.contact = c.contact; clip.part = c.part; if (c.part === 'footR') clip.foot = 'r'; }
        out.clips[key] = clip;
        report.retarget.push({ key, source: c.name, duration: clip.duration, worstDeg: check.worst, contact: c.contact ?? null });
      } catch (e) { report.failed.push({ key, file: 'ara3dgen/football-clips.json', error: e.message }); }
    }
    out.source += '; football clips from Ara 3D Gen (MIT code, CC0 MakeHuman data), retargeted by scripts/anim/retarget.js';
  }
  const file = path.join(OUT, 'footballer-anims.json');
  fs.writeFileSync(file, JSON.stringify(out));
  report.animsBytes = fs.statSync(file).size;
}

(async () => {
  const report = { when: new Date().toISOString() };
  const model = await buildModel(report);
  await buildClips(model, report);
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  console.log(`footballer.glb ${Math.round(report.model.bytes / 1024)} KB · regions ${JSON.stringify(report.model.regions)}`);
  console.log(`footballer-anims.json ${Math.round(report.animsBytes / 1024)} KB · ${report.clips.length} clips${report.failed.length ? ` · FAILED ${report.failed.map(f => f.key + ': ' + f.error).join('; ')}` : ''}`);
  for (const c of report.clips.filter(x => x.contact != null)) console.log(`  ${c.key}: ball contact at ${c.contact}s with the ${c.foot === 'r' ? 'right' : 'left'} foot`);
  if (report.retarget) console.log(`  Ara 3D Gen: ${report.retarget.length} clips retargeted, worst limb error ${Math.max(0, ...report.retarget.map(r => r.worstDeg))}°`);
  if (report.failed.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
