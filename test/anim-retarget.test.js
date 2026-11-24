// The football clips taken from Ara 3D Gen are retargeted onto the Gaffer's skeleton
// (scripts/anim/retarget.js). These tests prove the transfer on the clips that actually ship.
import { describe, it, expect } from 'vitest';
const THREE = require('three');
const path = require('path');
const RT = require('../scripts/anim/retarget.js');
const { readGLB } = require('../scripts/anim/glb.js');
const SRC = require('../assets/animations/source/ara3dgen/football-clips.json');
const SHIPPED = require('../public/models/footballer-anims.json');

let target = null;
const rig = async () => target || (target = RT.restFromGLB((await readGLB(path.join(__dirname, '..', 'assets', 'animations', 'source', 'mesh2motion', 'model.glb'))).json));

describe('Ara 3D Gen clips on the Gaffer skeleton', () => {
  it('every source joint has a counterpart in the Gaffer skeleton', async () => {
    const tgt = await rig();
    const missing = Object.keys(SRC.rest).filter(n => !RT.MIXAMO_TO_M2M[n] || !tgt[RT.MIXAMO_TO_M2M[n]]);
    expect(missing).toEqual([]);
    expect(Object.keys(SRC.rest)).toHaveLength(65);
  });

  it('every shipped clip only animates joints of the Gaffer skeleton', async () => {
    const tgt = await rig();
    const ara = Object.values(SHIPPED.clips).filter(c => c.src === 'ara');
    expect(ara.length).toBe(Object.keys(SRC.clips).length);
    for (const c of ara) for (const t of c.tracks) expect(tgt[t.name.split('.')[0]], `${c.name}: ${t.name}`).toBeTruthy();
  });

  it('each shipped clip moves every limb within 1° of the source animation, frame by frame', async () => {
    const tgt = await rig();
    for (const [key, c] of Object.entries(SRC.clips)) {
      const r = RT.checkClip(SRC.rest, c, tgt, SHIPPED.clips[key]);
      expect(r.worst, key).toBeLessThan(1);
    }
  });

  it('kicks reach the ball in front of the body at their contact time', async () => {
    const tgt = await rig();
    for (const key of ['shoot', 'passA', 'passIn', 'tackleA']) {
      const json = SHIPPED.clips[key];
      expect(json.contact, key).toBeGreaterThan(0);
      const bones = {}, order = [];
      const seen = new Set(), visit = n => { if (seen.has(n)) return; if (tgt[n].parent) visit(tgt[n].parent); seen.add(n); order.push(n); };
      Object.keys(tgt).forEach(visit);
      for (const n of order) { const b = new THREE.Bone(); b.name = n; b.position.fromArray(tgt[n].t); b.quaternion.fromArray(tgt[n].r); bones[n] = b; if (tgt[n].parent) bones[tgt[n].parent].add(b); }
      const root = new THREE.Group(); root.add(bones.root);
      const mixer = new THREE.AnimationMixer(root);
      const act = mixer.clipAction(THREE.AnimationClip.parse(json)); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.play();
      mixer.setTime(json.contact); root.updateMatrixWorld(true);
      const foot = new THREE.Vector3().setFromMatrixPosition(bones.ball_r.matrixWorld), hips = new THREE.Vector3().setFromMatrixPosition(bones.pelvis.matrixWorld);
      expect(foot.z - hips.z, `${key}: kicking foot ahead of the hips`).toBeGreaterThan(0.05);
      expect(foot.y, `${key}: kicking foot near the ground`).toBeLessThan(0.45);
    }
  });

  it('the build keeps the original Mesh2Motion clips and adds the new ones under their own names', () => {
    for (const k of ['idle', 'walk', 'jog', 'sprint', 'kickFront', 'kickSide', 'diveL', 'diveR', 'celFist']) expect(SHIPPED.clips[k], k).toBeTruthy();
    for (const k of ['shoot', 'passIn', 'receive', 'chestCtl', 'headerA', 'tackleA', 'gkCatch', 'gkPunch', 'gkDiveL', 'gkLowR', 'throwIn', 'celJump']) {
      expect(SHIPPED.clips[k], k).toBeTruthy();
      expect(SHIPPED.clips[k].src).toBe('ara');
    }
    expect(SHIPPED.source).toMatch(/Ara 3D Gen/);
  });
});
