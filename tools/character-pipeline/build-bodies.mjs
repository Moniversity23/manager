// Builds The Gaffer's close-up bodies from Ara 3D Gen, repeatably:
//   1. (optional, --export) exports each recipe in recipes/ with Ara 3D Gen's own CLI
//      (FOOTBALL-RALISM-LAB/Ara3DGen, low detail, game rig, T-pose, no clips, no face shapes);
//   2. optimises each export (optimise.mjs) and checks it (validate.mjs) — a body that fails the
//      deformation check is not written;
//   3. measures each body's skin colour (for tinting) and chest depth (for the shirt badges);
//   4. writes public/models/bodies/<id>.glb and index.json, and a report with every measurement
//      to assets/characters/build-report.json.
// Usage: node build-bodies.mjs --raw <folder of Ara exports> [--export] [--only m-dark,m-light]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { readDoc } from './inspect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const THREE = require('three');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const RAW = path.resolve(opt('raw') || path.join(ROOT, 'FOOTBALL-RALISM-LAB', 'outputs', 'gaffer-bodies'));
const ARA = path.join(ROOT, 'FOOTBALL-RALISM-LAB', 'Ara3DGen');
const OUT = path.join(ROOT, 'public', 'models', 'bodies');
const REPORT = path.join(ROOT, 'assets', 'characters', 'build-report.json');
const only = opt('only') ? new Set(opt('only').split(',')) : null;
// Bodies that ship with the game; test bodies (f-test) are built and checked but not shipped.
const SHIP = { 'm-light': 'Light skin', 'm-brown': 'Brown skin', 'm-dark': 'Dark skin', 'm-asian': 'East Asian' };

const recipes = fs.readdirSync(path.join(HERE, 'recipes')).filter(f => f.endsWith('.params.json')).map(f => f.replace('.params.json', '')).filter(id => !only || only.has(id));
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const tmp = fs.mkdtempSync(path.join(RAW, '.opt-'));
const report = { built: new Date().toISOString(), tools: toolVersions(), bodies: [] };
const index = { version: 1, note: 'Close-up footballer bodies (Ara 3D Gen, CC0 MakeHuman data) optimised by tools/character-pipeline', bodies: [] };
const prev = fs.existsSync(path.join(OUT, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')) : null;
const prevReport = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : null;

for (const id of recipes) {
  const raw = path.join(RAW, id + '.glb');
  if (args.includes('--export')) {
    console.log(`[bodies] exporting ${id} with Ara 3D Gen…`);
    // Ara's own exporter (scripts/export-cli.ts) through its tsx, without a shell, so paths with spaces work.
    execFileSync(process.execPath, [path.join(ARA, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/export-cli.ts', '--params', path.join(HERE, 'recipes', id + '.params.json'), '--formats', 'glb', '--detail', 'low', '--no-animations', '--out', RAW], { cwd: ARA, stdio: 'inherit' });
  }
  if (!fs.existsSync(raw)) { console.log(`[bodies] ${id}: no export at ${raw} (run with --export)`); continue; }
  const out = path.join(tmp, id + '.glb');
  const t0 = Date.now();
  execFileSync(process.execPath, [path.join(HERE, 'optimise.mjs'), raw, out, '--report', out + '.json'], { stdio: 'inherit' });
  const optimiseMs = Date.now() - t0;
  let validation;
  try { execFileSync(process.execPath, [path.join(HERE, 'validate.mjs'), raw, out, '--report', out + '.v.json', '--moved', out + '.json'], { stdio: 'pipe' }); validation = JSON.parse(fs.readFileSync(out + '.v.json', 'utf8')); }
  catch (e) { validation = fs.existsSync(out + '.v.json') ? JSON.parse(fs.readFileSync(out + '.v.json', 'utf8')) : { pass: false, error: String(e.message).slice(0, 200) }; }
  const opt = JSON.parse(fs.readFileSync(out + '.json', 'utf8'));
  const measure = await measureBody(out);
  const { movedVertices, cutVertices, ...covered } = opt.covered || {};          // the lists stay in the optimiser's report
  const entry = { id, recipe: `recipes/${id}.params.json`, before: opt.before, after: opt.after, rebind: opt.rebind, skinUnderKit: covered, optimiseMs, validation, ...measure, shipped: !!SHIP[id] && validation.pass };
  report.bodies.push(entry);
  console.log(`[bodies] ${id}: ${opt.before.triangles} → ${opt.after.triangles} triangles, ${opt.before.materials} → ${opt.after.materials} materials, ${(opt.before.bytes / 1e6).toFixed(2)} → ${(opt.after.bytes / 1e6).toFixed(2)} MB, validation ${validation.pass ? 'passed' : 'FAILED'}`);
  if (!validation.pass) continue;
  if (SHIP[id]) {
    entry.tmpFile = out;
    index.bodies.push({ id, file: id + '.glb', label: SHIP[id], gender: JSON.parse(fs.readFileSync(path.join(HERE, 'recipes', id + '.params.json'), 'utf8')).gender >= 0.5 ? 'male' : 'female', bytes: opt.after.bytes, triangles: opt.after.triangles, skin: measure.skin, chest: measure.chest, heightM: measure.heightM });
  }
}
// A shipped body that failed its check stops the build: nothing in public/ is changed.
const failed = report.bodies.filter(x => SHIP[x.id] && !x.validation.pass);
if (failed.length) { fs.writeFileSync(REPORT, JSON.stringify(report, null, 1)); fs.rmSync(tmp, { recursive: true, force: true }); console.error(`[bodies] FAILED: ${failed.map(x => x.id).join(', ')} — public/models/bodies left as it was`); process.exit(1); }
// Keep bodies built earlier when only some were rebuilt.
if (prev && only) for (const b of prev.bodies) if (!index.bodies.some(x => x.id === b.id)) index.bodies.push(b);
for (const x of report.bodies) if (x.tmpFile) { fs.copyFileSync(x.tmpFile, path.join(OUT, x.id + '.glb')); delete x.tmpFile; }
index.bodies.sort((a, b) => Object.keys(SHIP).indexOf(a.id) - Object.keys(SHIP).indexOf(b.id));
if (prevReport && only) for (const x of prevReport.bodies) if (!report.bodies.some(y => y.id === x.id)) report.bodies.push(x);   // keep the others' measurements
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`[bodies] wrote ${index.bodies.length} bodies to public/models/bodies and the report to assets/characters/build-report.json`);

// Skin colour (mean of the skin texture's lit skin pixels), height, and the chest's front and back
// at the spine_03 joint (for placing the sponsor, crest and number).
async function measureBody(file) {
  const { doc } = await readDoc(file);
  const root = doc.getRoot();
  const skinMat = root.listMaterials().find(m => m.getName() === 'skin');
  let skin = null;
  if (skinMat && skinMat.getBaseColorTexture()) {
    const t = skinMat.getBaseColorTexture(), [w] = t.getSize();
    const { data, info } = await sharp(Buffer.from(t.getImage())).extract({ left: 0, top: 0, width: w, height: w }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels) { const l = (data[i] + data[i + 1] + data[i + 2]) / 3; if (l > 25 && l < 240) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; } }
    skin = '#' + [r, g, b].map(v => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0')).join('');
  }
  // Rest world positions of the joints, then the kit's surface around spine_03.
  const nodes = root.listNodes(), parent = new Map(); for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  const world = n => { const L = new THREE.Matrix4().compose(new THREE.Vector3(...n.getTranslation()), new THREE.Quaternion(...n.getRotation()), new THREE.Vector3(...n.getScale())); const p = parent.get(n); return p ? world(p).multiply(L) : L; };
  const spine = nodes.find(n => n.getName() === 'spine_03'), sp = new THREE.Vector3().setFromMatrixPosition(world(spine));
  let front = -9, back = 9, minY = 9, maxY = -9;
  for (const p of root.listMeshes()[0].listPrimitives()) {
    const P = p.getAttribute('POSITION'), kit = p.getMaterial().getName() === 'kit';
    for (let i = 0; i < P.getCount(); i++) {
      const v = P.getElement(i, [0, 0, 0]); minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
      if (kit && Math.abs(v[1] - sp.y) < 0.04 && Math.abs(v[0] - sp.x) < 0.05) { front = Math.max(front, v[2] - sp.z); back = Math.min(back, v[2] - sp.z); }
    }
  }
  return { skin, heightM: +(maxY - minY).toFixed(3), chest: { front: +front.toFixed(3), back: +back.toFixed(3), spineY: +sp.y.toFixed(3) } };
}
function toolVersions() {
  const v = p => JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules', p, 'package.json'), 'utf8')).version;
  return { 'glTF Transform': v('@gltf-transform/core'), meshoptimizer: v('meshoptimizer'), sharp: v('sharp') };
}
