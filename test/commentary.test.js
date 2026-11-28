// The recorded commentator (public/commentary.js): calls put together from what happened (the name,
// the line, the situation after a goal, the score read the British way), played in order through the
// match audio with the crowd ducked, captions that say what is heard, the device voice only when
// chosen, the stadium announcer as a chime and a caption, and nothing said when a recording is
// missing. The last test checks the shipped library: every scripted line and every surname the game
// can produce has its recording.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { LINES, SCORES } from '../tools/commentary/lines.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ALL = [...Object.entries(LINES).flatMap(([kind, list]) => list.map(l => ({ ...l, kind }))), ...SCORES.map(l => ({ ...l, kind: 'score' }))];
const INDEX = {
  lines: Object.fromEntries(ALL.map(l => [l.id, { kind: l.kind, text: l.text, i: l.i, ...(l.name ? { name: l.name } : {}), file: l.id + '.mp3' }])),
  names: { Okafor: 'names/okafor.mp3', 'Müller': 'names/muller.mp3', Silva: 'names/silva.mp3' },
  namesX: { Okafor: 'names/okafor-x.mp3', 'Müller': 'names/muller-x.mp3', Silva: 'names/silva-x.mp3' },
};

function load({ index = INDEX, voice = 'recorded', failFiles = false } = {}) {
  const started = [], chimes = [], spoken = [], timers = [];
  const param = v => ({ value: v });
  const ctx = {
    currentTime: 10, state: 'running',
    createGain() { return { gain: param(1), connect() {}, disconnect() {} }; },
    createBufferSource() { const s = { buffer: null, playbackRate: param(1), connect() {}, start(t) { started.push({ file: this.buffer.file, at: t, rate: this.playbackRate.value, src: this }); }, stop() {} }; return s; },
    decodeAudioData(ab) { return Promise.resolve({ file: ab.file, duration: 1, length: 44100, numberOfChannels: 1, sampleRate: 44100 }); },
  };
  const fetch = async url => {
    const f = url.replace(/^audio\/commentary\//, '');
    if (f === 'index.json') return index ? { ok: true, json: async () => index } : { ok: false, status: 404 };
    if (failFiles) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => { const ab = new ArrayBuffer(4); ab.file = f; const slice = ab.slice.bind(ab); ab.slice = () => Object.assign(slice(0), { file: f }); return ab; } };
  };
  class SpeechSynthesisUtterance { constructor(t) { this.text = t; } }
  const speechSynthesis = { getVoices: () => [], speak(u) { spoken.push(u.text); }, cancel() {}, pause() {}, resume() {}, addEventListener() {} };
  const window = { speechSynthesis, GafferSound: { voice: () => ({ ctx, out: {} }), play: n => chimes.push(n) } };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ window, document, fetch, SpeechSynthesisUtterance, performance: { now: () => 1000 }, setTimeout: (f, ms) => { timers.push(f); return timers.length; }, Promise, Math, Number, Object, String, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'commentary.js'), 'utf8'), context);
  const C = window.GafferCommentary;
  const captions = [], ducks = [];
  C.onCaption((t, k) => captions.push([t, k])); C.onSpeaking((on, pa) => ducks.push(on));
  C.configure({ voice });
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
  return { C, started, chimes, spoken, captions, ducks, timers, flush, ctx };
}
const ids = c => c.parts.map(p => p.file.replace(/\.mp3$/, ''));
const kindOf = id => (INDEX.lines[id] || {}).kind;

describe('recorded commentary', () => {
  it('a goal is the call, the scorer called out, then a line for what it means', async () => {
    const { C } = load(); await C.ready();
    const g = C.compose('goal', { player: 'Chidi Okafor', side: 'home', hs: 1, as: 0, min: 30 });
    expect(kindOf(ids(g)[0])).toBe('goal');
    expect(ids(g)[1]).toBe('names/okafor-x');
    expect(kindOf(ids(g)[2])).toBe('goalAhead');
    expect(g.text).toMatch(/^[^!]+! Okafor! .+/);
    const ctx = d => kindOf(ids(C.compose('goal', { player: 'Okafor', ...d })).at(-1));
    expect(ctx({ side: 'away', hs: 1, as: 1, min: 50 })).toBe('goalLevel');
    expect(ctx({ side: 'away', hs: 2, as: 2, min: 88 })).toBe('goalLate2');
    expect(ctx({ side: 'home', hs: 2, as: 1, min: 89 })).toBe('goalLate');
    expect(ctx({ side: 'home', hs: 2, as: 0, min: 60 })).toBe('goalMore');
    expect(ctx({ side: 'home', hs: 4, as: 0, min: 60 })).toBe('goalPraise');
    expect(ctx({ side: 'away', hs: 3, as: 1, min: 80 })).toBe('goalConsolation');
    expect(ctx({ side: 'away', hs: 3, as: 1, min: 20 })).toBe('goalPraise');
  });

  it('the score is read leader first, with who leads; half- and full-time say the result', async () => {
    const { C } = load(); await C.ready();
    expect(ids(C.compose('score', { hs: 2, as: 1 }))).toEqual(['s21', 'sideHome']);
    expect(ids(C.compose('score', { hs: 0, as: 2 }))).toEqual(['s20', 'sideAway']);
    expect(ids(C.compose('score', { hs: 1, as: 1 }))).toEqual(['s11']);
    expect(C.compose('score', { hs: 12, as: 0 })).toBe(null);                 // not recorded: the caption-only line is used
    const h = ids(C.compose('half', { hs: 0, as: 0 }));
    expect(h.map(kindOf)).toEqual(['half', 'halfNil']);
    const f = ids(C.compose('full', { hs: 2, as: 1 }));
    expect(f.map(kindOf)).toEqual(['full', 'score', 'fullHome']);
    expect(ids(C.compose('full', { hs: 1, as: 3 })).map(kindOf)).toEqual(['full', 'score', 'fullAway']);
  });

  it('names come first when recorded (accents and case forgiven); otherwise a line that needs no name', async () => {
    const { C } = load(); await C.ready();
    for (let i = 0; i < 20; i++) {
      const c = C.compose('save', { keeper: 'MÜLLER', player: 'Silva' });
      if (c.parts.length === 2) { expect(ids(c)[0]).toBe('names/muller'); expect(c.text).toMatch(/^Müller, [a-z]/); }
      else expect(INDEX.lines[ids(c)[0]].name).toBeUndefined();
    }
    for (let i = 0; i < 20; i++) {
      const c = C.compose('shot', { player: 'Nobody-Known' });
      expect(c.parts).toHaveLength(1);
      expect(INDEX.lines[ids(c)[0]].name).toBeUndefined();                    // "Here's the shot!", not a name that cannot be said
    }
  });

  it('the same line is not used twice running', async () => {
    const { C } = load(); await C.ready();
    let last = null;
    for (let i = 0; i < 40; i++) { const id = ids(C.compose('miss', {}))[0]; expect(id).not.toBe(last); last = id; }
  });

  it('a call plays its recordings in order through the match audio, ducks the crowd, and captions what is said', async () => {
    const { C, started, captions, ducks, flush } = load(); await C.ready();
    C.say('goal', { player: 'Okafor', side: 'home', hs: 1, as: 0, min: 30 });
    await flush();
    expect(started.map(s => s.file)).toHaveLength(3);
    expect(started[1].file).toBe('names/okafor-x.mp3');
    for (let i = 1; i < started.length; i++) expect(started[i].at).toBeGreaterThan(started[i - 1].at + 0.99);   // one after another
    expect(captions.at(-1)[0]).toMatch(/Okafor!/);
    expect(ducks).toEqual([true]);
    expect(C.state().recorded).toMatchObject({ decodedBytes: 3 * 44100 * 4, compressedBytes: 0 });
    expect(C.state().recorded.peakDecodedBytes).toBeLessThanOrEqual(C.state().recorded.decodedLimitBytes);
    started.at(-1).src.onended();
    expect(ducks).toEqual([true, false]);
  });

  it('releases decoded commentary at match exit while retaining the session high-water mark', async () => {
    const { C, flush } = load(); await C.ready();
    C.say('goal', { player: 'Okafor', club: 'Lions', side: 'home', hs: 1, as: 0 }); await flush();
    const peak = C.state().recorded.peakDecodedBytes;
    expect(C.state().recorded.decodedBytes).toBeGreaterThan(0);
    C.release();
    expect(C.state().recorded).toMatchObject({ decodedBytes: 0, cacheBytes: 0, peakDecodedBytes: peak, liveBuffers: 0 });
  });

  it('warms compressed commentary without retaining the full prefetch in the page heap', async () => {
    const { C } = load();
    const loaded = await C.preload(['Okafor']);
    expect(loaded).toBeGreaterThan(ALL.length);
    expect(C.state().recorded).toMatchObject({ compressedBytes: 0, fetched: 0, decodedBytes: 0 });
  });

  it('the stadium announcer is a chime and a caption with the recorded voice; the device voice reads it when chosen', async () => {
    const rec = load(); await rec.C.ready();
    rec.C.announce('sub', { club: 'Lions', outNum: 7, out: 'A', inNum: 12, in: 'B' });
    expect(rec.chimes).toEqual(['chime']); expect(rec.spoken).toEqual([]);
    expect(rec.captions.at(-1)).toEqual(['Substitution for Lions: number 7, A, is replaced by number 12, B.', 'pa']);
    const dev = load({ voice: 'device' });
    dev.C.say('goal', { player: 'Okafor', club: 'Lions' });
    expect(dev.spoken).toHaveLength(1); expect(dev.started).toHaveLength(0);
  });

  it('a recording that cannot be had says nothing (the caption stays); without the library the captions carry on', async () => {
    const miss = load({ failFiles: true }); await miss.C.ready();
    miss.C.say('woodwork', { player: 'Okafor' }); await miss.flush();
    expect(miss.started).toHaveLength(0); expect(miss.spoken).toHaveLength(0);
    expect(miss.captions.at(-1)[1]).toBe('comm');
    const none = load({ index: null }); await none.C.ready();
    none.C.say('goal', { player: 'Okafor', club: 'Lions' }); await none.flush();
    expect(none.captions.at(-1)[0]).toMatch(/Okafor/);
    expect(none.started).toHaveLength(0); expect(none.spoken).toHaveLength(0);           // never the device voice unless chosen
  });

  it('the shipped library has every scripted line and every surname the game can produce, called and calm', () => {
    const dir = path.join(ROOT, 'public', 'audio', 'commentary');
    const ix = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    for (const l of ALL) {
      expect(ix.lines[l.id], l.id).toMatchObject({ kind: l.kind, text: l.text });
      expect(fs.statSync(path.join(dir, ix.lines[l.id].file)).size, l.id).toBeGreaterThan(1500);
    }
    const { POOLS } = require('./src/names.js');
    const surnames = new Set(Object.values(POOLS).flatMap(p => (p.last || []).map(n => String(n).trim().split(/\s+/).pop())));
    for (const n of surnames) {
      for (const set of ['names', 'namesX']) {
        expect(ix[set][n], `${set} ${n}`).toBeTruthy();
        expect(fs.statSync(path.join(dir, ix[set][n])).size, `${set} ${n}`).toBeGreaterThan(800);
      }
    }
    expect(ix.voice.model).toMatch(/Kokoro/);
  });
});
