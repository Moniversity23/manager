// The motion-capture pipeline output: the processed mannequin and clips the 3D view loads.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { readGLB, accessor } = require('../scripts/anim/glb');

const MODELS = path.join(__dirname, '..', 'public', 'models');
const NEEDED = ['idle', 'walk', 'jog', 'sprint', 'back', 'strafeL', 'strafeR', 'kickFront', 'kickSide', 'slide', 'header', 'diveL', 'diveR', 'block', 'celFist', 'celVictory', 'celFlip', 'celDab', 'clap', 'tired', 'fall', 'getUp', 'call', 'angry', 'reject'];

describe('motion-captured footballer assets', () => {
  it('ships a skinned mannequin split into kit regions', async () => {
    const g = await readGLB(path.join(MODELS, 'footballer.glb'));
    const j = g.json;
    expect(j.extensionsRequired || []).toEqual([]);                       // loads without extra decoders
    expect(j.skins[0].joints.length).toBe(66);
    const regions = j.meshes[0].primitives.map(p => j.materials[p.material].name).sort();
    expect(regions).toEqual(['boots', 'hands', 'head', 'shirt', 'shorts', 'skin', 'socks']);
    for (const p of j.meshes[0].primitives) expect(j.accessors[p.indices].count).toBeGreaterThan(30);
    const pos = accessor(g, j.meshes[0].primitives[0].attributes.POSITION);
    let top = 0; for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
    expect(top).toBeGreaterThan(1.7); expect(top).toBeLessThan(2);           // a person-sized figure
  });

  it('has every clip the match needs, bound to bones that exist, with kick contact times', async () => {
    const g = await readGLB(path.join(MODELS, 'footballer.glb'));
    const bones = new Set(g.json.nodes.map(n => n.name));
    const anims = JSON.parse(fs.readFileSync(path.join(MODELS, 'footballer-anims.json'), 'utf8'));
    for (const k of NEEDED) expect(anims.clips[k], k).toBeTruthy();
    for (const [k, c] of Object.entries(anims.clips)) {
      expect(c.duration, k).toBeGreaterThan(0.2);
      for (const t of c.tracks) {
        expect(bones.has(t.name.split('.')[0]), `${k}: ${t.name}`).toBe(true);
        expect(t.values.length).toBe(t.times.length * (t.type === 'quaternion' ? 4 : 3));
        expect(t.values.every(Number.isFinite)).toBe(true);
      }
      expect(c.tracks.some(t => t.times.length > 1), `${k} moves`).toBe(true);
    }
    for (const k of ['kickFront', 'kickSide']) {
      expect(anims.clips[k].contact).toBeGreaterThan(0.1);
      expect(anims.clips[k].contact).toBeLessThan(anims.clips[k].duration);
      expect(['l', 'r']).toContain(anims.clips[k].foot);
    }
  });

  it('records the licence of every source asset', () => {
    const reg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'animations', 'licenses', 'REGISTER.md'), 'utf8');
    const src = path.join(__dirname, '..', 'assets', 'animations', 'source', 'mesh2motion', 'animations');
    for (const f of fs.readdirSync(src)) expect(reg.includes(f), f).toBe(true);
    expect(reg).toMatch(/CC0 1\.0/);
    expect(fs.existsSync(path.join(__dirname, '..', 'assets', 'animations', 'licenses', 'mesh2motion-LICENSE-CC0.MD'))).toBe(true);
  });
});
