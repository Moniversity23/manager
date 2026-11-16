// src/server.js — The Gaffer HTTP server (plain http module).
//
// All game endpoints live in src/api.js, shared with the offline browser engine. This file only
// serves the static app, adapts HTTP to api.handle(), and wires the save store (MongoDB first,
// gzip-file fallback, see src/saveStore.js). Errors are logged with the season and week.

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createApi } = require('./api');
const { createStore, stateHash } = require('./saveStore');

const PORT = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
const SAVE_DIR = process.env.SAVE_DIR || path.join(__dirname, '..', 'data');
const MONGODB_URI = process.env.SAVE_BACKEND === 'file' ? null : (process.env.MONGODB_URI || null);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const store = createStore({ dir: SAVE_DIR, mongoUri: MONGODB_URI });
const PUBLIC = process.env.GAFFER_PUBLIC === '1';
const api = createApi({ store, stateHash, randomSeed: () => crypto.randomInt(1, 2 ** 31), publicMode: PUBLIC });

// Save-pattern names kept from server2.js.
const connectDB = () => store.connect();
const dbSave = (slotId, gameState, meta) => store.save(slotId, gameState, meta);
const dbLoad = (slotId) => store.load(slotId);
const dbDelete = (slotId) => store.remove(slotId);
const dbListMeta = () => store.listMeta();
const { autoSave, buildMeta, tryRestoreAutoSave } = api;

function send(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const fp = path.resolve(PUBLIC_DIR, rel);
  if (!fp.startsWith(PUBLIC_DIR + path.sep) || !TYPES[path.extname(fp)]) return false;
  fs.readFile(fp, (err, data) => {
    if (err) return send(res, 404, { ok: false, error: 'not_found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)], 'Cache-Control': rel.startsWith('vendor/') ? 'public, max-age=604800' : 'no-cache' });
    res.end(data);
  });
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 60e6) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (!url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && serveStatic(res, url.pathname)) return;
    return send(res, 404, { ok: false, error: 'not_found' });
  }
  let body = {};
  try { if (req.method === 'POST') body = await parseBody(req); }
  catch (e) { return send(res, 400, { ok: false, error: e.message }); }
  const t0 = Date.now();
  const { status, payload } = await api.handle(req.method, url.pathname, url.searchParams, body);
  send(res, status, payload);
  const ms = Date.now() - t0;
  if (ms > 2500) console.warn(`[slow] ${req.method} ${url.pathname} took ${ms} ms`);
});

async function shutdown(signal) {
  console.log(`\n${signal}: saving before exit…`);
  try { await autoSave(); await store.flush(); } catch (e) { console.error('[shutdown]', e); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  if (!PUBLIC) { await connectDB(); await tryRestoreAutoSave(); }
  server.listen(PORT, () => {
    const port = server.address().port;
    console.log(`🏟  The Gaffer running at http://localhost:${port}  (saves: ${store.backend()} · dir ${SAVE_DIR})`);
    console.log(`LISTENING ${port}`);
  });
})();

module.exports = { server, autoSave, buildMeta, tryRestoreAutoSave, connectDB, dbSave, dbLoad, dbDelete, dbListMeta };
