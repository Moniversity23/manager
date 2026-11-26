// The optimised close-up bodies (tools/character-pipeline → public/models/bodies): what ships, that
// they are on the game's skeleton, and that a player's choice of body is part of his saved identity.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { readGLB } = require('../scripts/anim/glb.js');
const RT = require('../scripts/anim/retarget.js');
const { GameWorld } = require('../src/index.js');
const { validateProfile, createProfile } = require('../src/studio/profileSchema.js');
const { mergeForRenderer } = require('../src/studio/appearanceService.js');
const APPEARANCE = require('../public/appearance.js');
const TR = require('../src/engine/transferEngine.js');

const DIR = path.join(__dirname, '..', 'public', 'models', 'bodies');
const INDEX = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));

describe('close-up bodies', () => {
  it('four male bodies ship, each small enough for a phone to load on demand', () => {
    expect(INDEX.bodies.map(b => b.id).sort()).toEqual(['m-asian', 'm-brown', 'm-dark', 'm-light']);
    for (const b of INDEX.bodies) {
      const bytes = fs.statSync(path.join(DIR, b.file)).size;
      expect(bytes, b.id).toBeLessThan(800_000);
      expect(b.triangles, b.id).toBeGreaterThan(9_000);
      expect(b.triangles, b.id).toBeLessThan(15_000);
      expect(b.gender).toBe('male');
      expect(b.skin).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('each body is skinned to the game skeleton, with four materials, no clips and no morph targets', async () => {
    const gaffer = RT.restFromGLB((await readGLB(path.join(__dirname, '..', 'assets', 'animations', 'source', 'mesh2motion', 'model.glb'))).json);
    for (const b of INDEX.bodies) {
      const { json } = await readGLB(path.join(DIR, b.file));
      const joints = json.skins[0].joints.map(i => json.nodes[i].name).sort();
      expect(joints, b.id).toEqual(Object.keys(gaffer).sort());          // every game clip drives it
      expect(json.materials.map(m => m.name).sort()).toEqual(['boots', 'hair', 'kit', 'skin']);
      expect(json.animations || []).toHaveLength(0);
      for (const m of json.meshes) for (const p of m.primitives) expect(p.targets || [], b.id).toHaveLength(0);
      expect(json.extensionsUsed).toEqual(expect.arrayContaining(['KHR_mesh_quantization', 'EXT_texture_webp']));
      const kit = json.meshes[0].primitives.find(p => json.materials[p.material].name === 'kit');
      expect(kit.attributes.COLOR_0, 'kit parts are coded in COLOR_0').toBeDefined();
    }
  });

  it('the build report records before and after for every body and a passed deformation check', () => {
    const report = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'characters', 'build-report.json'), 'utf8'));
    for (const b of INDEX.bodies) {
      const r = report.bodies.find(x => x.id === b.id);
      expect(r.validation.pass, b.id).toBe(true);
      expect(r.after.triangles).toBeLessThan(r.before.triangles);
      expect(r.after.materials).toBe(4);
      expect(r.after.bytes).toBeLessThan(r.before.bytes / 3);
      expect(r.validation.rest.meanMm).toBeLessThan(1);
      // Skin under the kit was cut away or moved in, and every such vertex was found and checked.
      const h = r.validation.hiddenSkin;
      expect(r.skinUnderKit.newCorners, b.id).toBeGreaterThan(0);
      expect(h.matched, b.id).toBe(h.moved + h.newCorners);
      expect(h.movedMaxMm, b.id).toBeLessThan(30);
    }
  });
});

describe('a player keeps his close-up body', () => {
  it('the Studio profile accepts a body choice and old profiles stay valid', () => {
    const p = createProfile({ appearance: { skinTone: 'light', baseBody: 'm-light' } });
    expect(p.appearance.baseBody).toBe('m-light');
    expect(() => validateProfile({ schemaVersion: 1, appearance: { baseBody: 'robot' } })).toThrow();
    const old = validateProfile({ schemaVersion: 1, appearance: { skinTone: 'dark', hairStyle: 'afro' } });
    expect(old.appearance.skinTone).toBe('dark');
  });

  it('the renderer look carries the choice, and East Asian heritage from nationality', () => {
    const look = APPEARANCE.studioToLook({ skinTone: 'medium', baseBody: 'm-brown', nationality: 'Japan' }, { skin: 2, heightCm: 180 });
    expect(look.baseBody).toBe('m-brown');
    expect(look.heritage).toBe('east-asian');
    expect(APPEARANCE.studioToLook({ baseBody: 'auto' }, { skin: 2 }).baseBody).toBeUndefined();
  });

  it('survives saving, reloading and a transfer, and changes nothing about the player', () => {
    const w = new GameWorld({ seed: 31, startCountry: 'Japan' });
    const club = w.club(), p = club.squad[0];
    const before = JSON.stringify({ a: p.attributes, ca: p.currentAbility, c: p.contractYears, w: p.weeklyWage, h: p.history });
    p.studioProfile = createProfile({ playerId: p.id, appearance: { skinTone: 'tan', baseBody: 'm-asian' } });
    expect(mergeForRenderer(p).baseBody).toBe('m-asian');
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));
    const p2 = w2.players.get(p.id);
    expect(mergeForRenderer(p2).baseBody).toBe('m-asian');
    const buyer = w2.clubs.find(c => c.id !== club.id && c.squad.length > 10);
    TR.executeTransfer(w2, p2, w2.clubById(club.id), buyer, 1_000_000, 'transfer');
    expect(mergeForRenderer(w2.players.get(p.id)).baseBody).toBe('m-asian');
    expect(JSON.stringify({ a: p.attributes, ca: p.currentAbility, c: p.contractYears, w: p.weeklyWage, h: p.history })).toBe(before);
  });

  it('players from Japan get the East Asian hint without a Studio profile', () => {
    const w = new GameWorld({ seed: 31, startCountry: 'Japan' });
    const jp = [...w.players.values()].find(x => x.nation === 'Japan' && !x.studioProfile);
    const other = [...w.players.values()].find(x => x.nation === 'Nigeria');
    expect(mergeForRenderer(jp).heritage).toBe('east-asian');
    expect(mergeForRenderer(other).heritage).toBeUndefined();
  });
});
