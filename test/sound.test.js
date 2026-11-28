// The match sound engine (public/sound.js) on a stand-in Web Audio: the first gesture creates and
// unlocks the audio; pausing the match and hiding the tab silence it separately and it comes back
// when neither holds (a hidden tab used to leave every later match event silent); the volume and
// mixer reach the output; phones get their speaker EQ. (Real audio, in headless Chrome with phone
// emulation, is checked separately: see docs/INTEGRATION_CHANGELOG.md.)
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

function fakeAudio() {
  const made = { contexts: [], filters: [], played: 0, started: [], sources: [], mediaSources: [], mediaPlayed: [], oscillators: 0 };
  const param = v => ({ value: v, target: v, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime(x) { this.target = x; }, cancelScheduledValues() {} });
  const node = extra => ({ connect(d) { this.to = d; }, disconnect() {}, ...extra });
  class AudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.destination = node(); made.contexts.push(this); }
    resume() { if (this.gestured) this.state = 'running'; if (this.onstatechange) this.onstatechange(); return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { return node({ gain: param(1) }); }
    createDynamicsCompressor() { return node({ threshold: param(0), ratio: param(1) }); }
    createBiquadFilter() { const f = node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }); made.filters.push(f); return f; }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), length: len }; }
    createBufferSource() { const s = node({ buffer: null, loop: false, playbackRate: param(1), start() { made.played++; if (this.buffer && this.buffer.name) made.started.push(this.buffer.name); }, stop() {} }); made.sources.push(s); return s; }
    createMediaElementSource(media) { const s = node({ media }); made.mediaSources.push(s); return s; }
    createOscillator() { made.oscillators++; return node({ type: 'sine', frequency: param(440), start() {}, stop() {} }); }
    createAnalyser() { return node({ fftSize: 2048, getFloatTimeDomainData() {} }); }
    createStereoPanner() { return node({ pan: param(0) }); }
    // A recording "decodes" to three seconds of sound with a little silence at each end (as MP3s do).
    decodeAudioData(ab) { return Promise.resolve({ name: ab.name, sampleRate: 32000, length: 96000, duration: 3, getChannelData: () => { const d = new Float32Array(96000); d.fill(0.1, 200, 95800); return d; } }); }
  }
  return { AudioContext, made };
}
// The stadium recordings as the server would give them: an index, and each file (unless missing).
function fakeFetch(names, { missing = [] } = {}) {
  return async url => {
    if (url.endsWith('index.json')) return { ok: true, json: async () => ({ files: Object.fromEntries(names.map(n => [n, { file: n + '.mp3' }])) }) };
    const n = url.split('/').pop().replace('.mp3', '');
    if (missing.includes(n)) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => Object.assign(new ArrayBuffer(8), { name: n }) };
  };
}
function load({ phone = false, fetch } = {}) {
  const { AudioContext, made } = fakeAudio();
  const listeners = {}, winL = {};
  const document = { hidden: false, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener() {}, createElement: tag => tag === 'audio' ? { loop: false, play() { made.mediaPlayed.push(this.__gafferName); return Promise.resolve(); }, pause() {}, removeAttribute() {}, load() {} } : {} };
  const window = { AudioContext, addEventListener: (t, f) => { (winL[t] ||= []).push(f); } };
  const clock = { t: 1e6 };
  const ctx = vm.createContext({ window, document, matchMedia: q => ({ matches: phone && /coarse/.test(q) }), performance: { now: () => clock.t }, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, Math, console, Promise, isFinite, fetch });
  vm.runInContext(fs.readFileSync(new URL('../public/sound.js', import.meta.url), 'utf-8'), ctx);
  const S = window.GafferSound;
  const fire = (t, target = listeners) => { for (const f of target[t] || []) f({}); };
  // A tap: the browser allows audio from here on, and the gesture listener unlocks it.
  const tap = () => { for (const c of made.contexts) c.gestured = true; AudioContext.prototype.gestured = true; fire('pointerdown'); };
  return { S, made, document, fire, tap, winL, clock };
}
const STADIUM = ['bed-calm', 'bed-lively', 'goal-1', 'goal-2', 'goal-3', 'goal-away', 'whistle-long', 'whistle-short', 'touch-1', 'touch-2', 'kick-1', 'save-gasp', 'applause', 'boo', 'cheer', 'ooh', 'groan', 'nearmiss-2', 'gasp'];

describe('match sound', () => {
  it('nothing is created before a gesture; the first tap creates, unlocks and starts the audio', () => {
    const { S, made, tap } = load();
    expect(S.state().context).toBe('none');
    tap();
    expect(made.contexts).toHaveLength(1);
    expect(S.state()).toMatchObject({ context: 'running', unlocked: true });
    expect(made.played).toBe(1);                                         // the silent sample inside the gesture
  });

  it('pausing the match silences it and drops events; resuming brings both back', () => {
    const { S, tap } = load(); tap();
    S.suspend();
    expect(S.state()).toMatchObject({ context: 'suspended', appPaused: true });
    const n = S.log.length; S.event('SHOOT'); expect(S.log.length).toBe(n);
    S.resume();
    expect(S.state().context).toBe('running');
    S.event('SHOOT'); expect(S.log.length).toBe(n + 1);
  });

  it('a hidden tab silences it, and showing the tab again brings the match sound back (with or without the crowd)', () => {
    const { S, document, fire, tap } = load(); tap();
    for (const crowdOn of [false, true]) {
      S.crowd(crowdOn);
      document.hidden = true; fire('visibilitychange');
      expect(S.state()).toMatchObject({ context: 'suspended', hidden: true });
      const n = S.log.length; S.event('SAVE'); expect(S.log.length).toBe(n);
      document.hidden = false; fire('visibilitychange');
      expect(S.state()).toMatchObject({ context: 'running', hidden: false });
      S.event('SAVE'); expect(S.log.length, `crowd ${crowdOn}`).toBe(n + 1);
    }
  });

  it('a hidden tab while the match is paused stays silent until the match resumes too', () => {
    const { S, document, fire, tap } = load(); tap();
    S.suspend(); document.hidden = true; fire('visibilitychange'); document.hidden = false; fire('visibilitychange');
    expect(S.state().context).toBe('suspended');
    S.resume(); expect(S.state().context).toBe('running');
  });

  it('volume and the mixer are kept, and the phone speaker EQ is added only on touch devices', () => {
    const desk = load(); desk.tap();
    desk.S.setVolume(0.25); desk.S.setMix({ crowd: 0.1, ref: 1, ball: 0.5 });
    expect(desk.S.state()).toMatchObject({ volume: 0.25, mix: { crowd: 0.1, ref: 1, ball: 0.5 }, phone: false });
    const deskFilters = desk.made.filters.length;
    const ph = load({ phone: true }); ph.tap();
    expect(ph.S.state().phone).toBe(true);
    expect(ph.made.filters.length - deskFilters).toBe(2);                // high-pass and presence lift
    expect(ph.made.filters.some(f => f.type === 'highpass' && f.frequency.value >= 100)).toBe(true);
  });

  it('streams the two ambience beds and decodes bounded event recordings', async () => {
    const { S, made, tap } = load({ fetch: fakeFetch(STADIUM) }); tap();
    S.crowd(true);
    await S.preload();
    expect(S.state().recorded).toMatchObject({ ready: true, loaded: STADIUM.length - 2, beds: true, bedMode: 'media-stream' });
    expect(S.state().decodedBytes).toBeLessThanOrEqual(S.state().recorded.decodedLimitBytes);
    expect(S.state().peakDecodedBytes).toBeLessThanOrEqual(S.state().recorded.decodedLimitBytes);
    const beds = made.mediaSources.filter(s => /^bed-/.test(s.media.__gafferName));
    expect(beds.map(s => s.media.__gafferName).sort()).toEqual(['bed-calm', 'bed-lively']);
    for (const b of beds) expect(b.media.loop).toBe(true);
    expect(made.mediaPlayed.sort()).toEqual(['bed-calm', 'bed-lively']);
    const after = fn => { const n = made.started.length; fn(); return made.started.slice(n); };
    expect(after(() => S.event('KICK_OFF'))).toEqual(['whistle-long']);
    expect(after(() => S.event('GOAL', { side: 'home' }))[0]).toMatch(/^goal-[123]$/);
    expect(after(() => S.event('GOAL', { side: 'away' }))).toEqual(['goal-away']);
    expect(after(() => S.event('CARD', { side: 'home', color: 'yellow' }))).toEqual(['whistle-short', 'boo']);      // the home crowd boos its own player's booking
    expect(after(() => S.event('CARD', { side: 'away', color: 'yellow' }))).toEqual(['whistle-short', 'applause']);
    expect(after(() => S.event('SAVE', { side: 'home' }))).toEqual(['save-gasp', 'applause']);
    expect(after(() => S.event('HALF_TIME', {}))).toEqual(['whistle-long', 'whistle-long', 'applause']);
    expect(after(() => S.event('FULL_TIME', { winner: 'home' }))).toEqual(['whistle-short', 'whistle-short', 'whistle-long', 'cheer', 'applause']);
    expect(after(() => S.event('FULL_TIME', { winner: 'away' }))).toEqual(['whistle-short', 'whistle-short', 'whistle-long', 'boo']);
    expect(after(() => S.event('SHOOT', { power: 1, x: 0.9 }))).toEqual(['kick-1']);
    const osc = made.oscillators; S.event('MISS', { close: true }); expect(made.oscillators).toBe(osc);                // recorded, so nothing synthesised
  });

  it('drops decoded stadium PCM when the match closes and keeps the peak for the session report', async () => {
    const { S, tap } = load({ fetch: fakeFetch(STADIUM) }); tap(); S.crowd(true); await S.preload();
    const peak = S.state().peakDecodedBytes;
    expect(S.state().decodedBytes).toBeGreaterThan(0);
    S.stopAll();
    expect(S.state()).toMatchObject({ decodedBytes: 0, cacheBytes: 0, peakDecodedBytes: peak, decodedBuffers: 0 });
  });

  it('evicts least-recently-used reaction PCM before the byte budget is exceeded', async () => {
    const names = ['bed-calm', 'bed-lively', ...Array.from({ length: 40 }, (_, i) => `reaction-${i}`)];
    const { S, tap } = load({ fetch: fakeFetch(names) }); tap(); S.crowd(true); await S.preload();
    const state = S.state();
    expect(state.cacheBytes).toBeLessThanOrEqual(state.recorded.decodedLimitBytes);
    expect(state.peakDecodedBytes).toBeLessThanOrEqual(state.recorded.decodedLimitBytes);
    expect(state.recorded.loaded).toBeLessThan(40);
    expect(state.recorded.loaded).toBeGreaterThan(0);
  });

  it('excite() crossfades from the murmur to the fuller crowd as an attack builds', async () => {
    const { S, made, tap } = load({ fetch: fakeFetch(STADIUM) }); tap();
    S.crowd(true); await S.preload();
    const gainOf = name => made.mediaSources.find(s => s.media.__gafferName === name).to.gain.target;
    S.excite(0); const calm0 = gainOf('bed-calm'), lively0 = gainOf('bed-lively');
    S.excite(1); const calm1 = gainOf('bed-calm'), lively1 = gainOf('bed-lively');
    expect(calm0).toBeGreaterThan(lively0);
    expect(lively1).toBeGreaterThan(lively0 * 4);
    expect(calm1).toBeLessThan(calm0 * 0.5);
  });

  it('a recording that cannot load leaves that sound synthesised; with no recordings at all the synthesised ground plays', async () => {
    const part = load({ fetch: fakeFetch(['bed-calm', 'bed-lively', 'whistle-long', 'kick-1'], { missing: ['whistle-long'] }) }); part.tap();
    part.S.crowd(true); await part.S.preload();
    let osc = part.made.oscillators; part.S.event('KICK_OFF'); expect(part.made.oscillators).toBeGreaterThan(osc);     // the pea whistle
    osc = part.made.oscillators; part.S.event('SHOOT', {}); expect(part.made.oscillators).toBe(osc);                     // the recorded kick
    const none = load(); none.tap();
    none.S.crowd(true);
    expect(none.S.state().recorded).toMatchObject({ ready: false, loaded: 0, beds: false });
    osc = none.made.oscillators; none.S.event('GOAL', { side: 'home' }); expect(none.made.oscillators).toBeGreaterThan(osc);
  });

  it('dribbling touches are spaced out, not a machine gun, and small touches are silent without the recordings', async () => {
    const { S, made, tap, clock } = load({ fetch: fakeFetch(STADIUM) }); tap();
    S.crowd(true); await S.preload();
    const n = made.started.length;
    S.event('DRIBBLE', { x: 0.4 }); clock.t += 100; S.event('DRIBBLE', { x: 0.4 }); clock.t += 200; S.event('DRIBBLE', { x: 0.4 });
    expect(made.started.slice(n).filter(x => /^touch-/.test(x))).toHaveLength(2);
    const none = load(); none.tap(); const osc = none.made.oscillators, played = none.made.played;
    none.S.event('DRIBBLE', {}); none.S.event('TOUCH', {});
    expect([none.made.oscillators, none.made.played]).toEqual([osc, played]);
  });

  it('the commentary gets the shared context and a voice output that the master volume does not scale twice', () => {
    const { S, tap } = load(); tap();
    const v = S.voice();
    expect(v.ctx).toBeTruthy(); expect(v.out.gain.value).toBe(1);
    S.setVolume(0.2); expect(v.out.gain.value).toBe(1);
  });
});
