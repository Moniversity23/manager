// scripts/anim/extract-ara.js — takes the football clips out of a character exported by Ara 3D Gen
// (MIT code; MakeHuman CC0 body; its football clips are Ara's own keyframed animation) and keeps
// them, on Ara's own skeleton, in assets/animations/source/ara3dgen/football-clips.json:
//   rest   every kept joint's parent and rest translation/rotation (the A-pose the clips start from)
//   clips  each clip resampled at 30 fps: a rotation per joint per frame, the hips' translation,
//          and the moment the foot, head or hands meet the ball (Ara's documented contact times)
// Fingers barely move in these clips, so each finger joint keeps one pose per clip (its pose in the
// middle of the clip). The 32 MB character file itself stays outside the repository; this file is
// what build-footballer.js retargets onto the Gaffer's skeleton (scripts/anim/retarget.js).
// Usage: node scripts/anim/extract-ara.js [character.glb]
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const { readGLB, accessor } = require('./glb');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_SRC = path.join(ROOT, 'FOOTBALL-RALISM-LAB', 'outputs', 'footballer-models', 'Kofi_Mensah.glb');
const OUT = path.join(ROOT, 'assets', 'animations', 'source', 'ara3dgen', 'football-clips.json');
const FPS = 30;

// Game key → Ara clip name, and the contact moment (seconds) documented in Ara's docs/animations.md.
const CLIPS = {
  shoot: { name: 'Shoot (football)', contact: 0.3, part: 'footR' },
  passA: { name: 'Pass (straight)', contact: 0.22, part: 'footR' },
  passL: { name: 'Side pass left (inside foot)', contact: 0.24, part: 'footR' },
  passIn: { name: 'Side pass forward (inside foot)', contact: 0.24, part: 'footR' },
  passR: { name: 'Side pass right (inside foot)', contact: 0.24, part: 'footR' },
  receive: { name: 'Receive ball (inside foot)', contact: 0.2, part: 'footR' },
  chestCtl: { name: 'Chest control', contact: 0.25, part: 'chest' },
  headerA: { name: 'Header', contact: 0.3, part: 'head' },
  headerJump: { name: 'Jumping header', contact: 0.48, part: 'head' },
  tackleA: { name: 'Standing tackle', contact: 0.28, part: 'footR' },
  slideA: { name: 'Slide tackle', contact: 0.45, part: 'footR' },
  gkReady: { name: 'Goalkeeper ready', loop: true },
  gkCatch: { name: 'Goalkeeper catch', contact: 0.35, part: 'hands' },
  gkPunch: { name: 'Goalkeeper punch', contact: 0.26, part: 'hands' },
  gkDiveL: { name: 'Goalkeeper dive left', contact: 0.45, part: 'hands' },
  gkDiveR: { name: 'Goalkeeper dive right', contact: 0.45, part: 'hands' },
  gkLowL: { name: 'Goalkeeper low dive left', contact: 0.45, part: 'hands' },
  gkLowR: { name: 'Goalkeeper low dive right', contact: 0.45, part: 'hands' },
  gkPick: { name: 'Pick up ball', contact: 0.7, part: 'hands' },
  gkThrow: { name: 'Two-hand throw forward', contact: 0.62, part: 'hands' },
  gkRoll: { name: 'Low throw (right hand)', contact: 0.72, part: 'hands' },
  throwIn: { name: 'Throw-in (overhead)', contact: 0.8, part: 'hands' },
  celJump: { name: 'Siu celebration' },
};
const FINGER = /Hand(Thumb|Index|Middle|Ring|Pinky)\d$/;
const KEEP = /^(Hips|Spine\d?|Neck|Head|HeadTop_End|(Left|Right)(Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase|Toe_End|Hand(Thumb|Index|Middle|Ring|Pinky)[1-4]))$/;
const r4 = v => Math.round(v * 1e4) / 1e4;

function sampler(g, s, size) {
  const times = accessor(g, s.input), vals = accessor(g, s.output);
  return t => {
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    const j = Math.min(i + 1, times.length - 1);
    const k = j === i || times[j] === times[i] ? 0 : Math.max(0, Math.min(1, (t - times[i]) / (times[j] - times[i])));
    const out = new Array(size);
    if (size === 4) THREE.Quaternion.slerpFlat(out, 0, vals, i * 4, vals, j * 4, k);
    else for (let c = 0; c < size; c++) out[c] = vals[i * size + c] + (vals[j * size + c] - vals[i * size + c]) * k;
    return out;
  };
}

async function main(file) {
  const g = await readGLB(file);
  const nodes = g.json.nodes;
  const parent = new Map(); nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
  const kept = nodes.map((n, i) => i).filter(i => KEEP.test(nodes[i].name));
  const rest = {};
  for (const i of kept) {
    const n = nodes[i], p = parent.get(i);
    rest[n.name] = { parent: p != null && KEEP.test(nodes[p].name) ? nodes[p].name : null, t: (n.translation || [0, 0, 0]).map(r4), r: (n.rotation || [0, 0, 0, 1]).map(r4) };
  }
  const byName = new Map((g.json.animations || []).map(a => [a.name, a]));
  const clips = {};
  for (const [key, def] of Object.entries(CLIPS)) {
    const a = byName.get(def.name);
    if (!a) throw new Error(`clip not found in ${path.basename(file)}: ${def.name}`);
    let dur = 0;
    const ch = {};
    for (const c of a.channels) {
      const n = nodes[c.target.node];
      if (!n || !KEEP.test(n.name) || c.target.path === 'scale' || c.target.path === 'weights') continue;
      if (c.target.path === 'translation' && n.name !== 'Hips') continue;
      const s = a.samplers[c.sampler];
      const times = accessor(g, s.input);
      dur = Math.max(dur, times[times.length - 1]);
      (ch[n.name] = ch[n.name] || {})[c.target.path] = sampler(g, s, c.target.path === 'rotation' ? 4 : 3);
    }
    const frames = Math.max(2, Math.round(dur * FPS) + 1);
    const tracks = {};
    for (const [bone, paths] of Object.entries(ch)) {
      const tr = {};
      if (paths.rotation) {
        if (FINGER.test(bone)) tr.r = paths.rotation(dur / 2).map(r4);
        else { const v = []; for (let f = 0; f < frames; f++) v.push(...paths.rotation(Math.min(dur, f / FPS)).map(r4)); tr.r = v; }
      }
      if (paths.translation) { const v = []; for (let f = 0; f < frames; f++) v.push(...paths.translation(Math.min(dur, f / FPS)).map(r4)); tr.t = v; }
      tracks[bone] = tr;
    }
    clips[key] = { name: def.name, duration: r4(dur), frames, loop: !!def.loop, ...(def.contact != null ? { contact: def.contact, part: def.part } : {}), tracks };
  }
  const out = {
    source: {
      tool: 'Ara 3D Gen 0.14.0 (https://github.com/olatunde85/3d-gen, commit 76d4e13; MIT)',
      file: path.basename(file),
      licence: 'Code MIT (c) 2026 Joshua Olatunde and Ara 3D Gen contributors. Character data: MakeHuman, CC0 1.0. The football clips are Ara\'s own keyframed animation; exported characters may be used commercially without attribution.',
      skeleton: 'Ara game rig (Mixamo-style names), A-pose rest',
      fps: FPS,
    },
    rest, clips,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`${path.relative(ROOT, OUT)}: ${Object.keys(clips).length} clips, ${Object.keys(rest).length} joints, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
}

main(process.argv[2] || DEFAULT_SRC).catch(e => { console.error(e.message); process.exit(1); });
