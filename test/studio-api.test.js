// Player Studio in the career: appearance only ever changes how a player looks. Covers the legacy
// fallback, the Studio merge, missing/corrupt profiles, a missing library asset, save/load stability,
// id/attribute/contract/statistics preservation, transfers, youth players, match line-ups, the
// library routes, input validation and club kits.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');
const { createApi } = require('../src/api.js');
const { stateHash } = require('../src/saveStore.js');
const { mergeForRenderer } = require('../src/studio/appearanceService');
const { createProfile, validateProfile } = require('../src/studio/profileSchema');
const TR = require('../src/engine/transferEngine');

function memStore() {
  const slots = {}, docs = {};
  return {
    async save(slot, gameState, meta) { slots[slot] = { gameState: JSON.parse(JSON.stringify(gameState)), meta }; return { ok: true }; },
    async load(slot) { return slots[slot] ? { gameState: JSON.parse(JSON.stringify(slots[slot].gameState)) } : null; },
    async backup() {}, async remove(slot) { delete slots[slot]; }, async listMeta() { return Object.keys(slots).map(id => ({ id })); },
    async readDoc(n) { return docs[n] ? JSON.parse(JSON.stringify(docs[n])) : null; }, async writeDoc(n, d) { docs[n] = JSON.parse(JSON.stringify(d)); },
    backend: () => 'memory', flush: async () => {}, slots, docs,
  };
}
async function career(seed = 31) {
  const store = memStore();
  const api = createApi({ store, stateHash, randomSeed: () => seed, log: { log() {}, error() {} } });
  const call = async (m, path, body) => { const u = new URL(path, 'http://x'); return (await api.handle(m, u.pathname, u.searchParams, body)).payload; };
  await call('POST', '/api/reset', { country: 'England', mode: 'existing', clubName: GameWorld.setupClubs().England.clubs[4] });
  return { api, call, store, world: () => api.getWorld() };
}
const footballSnapshot = p => JSON.stringify({ id: p.id, name: p.name, age: p.age, position: p.position, attributes: p.attributes, currentAbility: p.currentAbility, hiddenPotential: p.hiddenPotential,
  contractYears: p.contractYears, weeklyWage: p.weeklyWage, clubId: p.clubId, history: p.history, seasonStats: p.seasonStats, career: p.career, moves: p.moves, honours: p.honours, look: p.look });

describe('Player Studio — appearance merge for the renderer', () => {
  const w = new GameWorld({ seed: 9, startCountry: 'Nigeria' });
  const p = w.club().squad[0];

  it('without a Studio profile the legacy look is used (and every player has one)', () => {
    const look = mergeForRenderer(p);
    expect(look.skin).toBeTypeOf('number');
    expect(look.hairStyle).toBeTypeOf('string');
    expect(look.faceSeed).toBe(p.id);                    // his own face, the same every match
    expect(look.face).toBeUndefined();
  });

  it('a Studio profile overrides only what it sets, mapped to the renderer', () => {
    const q = { ...p, studioProfile: createProfile({ playerId: p.id, assetId: 'character_t1', appearance: { skinTone: 'very-dark', hairStyle: 'short-curly-fade', beardStyle: 'chin-strap', eyebrowShape: 'thick', heightCm: 191, weightKg: 90, jaw: 0.9, legLength: 0.8, muscularity: 0.9 } }) };
    const look = mergeForRenderer(q);
    expect(look.skin).toBe(7);
    expect(look.hairStyle).toBe('fade');
    expect(look.beardStyle).toBe('chin strap');
    expect(look.brows).toBe(3);
    expect(look.heightCm).toBe(191);
    expect(look.height).toBe(26);
    expect(look.face.jaw).toBe(0.9);
    expect(look.body.legs).toBe(0.8);
    expect(look.build).toBeGreaterThanOrEqual(12);
    expect(look.studioAssetId).toBe('character_t1');
  });

  it('a missing, corrupt or unsupported profile never breaks the look', () => {
    const legacy = mergeForRenderer(p);
    for (const bad of [null, 'nonsense', { schemaVersion: 2, appearance: { skinTone: 'dark' } }, { schemaVersion: 1 }, { schemaVersion: 1, appearance: 'x' },
      { schemaVersion: 1, appearance: { skinTone: 'purple', heightCm: 'tall', jaw: 'wide', hairStyle: 42 } }]) {
      const look = mergeForRenderer({ ...p, studioProfile: bad });
      expect(look.skin).toBe(legacy.skin);
      expect(look.hairStyle).toBe(legacy.hairStyle);
      expect(look.heightCm).toBe(legacy.heightCm);
    }
    expect(() => validateProfile({ schemaVersion: 1, appearance: { skinTone: 'purple' } })).toThrow(/skinTone/);
    expect(() => validateProfile({ schemaVersion: 1, appearance: { heightCm: 400 } })).toThrow(/heightCm/);
    const cleaned = validateProfile({ schemaVersion: 1, appearance: { heightCm: 180, evil: '<script>', kit: { primary: '#ff0000' } }, extra: 'x' });
    expect(cleaned.appearance.evil).toBeUndefined();
    expect(cleaned.extra).toBeUndefined();
  });

  it('a profile whose library asset no longer exists still renders from the profile itself', () => {
    const q = { ...p, studioProfile: createProfile({ playerId: p.id, assetId: 'character_gone', appearance: { skinTone: 'tan' } }) };
    expect(mergeForRenderer(q).skin).toBe(3);
  });
});

describe('Player Studio — in a career', () => {
  it('assigning a look changes only the appearance; ids, attributes, contract and records are untouched', async () => {
    const { call, world } = await career();
    const p = world().club().squad[3];
    const before = footballSnapshot(p);
    const gen = await call('POST', '/api/studio/generate', { name: 'Test', description: 'a 19-year-old Brazilian winger, 176 cm, brown skin, curly hair, full beard' });
    expect(gen.ok).toBe(true);
    const r = await call('POST', `/api/studio/player/${p.id}/assign`, { assetId: gen.asset.assetId });
    expect(r.ok).toBe(true);
    expect(footballSnapshot(p)).toBe(before);
    expect(p.studioProfile.assetId).toBe(gen.asset.assetId);
    expect(mergeForRenderer(p).beardStyle).toBe('full');
    // The library knows who wears it, and it cannot be deleted while he does.
    expect((await call('DELETE', `/api/studio/library/${gen.asset.assetId}`)).ok).toBe(false);
    // Back to his own look.
    expect((await call('POST', `/api/studio/player/${p.id}/clear`, {})).ok).toBe(true);
    expect(p.studioProfile).toBeUndefined();
    expect(footballSnapshot(p)).toBe(before);
  });

  it('the look survives save and load exactly, and the match line-up carries it', async () => {
    const { call, world } = await career(32);
    const p = world().club().squad[0];
    const gen = await call('POST', '/api/studio/generate', { name: 'Keeper', appearance: { skinTone: 'light', hairStyle: 'bald', heightCm: 195, beardStyle: 'goatee' } });
    await call('POST', `/api/studio/player/${p.id}/assign`, { assetId: gen.asset.assetId });
    const look1 = JSON.stringify(mergeForRenderer(p));
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(world().toSave())));
    const p2 = w2.players.get(p.id);
    expect(JSON.stringify(mergeForRenderer(p2))).toBe(look1);
    expect(p2.id).toBe(p.id);
    // Saved and loaded through the API too.
    await call('POST', '/api/autosave', {});
    expect((await call('POST', '/api/load/auto', {})).ok).toBe(true);
    expect(JSON.stringify(mergeForRenderer(world().players.get(p.id)))).toBe(look1);
    // Line-ups for a match include his Studio look; the others keep theirs.
    let out; do { out = world().stepWeek({}); } while (!world().lastMatch);
    const lu = world().lastMatch.lineups;
    const all = [...lu.home, ...lu.away];
    const mine = all.find(x => x.playerId === p.id);
    if (mine) { expect(mine.look.skin).toBe(1); expect(mine.look.hairStyle).toBe('bald'); expect(mine.look.studioAssetId).toBe(gen.asset.assetId); }
    for (const x of all) { expect(x.look).toBeTruthy(); expect(typeof x.rt).toBe('number'); }
  });

  it('a transfer keeps his look; youth players get looks of their own and can be dressed', async () => {
    const { call, world } = await career(33);
    const w = world(), me = w.club();
    const p = me.squad.find(x => x.position !== 'GK');
    const gen = await call('POST', '/api/studio/generate', { name: 'Mover', appearance: { skinTone: 'dark', hairStyle: 'afro' } });
    await call('POST', `/api/studio/player/${p.id}/assign`, { assetId: gen.asset.assetId });
    const buyer = w.clubs.find(c => c.id !== me.id && c.division === me.division);
    TR.executeTransfer(w, p, me, buyer, 100000, 'transfer');
    expect(p.clubId).toBe(buyer.id);
    expect(mergeForRenderer(p).hairStyle).toBe('afro');
    // Youth: every academy player has a permanent look; a Studio look can be given too.
    const youth = me.youth[0] || me.squad.find(x => x.age <= 21);
    expect(mergeForRenderer(youth).skin).toBeTypeOf('number');
    const r = await call('POST', `/api/studio/player/${youth.id}/assign`, { assetId: gen.asset.assetId });
    expect(r.ok).toBe(true);
    // One character dresses one player at a time.
    expect(p.studioProfile).toBeUndefined();
  });

  it('the library: create, edit, duplicate, search, delete, import and export; bad input is refused', async () => {
    const { call } = await career(34);
    const a = (await call('POST', '/api/studio/generate', { name: 'Alpha', description: 'a tall English centre-back with ginger hair' })).asset;
    expect(a.profile.appearance.hairColour).toBe('ginger');
    expect(a.profile.appearance.position).toBe('CB');
    const edited = await call('PUT', `/api/studio/library/${a.assetId}`, { name: 'Alpha 2', profile: { ...a.profile, appearance: { ...a.profile.appearance, jaw: 0.95 } } });
    expect(edited.asset.profile.appearance.jaw).toBe(0.95);
    const copy = (await call('POST', `/api/studio/library/${a.assetId}/duplicate`, {})).asset;
    expect(copy.assetId).not.toBe(a.assetId);
    expect((await call('GET', '/api/studio/library?q=alpha')).assets.length).toBe(2);
    const exported = await call('GET', `/api/studio/export/${a.assetId}`);
    const imported = await call('POST', '/api/studio/import', { asset: exported.asset });
    expect(imported.ok).toBe(true);
    expect(imported.asset.profile.appearance.jaw).toBe(0.95);
    expect((await call('DELETE', `/api/studio/library/${copy.assetId}`)).ok).toBe(true);
    // Refused: unknown ids, path tricks, corrupt profiles, oversized input.
    expect((await call('GET', '/api/studio/library/..%2F..%2Fetc')).ok).toBe(false);
    expect((await call('GET', '/api/studio/library/does_not_exist')).ok).toBe(false);
    expect((await call('POST', '/api/studio/import', { asset: { profile: { schemaVersion: 1, appearance: { skinTone: 'green' } } } })).ok).toBe(false);
    expect((await call('POST', '/api/studio/generate', { description: 'x'.repeat(5000) })).ok).toBe(false);
    expect((await call('POST', '/api/studio/player/99999999/assign', { assetId: a.assetId })).ok).toBe(false);
    expect((await call('POST', `/api/studio/player/1/assign`, { assetId: '../../x' })).ok).toBe(false);
  });

  it('club kits are validated, saved with the career and worn in matches', async () => {
    const { call, world } = await career(35);
    const k = await call('GET', '/api/studio/kits');
    expect(k.ok).toBe(true);
    expect((await call('PUT', '/api/studio/kits', { home: { shirt: 'red' } })).ok).toBe(false);
    expect((await call('PUT', '/api/studio/kits', { home: { pattern: 'polka' } })).ok).toBe(false);
    const ok = await call('PUT', '/api/studio/kits', { home: { shirt: '#123456', second: '#ffffff', shorts: '#000000', socks: '#123456', pattern: 'vertical-stripes' }, gk: '#00ff00' });
    expect(ok.ok).toBe(true);
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(world().toSave())));
    expect(w2.club().kits.home.shirt).toBe('#123456');
    let out; do { out = world().stepWeek({}); } while (!world().lastMatch);
    const lm = world().lastMatch, side = lm.myKey;
    expect(lm.lineups.kits[side].shirt).toBe('#123456');
    expect(lm.lineups.badges[side].crest.initials.length).toBeGreaterThan(0);
  });
});

describe('man of the match and the ceremonies', () => {
  it('the report names him with his look and kit; his count goes on his record', () => {
    const w = new GameWorld({ seed: 5, startCountry: 'England' });
    let found = null;
    for (let i = 0; i < 4 && !found; i++) { w.stepWeek({}); const m = w.lastMatch; if (m && m.motm) found = m.motm; }
    expect(found).toBeTruthy();
    expect(found.look).toBeTruthy();
    expect(found.kit && found.kit.shirt).toMatch(/^#/);
    const p = w.players.get(found.playerId);
    expect(p.history.motm).toBeGreaterThanOrEqual(1);
    expect(p.toJSON().motm).toBe(p.history.motm);
  });
});

describe('AI bidding', () => {
  it('rival clubs top bids already on the table (bidding wars) for your players', () => {
    const w = new GameWorld({ seed: 77, startCountry: 'England' });
    const me = w.club();
    for (const p of me.squad.slice(0, 6)) p.listedForSale = true;
    let wars = 0, bids = 0;
    for (let wk = 1; wk <= 10; wk++) {
      for (const b of TR.generateIncomingBids(w, wk)) { bids++; if (b.outbid != null) { wars++; expect(b.clubId).not.toBe(b.outbid); } }
    }
    expect(bids).toBeGreaterThan(3);
    expect(wars).toBeGreaterThan(0);
  });
});
