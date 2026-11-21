'use strict';
// Player Studio routes (shared by the Node server and the offline engine in the browser).
// The library of characters is a document in the save store; assigning a character to a player
// writes only his appearance profile (player.studioProfile) — never his id, attributes, contract,
// club, statistics or history — and saves the career. Every input is validated.
const { hashString } = require('../utils');
const { createProfile, validateProfile } = require('./profileSchema');
const { generateFromDescription, regenerate, GROUPS } = require('./characterService');
const KITS = require('./kits');

const DOC = 'player-studio-library';
const MAX_ASSETS = 300;
const MAX_DESCRIPTION = 1200;
const ASSET_ID = /^[a-zA-Z0-9_-]{1,64}$/;
let assetSequence = 0;
const newAssetId = () => `character_${hashString(`${Date.now()}:${++assetSequence}:${Math.random()}`).toString(16).padStart(8, '0')}`;
const cleanName = (v, dflt) => String(v == null || v === '' ? dflt : v).replace(/[<>]/g, '').trim().slice(0, 80) || dflt;
const bad = (error, status = 400) => ({ ok: false, status, error });

async function readLibrary(store) {
  try { const d = await store.readDoc(DOC); return d && Array.isArray(d.assets) ? d : { assets: [] }; }
  catch { return { assets: [] }; }
}
async function writeLibrary(store, doc) { await store.writeDoc(DOC, doc); }

function attachRoutes(route, store, worldFn, { save = () => {} } = {}) {
  const myPlayer = id => { const w = worldFn(); if (!w) return null; const p = w.players.get(id); return p && !p.retired ? p : null; };

  route('GET', '/api/studio/health', async () => ({ ok: true, studio: 'ready', proceduralFallback: true, aiProvider: null, model: 'models/footballer.glb', groups: Object.keys(GROUPS) }));
  route('GET', '/api/studio/library', async (m, body, q) => {
    const term = String((q && q.get && q.get('q')) || '').toLowerCase().slice(0, 60);
    const assets = (await readLibrary(store)).assets.filter(a => !term || a.name.toLowerCase().includes(term) || String(a.profile.appearance.nationality || '').toLowerCase().includes(term) || String(a.profile.appearance.position || '').toLowerCase() === term);
    return { ok: true, assets };
  });
  route('GET', /^\/api\/studio\/library\/([a-zA-Z0-9_-]+)$/, async m => {
    const asset = (await readLibrary(store)).assets.find(x => x.assetId === m[1]);
    return asset ? { ok: true, asset } : bad('asset_not_found', 404);
  });
  route('POST', '/api/studio/generate', async (m, body) => {
    if (!body || typeof body !== 'object') return bad('invalid_request');
    if (body.description != null && (typeof body.description !== 'string' || body.description.length > MAX_DESCRIPTION)) return bad('description must be text under 1200 characters');
    const doc = await readLibrary(store);
    if (doc.assets.length >= MAX_ASSETS) return bad(`The library is full (${MAX_ASSETS} characters). Delete some first.`, 409);
    const assetId = newAssetId();
    const context = { playerId: Number.isInteger(body.playerId) ? body.playerId : null, assetId, seed: typeof body.seed === 'string' ? body.seed.slice(0, 40) : undefined, nation: body.nation, position: body.position };
    let profile;
    try { profile = body.description ? generateFromDescription(body.description, context) : createProfile({ playerId: context.playerId, assetId, appearance: body.appearance || {} }); }
    catch (e) { return bad(e.message); }
    profile.assetId = assetId;
    const asset = { assetId, name: cleanName(body.name, 'Unnamed footballer'), playerId: context.playerId, profile, archived: false, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
    doc.assets.push(asset); await writeLibrary(store, doc);
    return { ok: true, asset };
  });
  route('POST', '/api/studio/preview', async (m, body) => {
    try { return { ok: true, profile: body && body.description ? generateFromDescription(String(body.description).slice(0, MAX_DESCRIPTION), { playerId: Number.isInteger(body.playerId) ? body.playerId : null, seed: body.seed }) : createProfile({ appearance: (body && body.appearance) || {} }) }; }
    catch (e) { return bad(e.message); }
  });
  // A new variation that keeps the locked feature groups (skin, face, eyes, hair, beard, body, kit).
  route('POST', '/api/studio/regenerate', async (m, body) => {
    if (!body || !body.profile) return bad('profile_required');
    const locks = Array.isArray(body.locks) ? body.locks.filter(g => GROUPS[g]) : [];
    try { const profile = regenerate(validateProfile(body.profile), locks, String(body.seed ?? Date.now()).slice(0, 40)); return { ok: true, profile }; }
    catch (e) { return bad(e.message); }
  });
  route('PUT', /^\/api\/studio\/library\/([a-zA-Z0-9_-]+)$/, async (m, body) => {
    const doc = await readLibrary(store); const i = doc.assets.findIndex(x => x.assetId === m[1]);
    if (i < 0) return bad('asset_not_found', 404);
    if (!body || !body.profile) return bad('profile_required');
    let profile; try { profile = validateProfile(body.profile); } catch (e) { return bad(e.message); }
    profile.assetId = doc.assets[i].assetId; profile.updatedAt = new Date().toISOString();
    doc.assets[i] = { ...doc.assets[i], name: body.name != null ? cleanName(body.name, doc.assets[i].name) : doc.assets[i].name, profile, updatedAt: profile.updatedAt };
    await writeLibrary(store, doc);
    // A character already worn by a player updates his look too (only his appearance).
    const pid = doc.assets[i].playerId, p = pid != null ? myPlayer(pid) : null;
    if (p && p.studioProfile && p.studioProfile.assetId === doc.assets[i].assetId) { p.studioProfile = { ...profile, playerId: pid }; save(); }
    return { ok: true, asset: doc.assets[i] };
  });
  route('POST', /^\/api\/studio\/library\/([a-zA-Z0-9_-]+)\/duplicate$/, async m => {
    const doc = await readLibrary(store); const source = doc.assets.find(x => x.assetId === m[1]);
    if (!source) return bad('asset_not_found', 404);
    if (doc.assets.length >= MAX_ASSETS) return bad(`The library is full (${MAX_ASSETS} characters).`, 409);
    const assetId = newAssetId(), now = new Date().toISOString();
    const profile = createProfile({ assetId, playerId: null, appearance: source.profile.appearance, locks: source.profile.locks || [] });
    const copy = { ...source, assetId, name: cleanName(`${source.name} copy`, 'Copy'), playerId: null, profile, archived: false, createdAt: now, updatedAt: now };
    doc.assets.push(copy); await writeLibrary(store, doc); return { ok: true, asset: copy };
  });
  route('DELETE', /^\/api\/studio\/library\/([a-zA-Z0-9_-]+)$/, async m => {
    const doc = await readLibrary(store); const i = doc.assets.findIndex(x => x.assetId === m[1]);
    if (i < 0) return bad('asset_not_found', 404);
    if (doc.assets[i].playerId != null) return bad('This character is worn by a player. Remove it from the player first.', 409);
    doc.assets.splice(i, 1); await writeLibrary(store, doc); return { ok: true };
  });
  route('POST', '/api/studio/import', async (m, body) => {
    if (!body || !body.asset || typeof body.asset !== 'object') return bad('invalid_asset');
    const doc = await readLibrary(store);
    if (doc.assets.length >= MAX_ASSETS) return bad(`The library is full (${MAX_ASSETS} characters).`, 409);
    const assetId = newAssetId(), now = new Date().toISOString();
    let profile; try { profile = validateProfile(body.asset.profile || body.asset); } catch (e) { return bad(e.message); }
    profile.assetId = assetId; profile.playerId = null; profile.updatedAt = now;
    const asset = { assetId, name: cleanName(body.asset.name, 'Imported footballer'), playerId: null, profile, archived: false, createdAt: now, updatedAt: now };
    doc.assets.push(asset); await writeLibrary(store, doc); return { ok: true, asset };
  });
  route('GET', /^\/api\/studio\/export\/([a-zA-Z0-9_-]+)$/, async m => {
    const asset = (await readLibrary(store)).assets.find(x => x.assetId === m[1]);
    return asset ? { ok: true, asset } : bad('asset_not_found', 404);
  });

  // ── the career: your players and your club's kits ──
  route('GET', '/api/studio/squad', async () => {
    const w = worldFn(); if (!w) return bad('No career in progress', 409);
    const c = w.club();
    return { ok: true, club: c.name, players: [...c.squad, ...c.youth].filter(p => !p.retired).map(p => ({ id: p.id, name: p.name, position: p.position, age: p.age, nation: p.nation, assetId: p.studioProfile ? p.studioProfile.assetId : null, youth: c.youth.includes(p) })) };
  }, { world: true });
  route('GET', /^\/api\/studio\/player\/(\d+)$/, async m => {
    const w = worldFn(); if (!w) return bad('No career in progress', 409);
    const p = w.players.get(Number(m[1])); if (!p) return bad('player_not_found', 404);
    const { mergeForRenderer } = require('./appearanceService');
    return { ok: true, playerId: p.id, name: p.name, position: p.position, nation: p.nation, age: p.age, profile: p.studioProfile || null, look: mergeForRenderer(p) };
  }, { world: true });
  route('POST', /^\/api\/studio\/player\/(\d+)\/assign$/, async (m, body) => {
    const w = worldFn(); if (!w) return bad('No career in progress', 409);
    const playerId = Number(m[1]); const p = w.players.get(playerId);
    if (!p || p.retired) return bad('player_not_found', 404);
    if (!body || typeof body.assetId !== 'string' || !ASSET_ID.test(body.assetId)) return bad('assetId_required');
    const doc = await readLibrary(store); const asset = doc.assets.find(x => x.assetId === body.assetId);
    if (!asset) return bad('asset_not_found', 404);
    let profile; try { profile = validateProfile(asset.profile); } catch (e) { return bad(e.message); }
    profile.playerId = playerId; profile.assetId = asset.assetId; profile.updatedAt = new Date().toISOString();
    // A character dresses one player at a time: free it from whoever wore it before.
    if (asset.playerId != null && asset.playerId !== playerId) { const prev = w.players.get(asset.playerId); if (prev && prev.studioProfile && prev.studioProfile.assetId === asset.assetId) delete prev.studioProfile; }
    for (const other of doc.assets) if (other !== asset && other.playerId === playerId) other.playerId = null;
    p.studioProfile = profile;                       // appearance only
    asset.playerId = playerId; asset.updatedAt = profile.updatedAt;
    await writeLibrary(store, doc);
    save();
    return { ok: true, playerId, assetId: asset.assetId, profile };
  }, { world: true });
  route('POST', /^\/api\/studio\/player\/(\d+)\/clear$/, async m => {
    const w = worldFn(); if (!w) return bad('No career in progress', 409);
    const p = w.players.get(Number(m[1])); if (!p) return bad('player_not_found', 404);
    const had = p.studioProfile ? p.studioProfile.assetId : null;
    delete p.studioProfile;
    if (had) { const doc = await readLibrary(store); const a = doc.assets.find(x => x.assetId === had); if (a && a.playerId === p.id) { a.playerId = null; await writeLibrary(store, doc); } }
    save();
    return { ok: true, playerId: p.id };
  }, { world: true });
  route('GET', '/api/studio/kits', async () => {
    const w = worldFn(); if (!w) return bad('No career in progress', 409);
    const c = w.club();
    return { ok: true, club: c.name, initials: KITS.initials(c.name), sponsor: c.sponsor ? c.sponsor.name : null, custom: !!c.kits, kits: KITS.kitsOf(c), patterns: KITS.PATTERNS };
  }, { world: true });
  route('PUT', '/api/studio/kits', async (m, body) => {
    const w = worldFn(); if (!w) return bad('No career in progress', 409);
    if (!body || typeof body !== 'object') return bad('kits required');
    try { const kits = KITS.setKits(w.club(), body); save(); return { ok: true, kits }; }
    catch (e) { return bad(e.message); }
  }, { world: true });
}

module.exports = { attachRoutes, readLibrary, MAX_ASSETS };
