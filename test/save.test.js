// Save/load: lossless round trip, determinism after load, id counters, migrations, corruption recovery.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const zlib = require('zlib');
const { GameWorld } = require('../src/index.js');
const { stateHash, createStore, decode } = require('../src/saveStore.js');
const { assertWorldInvariants } = require('../src/engine/seasonEngine.js');
const YOUTH = require('../src/engine/youthEngine.js');

const roundTrip = (w) => GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));

describe('save / load', () => {
  it('round-trips losslessly and continues identically (state hash matches)', () => {
    const a = new GameWorld({ seed: 99, startCountry: 'England' });
    for (let i = 0; i < 7; i++) a.stepWeek({});
    const b = roundTrip(a);
    expect(stateHash(b.toSave())).toBe(stateHash(a.toSave()));
    for (let i = 0; i < 5; i++) { a.stepWeek({}); b.stepWeek({}); }
    expect(stateHash(b.toSave())).toBe(stateHash(a.toSave()));
  });

  it('a match paused at halftime survives save/load', () => {
    const a = new GameWorld({ seed: 5, startCountry: 'Brazil' });
    let step;
    do { step = a.advanceWeek({}, true); } while (!step.halftime);
    const b = roundTrip(a);
    expect(b.liveMatch).not.toBeNull();
    expect(stateHash(b.toSave())).toBe(stateHash(a.toSave()));
    a.advanceWeek({}, false); b.advanceWeek({}, false);
    expect(stateHash(b.toSave())).toBe(stateHash(a.toSave()));
  });

  it('keeps id counters so new players never reuse a saved id', () => {
    const a = new GameWorld({ seed: 7, startCountry: 'Japan' });
    a.stepWeek({});
    const b = roundTrip(a);
    const maxId = Math.max(...b.players.keys());
    const p = YOUTH.makeYouth(b, b.club());
    expect(p.id).toBeGreaterThan(maxId);
    expect(b.ids.pid).toBe(a.ids.pid + 1);
  });

  it('migrates a v6 save (old engine) without losing the career', () => {
    // Fixture: a real save written by the pre-Phase-0 engine (v6) at week 5 of its first season.
    const v6 = decode(fs.readFileSync(new URL('./fixtures/save_v6_week5.json.gz', import.meta.url)));
    expect(v6._v).toBe(6);
    const w = GameWorld.fromSave(v6);
    assertWorldInvariants(w);
    const oldClub = v6.clubs.find(c => c.id === v6.manager.clubId);
    // Real-world names are replaced by fictional ones on migration (src/data/renames.json).
    const renames = require('../src/data/renames.json');
    expect(w.club().name).toBe(renames.clubs[oldClub.country][oldClub.name]);
    expect(w.club().id).toBe(oldClub.id);
    expect(w.club().staff.coach.rating).toBeGreaterThan(0);
    expect(w.currentWeek).toBe(5);
    const oldActive = v6.players.filter(p => !p.retired).length;
    expect(w.players.size).toBe(oldActive);
    expect(w.club().squad.length).toBe(oldClub.squad.length);
    for (let i = 0; i < 3; i++) w.stepWeek({});
    assertWorldInvariants(w);
  });

  it('migrates the owner\'s real v6 career save when present', () => {
    const fp = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'auto.v6.backup.json');
    if (!fs.existsSync(fp)) return;
    const v6 = JSON.parse(fs.readFileSync(fp, 'utf-8')).gameState;
    const w = GameWorld.fromSave(v6);
    assertWorldInvariants(w);
    expect(w.club().id).toBe(v6.manager.clubId);
    expect(w.manager.trophies).toBe(v6.manager.trophies);
    w.stepWeek({});
  });

  it('refuses a save from a newer version instead of half-loading it', () => {
    expect(() => GameWorld.fromSave({ _v: 99 })).toThrow(/newer version/);
  });

  it('recovers from a corrupted auto-save using the previous generation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-store-'));
    const store = createStore({ dir, mongoUri: null, log: { log() {}, warn() {}, error() {} } });
    for (let i = 1; i <= 3; i++) await store.save('auto', { _v: 7, n: i }, { n: i });
    fs.writeFileSync(path.join(dir, 'auto.json.gz'), Buffer.from('not a gzip file'));
    const r = await store.load('auto');
    expect(r.recovered).toBe(true);
    expect(r.loadedFrom).toBe('auto.1');
    expect(r.gameState.n).toBe(2);
    expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'auto.2.json.gz'))).length).toBeGreaterThan(0);
  });

  it('keeps a gzipped save under 2 MB', () => {
    const w = new GameWorld({ seed: 3, startCountry: 'Ghana' });
    for (let i = 0; i < 12; i++) w.stepWeek({});
    const gz = zlib.gzipSync(JSON.stringify(w.toSave()));
    expect(gz.length).toBeLessThan(2 * 1024 * 1024);
  });
});
