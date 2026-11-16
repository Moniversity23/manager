// src/saveStore.js — MongoDB first, gzip JSON files as fallback (server2.js pattern).
//
//  • Saves are gzipped JSON. Files are written to a temp file and renamed, so a crash mid-write
//    never leaves a half-written save.
//  • The auto slot keeps 3 generations (auto, auto.1, auto.2). If the newest is corrupt the loader
//    falls back to the previous generation and reports it.
//  • Legacy uncompressed saves (<slot>.json, Mongo docs with a gameState object) still load.
//  • Writes are serialised through a promise chain so two saves never interleave.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const SLOTS = ['auto', 'slot_1', 'slot_2', 'slot_3'];
const AUTO_GENERATIONS = 3;

function encode(obj) { return zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf-8'), { level: 3 }); } // level 3: 2× faster than 6, still < 2 MB
function decode(buf) { return JSON.parse(zlib.gunzipSync(buf).toString('utf-8')); }
// Canonical JSON (sorted keys) so the hash depends on content, never on key order.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
function stateHash(gameState) { return crypto.createHash('sha256').update(canonical(JSON.parse(JSON.stringify(gameState)))).digest('hex'); }

function createStore({ dir, mongoUri, dbName = 'thegaffer', log = console }) {
  let collection = null;
  let chain = Promise.resolve();
  const filePath = (id) => path.join(dir, `${id}.json.gz`);
  const legacyPath = (id) => path.join(dir, `${id}.json`);

  async function connect() {
    if (!mongoUri) return false;
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
      await client.connect();
      collection = client.db(dbName).collection('saves');
      await collection.createIndex({ updatedAt: -1 });
      log.log('✓ MongoDB connected');
      return true;
    } catch (e) {
      log.warn('MongoDB unavailable, using file fallback:', e.message);
      collection = null;
      return false;
    }
  }

  function writeFileAtomic(fp, buf) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = `${fp}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, fp);
  }

  function rotateAutoFiles() {
    for (let g = AUTO_GENERATIONS - 1; g >= 1; g--) {
      const from = filePath(g === 1 ? 'auto' : `auto.${g - 1}`);
      const to = filePath(`auto.${g}`);
      if (fs.existsSync(from)) fs.copyFileSync(from, to);
    }
  }

  async function saveNow(slotId, gameState, meta) {
    const payload = { gameState, meta, updatedAt: new Date().toISOString() };
    const buf = encode(payload);
    if (collection) {
      try {
        if (slotId === 'auto') {
          for (let g = AUTO_GENERATIONS - 1; g >= 1; g--) {
            const prev = await collection.findOne({ _id: g === 1 ? 'auto' : `auto.${g - 1}` });
            if (prev) { prev._id = `auto.${g}`; await collection.replaceOne({ _id: prev._id }, prev, { upsert: true }); }
          }
        }
        await collection.replaceOne({ _id: slotId }, { _id: slotId, gz: buf, meta, v: gameState._v, updatedAt: new Date() }, { upsert: true });
        return { ok: true, bytes: buf.length, backend: 'mongo' };
      } catch (e) { log.error(`[save ${slotId}] mongo error, falling back to file:`, e.message); }
    }
    if (slotId === 'auto') rotateAutoFiles();
    writeFileAtomic(filePath(slotId), buf);
    return { ok: true, bytes: buf.length, backend: 'file' };
  }

  function save(slotId, gameState, meta) {
    const p = chain.then(() => saveNow(slotId, gameState, meta));
    chain = p.catch(e => log.error(`[save ${slotId}]`, e.message));
    return p;
  }

  async function readOne(id) {
    if (collection) {
      try {
        const doc = await collection.findOne({ _id: id });
        if (doc) {
          if (doc.gz) return decode(Buffer.from(doc.gz.buffer || doc.gz));
          if (doc.gameState) return { gameState: doc.gameState, meta: doc.meta, updatedAt: doc.updatedAt };
        }
      } catch (e) { log.error(`[load ${id}] mongo:`, e.message); }
    }
    if (fs.existsSync(filePath(id))) return decode(fs.readFileSync(filePath(id)));
    if (fs.existsSync(legacyPath(id))) return JSON.parse(fs.readFileSync(legacyPath(id), 'utf-8'));
    return null;
  }

  // Loads a slot. For the auto slot, a corrupt newest generation falls back to older ones.
  async function load(slotId) {
    const ids = slotId === 'auto' ? ['auto', ...Array.from({ length: AUTO_GENERATIONS - 1 }, (_, i) => `auto.${i + 1}`)] : [slotId];
    const errors = [];
    for (const id of ids) {
      try {
        const doc = await readOne(id);
        if (doc && doc.gameState) return { ...doc, loadedFrom: id, recovered: id !== slotId, errors };
      } catch (e) { errors.push(`${id}: ${e.message}`); }
    }
    return errors.length ? { gameState: null, errors } : null;
  }

  async function backup(slotId, rawGameState, version) {
    const id = `${slotId}.v${version}.backup`;
    if (collection) {
      try { if (!(await collection.findOne({ _id: id }, { projection: { _id: 1 } }))) await collection.insertOne({ _id: id, gz: encode({ gameState: rawGameState }), updatedAt: new Date() }); return; }
      catch (e) { log.error(`[backup ${id}]`, e.message); }
    }
    if (!fs.existsSync(filePath(id))) writeFileAtomic(filePath(id), encode({ gameState: rawGameState }));
  }

  async function remove(slotId) {
    if (collection) { try { await collection.deleteOne({ _id: slotId }); } catch (e) { log.error(`[delete ${slotId}]`, e.message); } }
    for (const fp of [filePath(slotId), legacyPath(slotId)]) if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return true;
  }

  async function listMeta() {
    const out = {};
    for (const id of SLOTS) {
      try {
        if (collection) {
          const doc = await collection.findOne({ _id: id }, { projection: { meta: 1, updatedAt: 1 } });
          if (doc) { out[id] = { meta: doc.meta, updatedAt: doc.updatedAt }; continue; }
        }
        const doc = await readOne(id);
        out[id] = doc ? { meta: doc.meta, updatedAt: doc.updatedAt || null } : null;
      } catch (e) { out[id] = { meta: null, corrupt: true, error: e.message }; }
    }
    return out;
  }

  // Small shared documents (the leaderboard), stored next to the saves.
  async function readDoc(name) {
    if (collection) { try { const d = await collection.findOne({ _id: `doc:${name}` }); if (d) return d.doc; } catch (e) { log.error(`[doc ${name}]`, e.message); } }
    const fp = path.join(dir, `${name}.json`);
    return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf-8')) : null;
  }
  async function writeDoc(name, doc) {
    if (collection) { try { await collection.replaceOne({ _id: `doc:${name}` }, { _id: `doc:${name}`, doc, updatedAt: new Date() }, { upsert: true }); return; } catch (e) { log.error(`[doc ${name}]`, e.message); } }
    writeFileAtomic(path.join(dir, `${name}.json`), Buffer.from(JSON.stringify(doc), 'utf-8'));
  }

  return { connect, save, load, backup, remove, listMeta, readDoc, writeDoc, flush: () => chain, backend: () => (collection ? 'mongo' : 'file'), filePath };
}

module.exports = { createStore, encode, decode, stateHash, SLOTS };
