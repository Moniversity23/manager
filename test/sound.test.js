// The match sound engine (public/sound.js) on a stand-in Web Audio: the first gesture creates and
// unlocks the audio; pausing the match and hiding the tab silence it separately and it comes back
// when neither holds (a hidden tab used to leave every later match event silent); the volume and
// mixer reach the output; phones get their speaker EQ. (Real audio, in headless Chrome with phone
// emulation, is checked separately: see docs/INTEGRATION_CHANGELOG.md.)
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

function fakeAudio() {
  const made = { contexts: [], filters: [], played: 0 };
  const param = v => ({ value: v, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = extra => ({ connect() {}, disconnect() {}, ...extra });
  class AudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.destination = node(); made.contexts.push(this); }
    resume() { if (this.gestured) this.state = 'running'; if (this.onstatechange) this.onstatechange(); return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { return node({ gain: param(1) }); }
    createDynamicsCompressor() { return node({ threshold: param(0), ratio: param(1) }); }
    createBiquadFilter() { const f = node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }); made.filters.push(f); return f; }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), length: len }; }
    createBufferSource() { return node({ buffer: null, loop: false, playbackRate: param(1), start() { made.played++; }, stop() {} }); }
    createOscillator() { return node({ type: 'sine', frequency: param(440), start() {}, stop() {} }); }
    createAnalyser() { return node({ fftSize: 2048, getFloatTimeDomainData() {} }); }
  }
  return { AudioContext, made };
}
function load({ phone = false } = {}) {
  const { AudioContext, made } = fakeAudio();
  const listeners = {}, winL = {};
  const document = { hidden: false, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener() {} };
  const window = { AudioContext, addEventListener: (t, f) => { (winL[t] ||= []).push(f); } };
  const ctx = vm.createContext({ window, document, matchMedia: q => ({ matches: phone && /coarse/.test(q) }), performance: { now: () => Date.now() }, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, Math, console, Promise });
  vm.runInContext(fs.readFileSync(new URL('../public/sound.js', import.meta.url), 'utf-8'), ctx);
  const S = window.GafferSound;
  const fire = (t, target = listeners) => { for (const f of target[t] || []) f({}); };
  // A tap: the browser allows audio from here on, and the gesture listener unlocks it.
  const tap = () => { for (const c of made.contexts) c.gestured = true; AudioContext.prototype.gestured = true; fire('pointerdown'); };
  return { S, made, document, fire, tap, winL };
}

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
});
