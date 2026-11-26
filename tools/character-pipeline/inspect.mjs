// Reports what a character GLB contains: meshes, primitives, materials, textures (size and bytes),
// UV ranges, morph targets, skins and animations. Usage: node inspect.mjs file.glb [--json]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';

export async function readDoc(file) {
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  return { io, doc: await io.read(file) };
}

export function stats(doc, bytes = null) {
  const root = doc.getRoot();
  let tris = 0, verts = 0, prims = 0, morphs = 0;
  const seen = new Set();
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    prims++;
    const idx = p.getIndices(), pos = p.getAttribute('POSITION');
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    if (!seen.has(pos)) { seen.add(pos); verts += pos.getCount(); }
    morphs = Math.max(morphs, p.listTargets().length);
  }
  const textures = root.listTextures().map(t => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage() ? t.getImage().byteLength : 0 }));
  return {
    bytes, triangles: Math.round(tris), vertices: verts, primitives: prims, materials: root.listMaterials().length, morphTargets: morphs,
    textures: textures.length, textureBytes: textures.reduce((s, t) => s + t.bytes, 0), joints: root.listSkins().reduce((s, k) => s + k.listJoints().length, 0),
    animations: root.listAnimations().length,
  };
}

if (process.argv[1] && process.argv[1].endsWith('inspect.mjs')) {
  const file = process.argv[2];
  const { doc } = await readDoc(file);
  const root = doc.getRoot();
  console.log(JSON.stringify(stats(doc, fs.statSync(file).size)));
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial(), uv = p.getAttribute('TEXCOORD_0');
    let r = null;
    if (uv) { const a = uv.getArray(); let mn = [9, 9], mx = [-9, -9]; for (let i = 0; i < a.length; i += 2) { mn = [Math.min(mn[0], a[i]), Math.min(mn[1], a[i + 1])]; mx = [Math.max(mx[0], a[i]), Math.max(mx[1], a[i + 1])]; } r = [mn.map(v => +v.toFixed(2)), mx.map(v => +v.toFixed(2))]; }
    const tex = m && m.getBaseColorTexture();
    const idx = p.getIndices();
    console.log(`  ${mesh.getName()} | ${m ? m.getName() : '-'} | tris ${idx ? idx.getCount() / 3 : '?'} | colour ${m ? m.getBaseColorFactor().map(v => +v.toFixed(2)).join(',') : ''} | tex ${tex ? tex.getSize().join('x') + ' ' + Math.round(tex.getImage().byteLength / 1024) + 'KB ' + tex.getMimeType() : '-'} | normal ${m && m.getNormalTexture() ? m.getNormalTexture().getSize().join('x') : '-'} | alpha ${m ? m.getAlphaMode() : ''} | uv ${JSON.stringify(r)} | attrs ${p.listSemantics().join(',')}`);
  }
}
