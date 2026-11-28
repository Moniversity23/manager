// The athletes (tools/character-pipeline/athletes → public/models/athletes): what ships, that they
// are on the game's skeleton, that every shape target really moves the body (a writer bug once
// stored them all as zero), that heritage and age change faces rather than heights, that hairstyles
// follow the head, and that every player's look gives him an identity of his own, the same each time.
import { describe, it, expect } from 'vitest';
import { athleteRecipe } from '../public/match3d.js';
const fs = require('fs');
const path = require('path');
const { readGLB, accessor, SIZE } = require('../scripts/anim/glb.js');
const RT = require('../scripts/anim/retarget.js');
const LOOK = require('../src/look.js');

const DIR = path.join(__dirname, '..', 'public', 'models', 'athletes');
const INDEX = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const MATCH = INDEX.lods.match;

// An accessor's stored values (integers as stored; normalised ones as values), sparse ones included.
function values(glb, i) {
  const a = glb.json.accessors[i], n = SIZE[a.type];
  const out = a.bufferView != null ? accessor(glb, i) : new Float32Array(a.count * n);
  if (a.sparse) {
    const sp = a.sparse, read = (view, off, type, count) => {
      const v = glb.views[view], dv = new DataView(v.bytes.buffer, v.bytes.byteOffset, v.bytes.byteLength), sz = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[type];
      const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[type];
      return Array.from({ length: count }, (_, k) => dv[get]((off || 0) + k * sz, true));
    };
    const idx = read(sp.indices.bufferView, sp.indices.byteOffset, sp.indices.componentType, sp.count);
    const val = read(sp.values.bufferView, sp.values.byteOffset, a.componentType, sp.count * n);
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    idx.forEach((v, k) => { for (let c = 0; c < n; c++) out[v * n + c] = norm ? Math.max(val[k * n + c] / norm, -1) : val[k * n + c]; });
  }
  return out;
}
const glbs = {};
const load = async f => (glbs[f] ||= await readGLB(path.join(DIR, f)));
// A part as the game names it: its material, except the beards (one shared material; the part is in extras).
const prims = g => g.json.meshes[0].primitives.map(p => { const mat = g.json.materials[p.material].name; return { p, mat, part: mat.startsWith('beard-') ? (p.extras && p.extras.part) || mat : mat }; });

describe('athletes: what ships', () => {
  it('a close-up and a match level of detail, each small enough to load once on a phone', () => {
    const full = fs.statSync(path.join(DIR, INDEX.base)).size, match = fs.statSync(path.join(DIR, MATCH.base)).size;
    expect(full).toBeLessThan(2_300_000);                               // the close-up head is finer (faces and portraits): 2.19 MB in milestone 15
    expect(match).toBeLessThan(1_400_000);
    expect(MATCH.triangles).toBeLessThan(INDEX.triangles * 0.65);       // the pitch athlete is much lighter
    expect(MATCH.triangles).toBeLessThan(14_000);
    expect(Object.keys(INDEX.hair).sort()).toEqual(Object.keys(MATCH.hair).sort());
    expect(Object.keys(INDEX.hair).length).toBeGreaterThanOrEqual(11);
    for (const [k, e] of Object.entries(INDEX.hair)) {
      expect(fs.statSync(path.join(DIR, e.file)).size, k).toBeLessThan(230_000);
      expect(fs.statSync(path.join(DIR, MATCH.hair[k].file)).size, k).toBeLessThan(160_000);
      expect(MATCH.hair[k].triangles, k).toBeLessThan(e.triangles);
    }
    expect(INDEX.beards.sort()).toEqual(['full', 'goatee', 'mustache', 'short', 'stubble']);
  });

  it('both are skinned to the game skeleton, with 37 shape targets on every part', async () => {
    const gaffer = RT.restFromGLB((await readGLB(path.join(__dirname, '..', 'assets', 'animations', 'source', 'mesh2motion', 'model.glb'))).json);
    for (const f of [INDEX.base, MATCH.base]) {
      const { json } = await load(f);
      const joints = json.skins[0].joints.map(i => json.nodes[i].name).sort();
      expect(joints, f).toEqual(Object.keys(gaffer).sort());           // every game clip drives him
      expect(json.meshes[0].extras.targetNames).toEqual(INDEX.targets);
      for (const { p } of prims(await load(f))) expect(p.targets.length, f).toBe(INDEX.targets.length);
      const parts = new Set(prims(await load(f)).map(x => x.part));
      for (const k of ['skin', 'hair', 'kit', 'boots', 'gloves', 'beard-goatee', 'beard-short', 'beard-full', 'beard-mustache', 'beard-stubble']) expect(parts.has(k), `${f} ${k}`).toBe(true);
      expect(json.extensionsUsed).toEqual(expect.arrayContaining(['KHR_mesh_quantization', 'EXT_texture_webp']));
      expect(json.animations || []).toHaveLength(0);
    }
  });
});

describe('athletes: shape targets', () => {
  it('every target really moves him (stored as whole 8-bit steps of its scale, not truncated to 0)', async () => {
    for (const f of [INDEX.base, MATCH.base]) {
      const g = await load(f), ps = prims(g);
      INDEX.targets.forEach((id, t) => {
        let mx = 0, skin = 0;
        for (const { p, part } of ps) { const v = values(g, p.targets[t].POSITION); for (const x of v) { mx = Math.max(mx, Math.abs(x)); if (part === 'skin') skin = Math.max(skin, Math.abs(x)); } }
        expect(mx, `${f} ${id}`).toBeGreaterThanOrEqual(120);           // its largest delta uses the full range
        if (!['muscular', 'lean', 'heavy', 'slim'].includes(id)) expect(skin, `${f} ${id} on the face`).toBeGreaterThanOrEqual(40);
      });
    }
  });

  it('heritage and age change the face, not where the head is (the height change is taken out)', async () => {
    const g = await load(INDEX.base), skin = prims(g).find(x => x.part === 'skin').p;
    const pos = values(g, skin.attributes.POSITION);
    for (const id of ['afr', 'asi', 'cau', 'older', 'younger']) {
      const t = INDEX.targets.indexOf(id), d = values(g, skin.targets[t].POSITION), k = INDEX.targetScale[id] / 127;
      let sy = 0, n = 0, moved = 0;
      for (let i = 0; i < pos.length / 3; i++) if (pos[i * 3 + 1] > 1.52) { sy += d[i * 3 + 1] * k; n++; if (Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]) * k > 0.001) moved++; }
      expect(Math.abs(sy / n) * 1000, `${id}: mean vertical shift of the head, mm`).toBeLessThan(3);
      expect(moved / n, `${id}: share of the head reshaped by over 1 mm`).toBeGreaterThan(0.15);
    }
  });

  it('a build target reshapes the kit with the body (sleeves, shirt and shorts follow)', async () => {
    const g = await load(INDEX.base), kit = prims(g).find(x => x.part === 'kit').p;
    for (const id of ['muscular', 'heavy']) {
      const d = values(g, kit.targets[INDEX.targets.indexOf(id)].POSITION);
      let moved = 0; for (let i = 0; i < d.length; i += 3) if (Math.hypot(d[i], d[i + 1], d[i + 2]) > 6) moved++;
      expect(moved / (d.length / 3), id).toBeGreaterThan(0.3);
    }
  });

  it('every hairstyle follows the head of its own level of detail (each vertex names a scalp vertex)', async () => {
    for (const [base, hair] of [[INDEX.base, INDEX.hair], [MATCH.base, MATCH.hair]]) {
      const g = await load(base), skinCount = g.json.accessors[prims(g).find(x => x.part === 'skin').p.attributes.POSITION].count;
      const pos = values(g, prims(g).find(x => x.part === 'skin').p.attributes.POSITION);
      for (const e of Object.values(hair)) {
        const h = await readGLB(path.join(DIR, e.file));
        expect(h.json.skins[0].joints.map(i => h.json.nodes[i].name)).toEqual(g.json.skins[0].joints.map(i => g.json.nodes[i].name));
        for (const p of h.json.meshes[0].primitives) {
          expect(p.attributes._SKINREF, e.file).toBeDefined();
          const ref = values(h, p.attributes._SKINREF);
          for (const r of ref) { expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThan(skinCount); }
          expect(Math.min(...Array.from(ref, r => pos[r * 3 + 1])), e.file).toBeGreaterThan(1.3);   // a head vertex, not a foot
        }
      }
    }
  });
});

describe('athletes: a player of his own', () => {
  const looks = Array.from({ length: 60 }, (_, i) => LOOK.describe(LOOK.makeLook(1000 + i, ['Nigeria', 'Japan', 'Brazil', 'England', 'Spain', 'Germany'][i % 6], ['GK', 'CB', 'CM', 'ST', 'LW', 'RB'][i % 6]), 18 + (i % 19)));
  it('the same look always gives the same athlete', () => {
    for (const lk of looks) expect(JSON.stringify(athleteRecipe({ ...lk, faceSeed: 7 }))).toBe(JSON.stringify(athleteRecipe({ ...lk, faceSeed: 7 })));
  });

  it('sixty players give sixty faces, with weights in range, on hairstyles and beards that ship', () => {
    const seen = new Set();
    looks.forEach((lk, i) => {
      const r = athleteRecipe({ ...lk, faceSeed: 5000 + i });
      seen.add(JSON.stringify(r.w));
      for (const [k, v] of Object.entries(r.w)) { expect(INDEX.targets, k).toContain(k); expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1.35); }
      if (r.hair) expect(INDEX.hair[r.hair], r.hair).toBeDefined(); else expect(lk.hairStyle).toBe('bald');
      if (r.beard) expect(INDEX.beards).toContain(r.beard);
    });
    expect(seen.size).toBe(looks.length);
  });

  it('every hairstyle and beard of the game has its athlete version', () => {
    for (const style of [...LOOK.HAIR, 'receding']) { const r = athleteRecipe({ skin: 3, hairStyle: style, heightCm: 180, build: 7 }); if (style === 'bald') expect(r.hair).toBeNull(); else expect(INDEX.hair[r.hair], style).toBeDefined(); }
    for (const b of LOOK.BEARD) { const r = athleteRecipe({ skin: 3, beardStyle: b, hairStyle: 'crop', heightCm: 180, build: 7 }); if (b === 'none') expect(r.beard).toBeNull(); else expect(INDEX.beards, b).toContain(r.beard); }
  });

  it('heritage follows nationality and skin tone; build and age show', () => {
    const base = { hairStyle: 'crop', heightCm: 180, build: 7, faceSeed: 3 };
    expect(athleteRecipe({ ...base, skin: 1, heritage: 'east-asian' }).w.asi).toBeGreaterThan(0.6);
    expect(athleteRecipe({ ...base, skin: 7 }).w.afr).toBeGreaterThan(0.6);
    expect(athleteRecipe({ ...base, skin: 0 }).w.cau).toBeGreaterThan(0.6);
    expect(athleteRecipe({ ...base, skin: 3, build: 15 }).w.heavy).toBeGreaterThan(0.5);
    expect(athleteRecipe({ ...base, skin: 3, build: 1 }).w.slim).toBeGreaterThan(0.5);
    expect(athleteRecipe({ ...base, skin: 3, build: 1 }).w.lean).toBeGreaterThan(0.4);
    expect(athleteRecipe({ ...base, skin: 3, age: 36 }).w.older).toBeGreaterThan(0.6);
    expect(athleteRecipe({ ...base, skin: 3, age: 17 }).w.younger).toBeGreaterThan(0.5);
    // The Studio's face sliders reach the shape.
    expect(athleteRecipe({ ...base, skin: 3, face: { nose: 1 } }).w.noseWide).toBeGreaterThan(1);
    expect(athleteRecipe({ ...base, skin: 3, face: { shape: 'square' } }).w.headSquare).toBeGreaterThan(0.9);
  });
});
