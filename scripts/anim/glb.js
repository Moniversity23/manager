// scripts/anim/glb.js — a small GLB (binary glTF 2.0) reader and writer for the animation
// pipeline: read JSON + BIN, decode meshopt-compressed buffer views (EXT_meshopt_compression,
// using the MIT-licensed decoder that ships with three.js), read accessors as Float32Arrays, and
// write a GLB back.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
let decoder = null;
async function meshopt() {
  if (decoder) return decoder;
  const file = path.join(__dirname, '..', '..', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'meshopt_decoder.module.js');
  const mod = await import(pathToFileURL(file).href);
  decoder = mod.MeshoptDecoder;
  await decoder.ready;
  return decoder;
}

async function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${path.basename(file)}: not a GLB file`);
  if (buf.readUInt32LE(4) !== 2) throw new Error(`${path.basename(file)}: only glTF 2.0 is supported`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = Buffer.from(chunk);
    off += 8 + len;
  }
  if (!json) throw new Error(`${path.basename(file)}: no JSON chunk`);
  if ((json.buffers || []).some((b, i) => b.uri && !(b.extensions && b.extensions.EXT_meshopt_compression))) throw new Error(`${path.basename(file)}: external buffers are not supported`);
  // Decode every buffer view into its own byte array.
  const views = [];
  for (const [i, bv] of (json.bufferViews || []).entries()) {
    const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
    if (ext) {
      const d = await meshopt();
      const src = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength);
      const out = new Uint8Array(ext.count * ext.byteStride);
      d.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter || 'NONE');
      views[i] = { bytes: out, stride: ext.byteStride };
    } else views[i] = { bytes: new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength), stride: bv.byteStride || 0 };
  }
  return { file, json, bin, views };
}

// Accessor → Float32Array (handles byteStride and normalised integers).
function accessor(glb, index) {
  const a = glb.json.accessors[index];
  const n = SIZE[a.type], bytes = BYTES[a.componentType];
  const out = new Float32Array(a.count * n);
  if (a.bufferView == null) return out;
  const v = glb.views[a.bufferView];
  const dv = new DataView(v.bytes.buffer, v.bytes.byteOffset, v.bytes.byteLength);
  const stride = v.stride || n * bytes;
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
    let x = dv[get]((a.byteOffset || 0) + i * stride + k * bytes, true);
    if (norm) x = Math.max(x / norm, -1);
    out[i * n + k] = x;
  }
  return out;
}

function writeGLB(file, json, bin) {
  const pad = (b, fill) => { const r = (4 - (b.length % 4)) % 4; return r ? Buffer.concat([b, Buffer.alloc(r, fill)]) : b; };
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const b = bin ? pad(bin, 0) : null;
  const total = 12 + 8 + j.length + (b ? 8 + b.length : 0);
  const head = Buffer.alloc(12); head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const parts = [head, jh, j];
  if (b) { const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4); parts.push(bh, b); }
  fs.writeFileSync(file, Buffer.concat(parts));
}

module.exports = { readGLB, accessor, writeGLB, SIZE };
