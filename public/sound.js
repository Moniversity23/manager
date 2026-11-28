// The Gaffer sound: a football ground synthesised with WebAudio (no audio files, works offline).
// This is the original crowd-and-whistle engine (restored: it has the football feel). The match
// sends key events through GafferSound.event(): kick-off, passes and shots as the ball leaves the
// boot, goals (home and away crowds react differently), saves, misses, cards, injuries, half-time
// and full-time. Minor events are ignored on purpose so the sound stays clean and in time with play.
// Crowd, referee and ball sounds have their own volume (Settings → Match audio mixer).
//  • Crowd: a murmur of filtered noise plus a bed of "voices" (detuned tones through vowel filters),
//    a low rumble, and chants with clapping and a drum every so often.
//  • The crowd follows the game: excite(0..1) raises volume and pitch as a chance builds.
//  • Referee's pea whistle, ball kicks and passes, the net, "ooh"s for saves and misses, boos for
//    cards, and a goal roar with an air horn.
// Browsers only allow audio after a user gesture: the first tap, click or key anywhere creates the
// audio context and plays a silent sound inside that gesture (what iOS and Android require), and any
// later gesture wakes it again if the system suspended or interrupted it (a call, another app, the
// screen locking). Two things silence it on purpose and are kept apart: the app pausing (the match
// paused, a replay, leaving the match) and the tab being hidden; it plays again only when neither holds.
// Phones: small speakers cannot play the low end, which would still drive the compressor and make
// everything quieter, so on touch devices the output is high-passed and the presence range lifted.
(function () {
  let ctx = null, master = null, noiseBuf = null, crowdNodes = null, volume = 0.6, chantTimer = null, level = 0;
  const bus = {}, mix = { crowd: 0.85, ref: 0.85, ball: 0.8 };
  let cur = null, duckGain = null, appPaused = false, hidden = typeof document !== 'undefined' && document.hidden === true, unlocked = false, meter = null;
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const log = [];
  const OUT = () => cur || master;
  // Plays fn with every node it creates routed to one category's volume.
  const using = (cat, fn) => { const prev = cur; cur = bus[cat] || null; try { fn(); } finally { cur = prev; } };

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    master = ctx.createGain();
    master.gain.value = volume;
    let out = master;
    if (phone) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.7;
      const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2400; pres.Q.value = 0.9; pres.gain.value = 4;
      master.connect(hp); hp.connect(pres); out = pres;
    }
    out.connect(comp); comp.connect(ctx.destination);
    master.comp = comp;
    duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(master);
    for (const c of Object.keys(mix)) { bus[c] = ctx.createGain(); bus[c].gain.value = mix[c]; bus[c].connect(c === 'crowd' ? duckGain : master); }
    ctx.onstatechange = () => { if (ctx.state !== 'running' && !appPaused && !hidden) wake(); };
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = w * 0.55 + last * 3.2; }
    return ctx;
  }

  const VOWEL = { a: [730, 1090, 2440], o: [570, 840, 2410], e: [530, 1840, 2480], u: [300, 870, 2240] };

  // Noise shaped like a crowd vowel ("aaah", "oooh"): three formant band-passes in parallel.
  function voiceNoise(dur, vowel, { gain = 0.3, attack = 0.2, release = 0.6, delay = 0, slide = 1, dest = OUT() } = {}) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    VOWEL[vowel].forEach((f, i) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(f, t); bp.Q.value = 4 + i;
      if (slide !== 1) bp.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
      const fg = ctx.createGain(); fg.gain.value = [1, 0.6, 0.25][i];
      src.connect(bp); bp.connect(fg); fg.connect(g);
    });
    g.connect(dest);
    src.start(t); src.stop(t + dur + 0.05);
  }

  function noise(dur, { freq = 600, q = 0.8, type = 'bandpass', gain = 0.3, attack = 0.02, release = 0.2, delay = 0 } = {}) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(OUT());
    src.start(t); src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, { type = 'sine', gain = 0.2, delay = 0, slideTo = null, tremolo = 0 } = {}) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + Math.max(0.012, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (tremolo) {                       // the pea rattling inside a referee's whistle
      const am = ctx.createGain(); am.gain.value = 0.65;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = tremolo;
      const lg = ctx.createGain(); lg.gain.value = 0.35;
      lfo.connect(lg); lg.connect(am.gain); lfo.start(t); lfo.stop(t + dur);
      g.connect(am); out = am;
    }
    o.connect(g); out.connect(OUT());
    o.start(t); o.stop(t + dur + 0.02);
  }

  const whistle = (dur, delay = 0) => { tone(2150, dur, { gain: 0.1, delay, tremolo: 27 }); tone(2380, dur, { gain: 0.07, delay, tremolo: 27 }); noise(dur, { freq: 4200, q: 2, gain: 0.02, delay }); };
  const thud = (g, f = 150) => { tone(f, 0.13, { gain: g, slideTo: 48 }); tone(f * 2.3, 0.06, { gain: g * 0.32, slideTo: f }); noise(0.04, { freq: 1800, q: 0.7, gain: g * 0.35 }); noise(0.022, { freq: 950, q: 1.3, gain: g * 0.32, attack: 0.002, release: 0.018 }); };
  const clap = (delay, g = 0.11) => { noise(0.07, { freq: 1500, q: 0.9, gain: g, attack: 0.004, release: 0.05, delay }); noise(0.05, { freq: 2600, q: 1.2, gain: g * 0.5, attack: 0.004, release: 0.04, delay: delay + 0.008 }); };
  const drum = (delay, g = 0.3) => { tone(95, 0.22, { gain: g, slideTo: 50, delay }); tone(200, 0.12, { gain: g * 0.42, slideTo: 125, delay }); noise(0.03, { freq: 1300, q: 1, gain: g * 0.22, attack: 0.002, release: 0.02, delay }); };

  const SOUNDS = {
    click: () => tone(1600, 0.03, { gain: 0.05, type: 'triangle' }),
    whistle: () => { whistle(0.2); whistle(0.55, 0.28); },
    whistle2: () => whistle(0.8),
    restart: () => whistle(0.4),
    whistleEnd: () => { whistle(0.32); whistle(0.32, 0.45); whistle(1, 0.9); voiceNoise(2.5, 'a', { gain: 0.16, attack: 0.4, release: 1.4, delay: 1 }); },
    pass: () => thud(0.1, 120),
    kick: () => thud(0.38, 170),
    net: () => noise(0.35, { freq: 3200, q: 0.6, type: 'highpass', gain: 0.12, attack: 0.01, release: 0.3 }),
    goal: () => {
      SOUNDS.net();
      // The roar: three waves of "yeaaah", rising, then cheering and an air horn.
      voiceNoise(5, 'a', { gain: 0.6, attack: 0.25, release: 2.2, delay: 0.05, slide: 1.12 });
      voiceNoise(4.4, 'e', { gain: 0.3, attack: 0.5, release: 2, delay: 0.2, slide: 1.08 });
      noise(4.6, { freq: 900, q: 0.4, gain: 0.3, attack: 0.3, release: 2.2, delay: 0.05 });
      for (const [f, d] of [[415, 0.9], [523, 0.9], [415, 2.1], [523, 2.1]]) tone(f, 0.75, { type: 'sawtooth', gain: 0.045, delay: d });
      for (let i = 0; i < 9; i++) clap(1.6 + i * 0.28 + Math.random() * 0.05, 0.08);
    },
    goalAway: () => { SOUNDS.net(); voiceNoise(2.2, 'o', { gain: 0.3, attack: 0.15, release: 1.4, slide: 0.7 }); voiceNoise(2.4, 'a', { gain: 0.09, attack: 0.3, release: 1.2, delay: 0.3 }); },
    save: () => { voiceNoise(1.3, 'o', { gain: 0.34, attack: 0.12, release: 0.8, slide: 0.82 }); for (let i = 0; i < 5; i++) clap(0.9 + i * 0.16, 0.05); },
    miss: () => voiceNoise(1.7, 'o', { gain: 0.36, attack: 0.15, release: 1.1, slide: 0.72 }),
    card: () => { whistle(0.4); voiceNoise(1.6, 'u', { gain: 0.26, attack: 0.3, release: 0.9, delay: 0.35, slide: 0.9 }); },
    deal: () => { tone(523, 0.18, { gain: 0.12 }); tone(659, 0.3, { gain: 0.12, delay: 0.12 }); tone(784, 0.4, { gain: 0.1, delay: 0.24 }); },
    levelup: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { gain: 0.1, delay: i * 0.1, type: 'triangle' })); },
  };

  const CAT = { whistle: 'ref', whistle2: 'ref', whistleEnd: 'ref', restart: 'ref', card: 'ref', pass: 'ball', kick: 'ball', net: 'ball', click: 'ball', deal: 'ball', levelup: 'ball', goal: 'crowd', goalAway: 'crowd', save: 'crowd', miss: 'crowd' };
  function play(name, vol) {
    if (!init()) return;
    if (ctx.state !== 'running' && !appPaused && !hidden) wake();
    if (vol != null) setVolume(vol);
    const fn = SOUNDS[name];
    if (fn) using(CAT[name] || 'ball', fn);
  }

  // Key match events → sounds. Anything not listed (touches, bounces, shouts …) is silent.
  const EVENTS = { KICK_OFF: 'whistle', RESTART: 'restart', INJURY: 'restart', PASS: 'pass', SHOOT: 'kick', SAVE: 'save', MISS: 'miss', WOODWORK: 'miss', CARD: 'card', HALF_TIME: 'whistle2', FULL_TIME: 'whistleEnd' };
  function event(type, d = {}) {
    if (appPaused || hidden) return;
    const name = type === 'GOAL' ? (d.side === 'away' ? 'goalAway' : 'goal') : EVENTS[type];
    if (!name) return;
    log.push([Math.round(performance.now()), type, d.side || '']); if (log.length > 300) log.shift();
    play(name);
  }

  // A terrace chant: drum and claps in a football rhythm, with a sung line underneath.
  function chant() {
    if (!crowdNodes || !ctx || appPaused || hidden) return;
    using('crowd', chantNow);
  }
  function chantNow() {
    const pattern = Math.random() < 0.5 ? [0, 0.5, 1, 1.25, 1.5, 2.5, 3, 3.5, 3.75, 4] : [0, 0.4, 0.8, 1.6, 2, 2.4, 3.2, 3.6, 4];
    pattern.forEach(t => { clap(t, 0.07 + level * 0.04); if (Math.abs(t - Math.round(t)) < 0.01) drum(t, 0.16); });
    voiceNoise(4.4, Math.random() < 0.5 ? 'o' : 'e', { gain: 0.1 + level * 0.06, attack: 0.5, release: 1.2 });
  }

  // Looping crowd bed.
  function crowd(on, vol) {
    if (!on) {
      if (chantTimer) { clearInterval(chantTimer); chantTimer = null; }
      if (crowdNodes && ctx) {
        const t = ctx.currentTime, n = crowdNodes;
        n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0.0001, t, 0.4);
        setTimeout(() => { try { n.stop.forEach(x => x.stop()); } catch (e) { /* already stopped */ } }, 1600);
        crowdNodes = null;
      }
      return;
    }
    if (!init() || crowdNodes) return;
    if (ctx.state !== 'running' && !appPaused && !hidden) wake();
    if (vol != null) setVolume(vol);
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(bus.crowd || master);
    g.gain.setTargetAtTime(0.085, ctx.currentTime, 0.8);
    const stop = [];
    // murmur
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 700; band.Q.value = 0.5;
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 1500;
    src.connect(band); band.connect(low); low.connect(g); src.start(); stop.push(src);
    // rumble
    const src2 = ctx.createBufferSource(); src2.buffer = noiseBuf; src2.loop = true; src2.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const rg = ctx.createGain(); rg.gain.value = 0.9;
    src2.connect(lp); lp.connect(rg); rg.connect(g); src2.start(); stop.push(src2);
    // voices: detuned tones through an "ah" filter, drifting in pitch like thousands of people
    const vg = ctx.createGain(); vg.gain.value = 0.05; vg.connect(g);
    const form = ctx.createBiquadFilter(); form.type = 'bandpass'; form.frequency.value = 760; form.Q.value = 1.6; form.connect(vg);
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110 + i * 23 + Math.random() * 12;
      const l = ctx.createOscillator(); l.frequency.value = 0.07 + Math.random() * 0.2;
      const lg = ctx.createGain(); lg.gain.value = 7 + Math.random() * 8;
      l.connect(lg); lg.connect(o.frequency); o.connect(form); o.start(); l.start(); stop.push(o, l);
    }
    // slow swell
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lgn = ctx.createGain(); lgn.gain.value = 0.02;
    lfo.connect(lgn); lgn.connect(g.gain); lfo.start(); stop.push(lfo);
    crowdNodes = { g, band, vg, stop };
    level = 0;
    chantTimer = setInterval(() => { if (Math.random() < 0.55) chant(); }, 9000);
    setTimeout(chant, 2500);
  }

  // 0 = quiet midfield, 1 = a goal is coming / being celebrated.
  function excite(x) {   // (a second argument, the attacking side, is accepted and ignored)
    if (!crowdNodes || !ctx) return;
    level = Math.max(0, Math.min(1, Number(x) || 0));
    const t = ctx.currentTime;
    crowdNodes.g.gain.setTargetAtTime(0.085 + level * 0.16, t, 0.35);
    crowdNodes.band.frequency.setTargetAtTime(700 + level * 520, t, 0.4);
    crowdNodes.vg.gain.setTargetAtTime(0.05 + level * 0.12, t, 0.4);
  }

  function setVolume(v) { volume = Math.max(0, Math.min(1, Number(v) || 0)); if (master) master.gain.value = volume; }
  function setMix(m) { for (const c of Object.keys(mix)) { if (m && m[c] != null) mix[c] = Math.max(0, Math.min(1.2, Number(m[c]) || 0)); if (bus[c]) bus[c].gain.value = mix[c]; } }
  // Speech over the crowd: dip it a little (amount 0..1), back to normal with 0.
  function duck(amount) { if (!duckGain || !ctx) return; duckGain.gain.cancelScheduledValues(ctx.currentTime); duckGain.gain.setTargetAtTime(Math.max(0.3, 1 - (amount || 0)), ctx.currentTime, 0.25); }
  // Running exactly when the app has not paused it and the tab is visible.
  function wake() { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } }
  function apply() { if (!ctx) return; if (appPaused || hidden) { if (ctx.state === 'running') ctx.suspend(); } else wake(); }
  function suspend() { appPaused = true; apply(); }
  function resume() { appPaused = false; apply(); }
  function stopAll() { crowd(false); duck(0); }
  // A gesture: create the context (first time), play one silent sample inside the gesture, wake it.
  function unlock() {
    if (!init()) return;
    if (!unlocked) { try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); unlocked = true; } catch (e) { /* tried again on the next gesture */ } }
    if (!appPaused && !hidden) wake();
  }
  if (typeof document !== 'undefined') {
    for (const g of ['pointerdown', 'touchend', 'keydown', 'click']) document.addEventListener(g, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; apply(); });
    window.addEventListener('pageshow', () => { hidden = document.hidden; apply(); });
    window.addEventListener('pagehide', () => { hidden = true; apply(); });
  }
  // For checks: the state of the audio, and the level at the output (RMS, 0..1) over the last frame.
  function state() { return { context: ctx ? ctx.state : 'none', unlocked, appPaused, hidden, crowd: !!crowdNodes, volume, mix: { ...mix }, phone, sampleRate: ctx ? ctx.sampleRate : null }; }
  function outputLevel() {
    if (!ctx || !master) return 0;
    if (!meter) { meter = ctx.createAnalyser(); meter.fftSize = 2048; master.comp.connect(meter); }
    const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a);
    let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
    return Math.sqrt(sum / a.length);
  }

  window.GafferSound = { play, crowd, excite, setVolume, setMix, event, duck, suspend, resume, stopAll, unlock, state, level: outputLevel, mix, log };
})();
