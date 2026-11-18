// scripts/anim/inspect.js — report on GLB files: skeleton (joints, hierarchy, root), meshes and
// skins, animation clips (duration, channels, frame rate) and root motion. Writes a JSON log.
// Usage: node scripts/anim/inspect.js <file-or-folder>... [--out report.json]
const fs = require('fs');
const path = require('path');
const { readGLB, accessor } = require('./glb');

async function inspect(file) {
  const glb = await readGLB(file);
  const j = glb.json;
  const nodes = j.nodes || [];
  const parent = new Map();
  nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
  const skins = (j.skins || []).map(s => ({ joints: s.joints.length, root: nodes[s.joints.find(x => !s.joints.includes(parent.get(x)))]?.name, names: s.joints.map(x => nodes[x].name) }));
  const meshes = (j.meshes || []).map(m => ({ name: m.name, primitives: m.primitives.map(p => ({ vertices: j.accessors[p.attributes.POSITION].count, material: p.material != null ? (j.materials[p.material] || {}).name : null, skinned: p.attributes.JOINTS_0 != null })) }));
  const anims = (j.animations || []).map(a => {
    let dur = 0, keys = 0, rootMotion = null;
    const paths = {};
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const t = accessor(glb, s.input);
      dur = Math.max(dur, t[t.length - 1] || 0); keys = Math.max(keys, t.length);
      paths[ch.target.path] = (paths[ch.target.path] || 0) + 1;
      const nd = nodes[ch.target.node];
      if (ch.target.path === 'translation' && nd && !parent.has(ch.target.node) === false && /hip|pelvis|root/i.test(nd.name)) {
        const v = accessor(glb, s.output);
        rootMotion = { bone: nd.name, dx: +(v[v.length - 3] - v[0]).toFixed(3), dy: +(v[v.length - 2] - v[1]).toFixed(3), dz: +(v[v.length - 1] - v[2]).toFixed(3) };
      }
    }
    return { name: a.name, duration: +dur.toFixed(3), fps: dur ? Math.round((keys - 1) / dur) : 0, channels: a.channels.length, paths, rootMotion };
  });
  return { file: path.basename(file), bytes: fs.statSync(file).size, asset: j.asset, nodes: nodes.length, skins, meshes, animations: anims, scale: nodes.find(n => n.scale)?.scale || null };
}

if (require.main === module) (async () => {
  const args = process.argv.slice(2), outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  const files = args.flatMap(a => fs.statSync(a).isDirectory() ? fs.readdirSync(a).filter(f => f.endsWith('.glb')).map(f => path.join(a, f)) : [a]);
  const report = [], failed = [];
  for (const f of files) { try { report.push(await inspect(f)); } catch (e) { failed.push({ file: f, error: e.message }); } }
  if (out) fs.writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), report, failed }, null, 1));
  for (const r of report) console.log(`${r.file}: ${r.meshes.length} mesh(es) ${r.meshes.map(m => m.primitives.map(p => p.vertices).join('+')).join(',')} verts; skin ${r.skins.map(s => s.joints + ' joints, root ' + s.root).join(';') || '-'}; ${r.animations.map(a => `${a.name} ${a.duration}s@${a.fps}fps ${a.channels}ch${a.rootMotion ? ` root ${a.rootMotion.dx},${a.rootMotion.dy},${a.rootMotion.dz}` : ''}`).join(' | ') || 'no animations'}`);
  for (const f of failed) console.log(`FAILED ${f.file}: ${f.error}`);
  if (failed.length) process.exitCode = 1;
})();
module.exports = { inspect };
