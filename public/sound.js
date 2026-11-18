// The Gaffer — match audio manager (Web Audio API; every sound is synthesised here, no audio files,
// so it works offline and there is nothing to license; see docs/AUDIO.md).
//
// The match view sends structured events (KICK_OFF, PASS, SHOOT, GOAL, SAVE, CARD …) through
// GafferSound.event(type, data). This module decides what is heard:
//   • Buses with their own volume: crowd, referee, ball, voices, commentary, announcer, music,
//     all into a master gain → compressor → limiter (no clipping).
//   • The crowd is two sections: the home end (most of the ground) and the away end. Each has
//     a murmur bed whose excitement follows the danger of the attack, and reacts on its own:
//     roars, groans, "ooh"s, gasps, applause, boos, whistling and sung chants.
//   • Ball and player sounds are panned to where they happen on the pitch.
//   • Ducking: while commentary or the announcer speaks the crowd dips a little; during a goal
//     celebration the crowd is dominant and speech waits.
//   • Variations are picked at random without repeating the last few, and every reaction has a
//     cooldown, so nothing loops audibly.
// Browsers only allow audio after a user gesture; the first click on Continue unlocks it.
(function () {
  const CATS = ['crowd', 'ref', 'ball', 'voices', 'commentary', 'announcer', 'music'];
  let ctx = null, master = null, noiseBuf = null, pinkBuf = null, volume = 0.6;
  const bus = {}, mix = { crowd: 0.85, ref: 0.85, ball: 0.8, voices: 0.6, commentary: 0.9, announcer: 0.8, music: 0.5 };
  let duckGain = null, crowdNodes = null, chantTimer = null, level = 0, attackSide = null, suspended = false;
  const cool = {}, recent = {}, log = [];
  const now = () => (ctx ? ctx.currentTime : 0);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ready = (key, secs) => { const t = performance.now() / 1000; if (cool[key] && t < cool[key]) return false; cool[key] = t + secs; return true; };
  // Pick one of n variations, avoiding the last few used for this key.
  function vary(key, n) { const r = recent[key] || (recent[key] = []); let i, k = 0; do { i = Math.floor(Math.random() * n); k++; } while (r.includes(i) && k < 12); r.push(i); if (r.length > Math.min(3, n - 1)) r.shift(); return i; }

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1;
    master = ctx.createGain(); master.gain.value = volume;
    master.connect(comp); comp.connect(limit); limit.connect(ctx.destination);
    duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(master);
    for (const c of CATS) { bus[c] = ctx.createGain(); bus[c].gain.value = mix[c]; bus[c].connect(c === 'crowd' ? duckGain : master); }
    const len = ctx.sampleRate * 3;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    pinkBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0), p = pinkBuf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = w * 0.55 + last * 3.2;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; p[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else if (crowdNodes) resume(); });
    return ctx;
  }
  const out = (dest, pan) => {
    if (pan == null || !ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest); return p;
  };
  function env(g, t, gain, attack, dur, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, gain), t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  const VOWEL = { a: [730, 1090, 2440], o: [570, 840, 2410], e: [530, 1840, 2480], u: [300, 870, 2240], i: [270, 2290, 3010] };
  // Noise shaped like a crowd vowel ("aaah", "oooh"): three formant band-passes in parallel.
  function voiceNoise(dur, vowel, { gain = 0.3, attack = 0.2, release = 0.6, delay = 0, slide = 1, dest = bus.crowd, pan = null, pink = false } = {}) {
    const t = now() + delay;
    const src = ctx.createBufferSource(); src.buffer = pink ? pinkBuf : noiseBuf; src.loop = true; src.playbackRate.value = rnd(0.8, 1.2);
    const g = ctx.createGain(); env(g, t, gain, attack, dur, release);
    VOWEL[vowel].forEach((f, i) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(f, t); bp.Q.value = 4 + i;
      if (slide !== 1) bp.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
      const fg = ctx.createGain(); fg.gain.value = [1, 0.6, 0.25][i];
      src.connect(bp); bp.connect(fg); fg.connect(g);
    });
    g.connect(out(dest, pan));
    src.start(t); src.stop(t + dur + 0.05);
  }
  function noise(dur, { freq = 600, q = 0.8, type = 'bandpass', gain = 0.3, attack = 0.02, release = 0.2, delay = 0, dest = bus.ball, pan = null, sweep = null, pink = false } = {}) {
    const t = now() + delay;
    const src = ctx.createBufferSource(); src.buffer = pink ? pinkBuf : noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain(); env(g, t, gain, attack, dur, release);
    src.connect(f); f.connect(g); g.connect(out(dest, pan));
    src.start(t); src.stop(t + dur + 0.05);
  }
  function tone(freq, dur, { type = 'sine', gain = 0.2, delay = 0, slideTo = null, tremolo = 0, dest = bus.ball, pan = null, attack = 0.012 } = {}) {
    const t = now() + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); env(g, t, gain, attack, dur, Math.min(0.05, dur / 2));
    let o2 = g;
    if (tremolo) {                       // the pea rattling inside a referee's whistle
      const am = ctx.createGain(); am.gain.value = 0.65;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = tremolo;
      const lg = ctx.createGain(); lg.gain.value = 0.35;
      lfo.connect(lg); lg.connect(am.gain); lfo.start(t); lfo.stop(t + dur);
      g.connect(am); o2 = am;
    }
    o.connect(g); o2.connect(out(dest, pan));
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ── referee ──
  const whistleBlast = (dur, delay = 0, g = 0.1) => { const f = rnd(2080, 2220); tone(f, dur, { gain: g, delay, tremolo: rnd(24, 30), dest: bus.ref }); tone(f * 1.1, dur, { gain: g * 0.7, delay, tremolo: 27, dest: bus.ref }); noise(dur, { freq: 4200, q: 2, gain: 0.02, delay, dest: bus.ref }); };
  const REF = {
    kickoff: () => whistleBlast(0.55),
    restart: () => whistleBlast(0.4),
    foul: () => whistleBlast(0.22, 0, 0.12),
    stoppage: () => { whistleBlast(0.18); whistleBlast(0.18, 0.26); },
    card: () => { whistleBlast(0.2, 0, 0.12); whistleBlast(0.7, 0.3, 0.11); },
    goal: () => whistleBlast(0.35),
    half: () => { whistleBlast(0.45); whistleBlast(1.0, 0.6); },
    full: () => { whistleBlast(0.32); whistleBlast(0.32, 0.45); whistleBlast(1.1, 0.9); },
  };

  // ── ball ──
  const thud = (g, f, pan, delay = 0) => { tone(f, 0.13, { gain: g, slideTo: 46, pan, delay }); noise(0.04, { freq: 1800, q: 0.7, gain: g * 0.35, pan, delay }); };
  const whoosh = (dur, g, pan, delay = 0) => noise(dur, { freq: 600, sweep: 2600, q: 1.2, gain: g, attack: 0.03, release: dur * 0.7, pan, delay });
  const BALL = {
    pass: (p, pan) => { thud(0.06 + p * 0.12, 110 + p * 45, pan); if (p > 0.75) whoosh(0.45, 0.025, pan, 0.03); },
    shot: (p, pan) => { thud(0.26 + p * 0.2, 165, pan); noise(0.06, { freq: 900, q: 0.5, gain: 0.12 * p, pan }); whoosh(0.55, 0.05 * p, pan, 0.03); },
    header: (pan) => { tone(230, 0.1, { gain: 0.16, slideTo: 90, pan }); noise(0.05, { freq: 1200, q: 0.6, gain: 0.06, pan }); },
    touch: (pan) => thud(0.05, 95, pan),
    bounce: (pan) => { thud(0.07, 120, pan); thud(0.035, 120, pan, 0.32); },
    tackle: (slide, pan) => { if (slide) noise(0.55, { freq: 700, q: 0.6, type: 'lowpass', gain: 0.1, attack: 0.02, release: 0.4, pan, pink: true }); thud(0.12, 140, pan, slide ? 0.25 : 0); noise(0.08, { freq: 2400, q: 1, gain: 0.05, pan, delay: slide ? 0.25 : 0 }); },
    catch: (pan) => { thud(0.18, 90, pan); noise(0.05, { freq: 1500, q: 1.5, gain: 0.08, pan, delay: 0.01 }); },
    punch: (pan) => { noise(0.04, { freq: 2600, q: 1.1, gain: 0.16, pan }); thud(0.15, 180, pan); },
    net: (pan) => { noise(0.45, { freq: 3200, q: 0.6, type: 'highpass', gain: 0.12, attack: 0.01, release: 0.35, pan }); noise(0.3, { freq: 600, q: 0.8, gain: 0.05, pan, delay: 0.03 }); },
    post: (pan) => { [880, 1325, 2390, 3610].forEach((f, i) => tone(f, 1.2 - i * 0.2, { gain: 0.07 / (i + 1), pan, type: 'sine', attack: 0.002 })); thud(0.2, 160, pan); },
    longKick: (pan) => { thud(0.3, 150, pan); whoosh(0.7, 0.04, pan, 0.05); },
  };

  // ── player voices: short formant shouts (no words), panned to the player, with cooldowns ──
  function shout(pan, { pitch = 170, vowel = 'e', dur = 0.24, gain = 0.07, fall = 0.8, delay = 0, syll = 1 } = {}) {
    for (let s = 0; s < syll; s++) {
      const d = delay + s * (dur + 0.06), t = now() + d;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(pitch * rnd(0.95, 1.08), t); o.frequency.exponentialRampToValueAtTime(pitch * fall, t + dur);
      const g = ctx.createGain(); env(g, t, gain, 0.02, dur, dur * 0.5);
      const dst = out(bus.voices, pan);
      VOWEL[s % 2 && vowel === 'e' ? 'a' : vowel].forEach((f, i) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6; const fg = ctx.createGain(); fg.gain.value = [1, 0.5, 0.2][i]; o.connect(bp); bp.connect(fg); fg.connect(g); });
      g.connect(dst); o.start(t); o.stop(t + dur + 0.02);
    }
  }
  const VOICE = {
    call: (pan) => shout(pan, { pitch: rnd(150, 210), vowel: ['e', 'a', 'o'][vary('call', 3)], syll: 1 + (Math.random() < 0.5), dur: 0.18 }),
    warn: (pan) => shout(pan, { pitch: rnd(170, 230), vowel: 'a', syll: 2, dur: 0.14, gain: 0.08 }),
    keeper: (pan) => shout(pan, { pitch: rnd(120, 150), vowel: ['o', 'a'][vary('gk', 2)], syll: 2 + (Math.random() < 0.5), dur: 0.2, gain: 0.09, fall: 0.9 }),
    celebrate: (pan) => { for (let i = 0; i < 4; i++) shout(pan + rnd(-0.2, 0.2), { pitch: rnd(190, 260), vowel: 'e', dur: rnd(0.35, 0.6), gain: 0.07, fall: 1.15, delay: i * rnd(0.1, 0.3) }); },
    groan: (pan) => { for (let i = 0; i < 2; i++) shout(pan, { pitch: rnd(160, 200), vowel: 'a', dur: 0.6, gain: 0.05, fall: 0.6, delay: i * 0.15 }); },
    appeal: (pan) => { for (let i = 0; i < 3; i++) shout(pan + rnd(-0.15, 0.15), { pitch: rnd(170, 230), vowel: ['e', 'a'][i % 2], dur: 0.3, gain: 0.06, fall: 1.2, delay: i * 0.12 }); },
  };

  // ── crowd: two sections with their own beds and reactions ──
  function section(gainVal, pan, voices) {
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(out(bus.crowd, pan));
    const stop = [];
    const src = ctx.createBufferSource(); src.buffer = pinkBuf; src.loop = true; src.playbackRate.value = rnd(0.9, 1.1);
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 650; band.Q.value = 0.5;
    src.connect(band); band.connect(g); src.start(); stop.push(src);
    const vg = ctx.createGain(); vg.gain.value = 0.045; vg.connect(g);
    const form = ctx.createBiquadFilter(); form.type = 'bandpass'; form.frequency.value = 760; form.Q.value = 1.5; form.connect(vg);
    for (let i = 0; i < voices; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 105 + i * 19 + Math.random() * 14;
      const l = ctx.createOscillator(); l.frequency.value = rnd(0.06, 0.25);
      const lg = ctx.createGain(); lg.gain.value = rnd(6, 14);
      l.connect(lg); lg.connect(o.frequency); o.connect(form); o.start(); l.start(); stop.push(o, l);
    }
    g.gain.setTargetAtTime(gainVal, now(), 0.8);
    return { g, band, vg, stop, base: gainVal, pan };
  }
  function crowd(on, vol) {
    if (!on) { stopCrowd(); return; }
    if (!init() || crowdNodes) return;
    resume();
    if (vol != null) setVolume(vol);
    const rumble = ctx.createBufferSource(); rumble.buffer = noiseBuf; rumble.loop = true; rumble.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const rg = ctx.createGain(); rg.gain.value = 0.06; rumble.connect(lp); lp.connect(rg); rg.connect(bus.crowd); rumble.start();
    crowdNodes = { home: section(0.085, -0.15, 7), away: section(0.026, 0.75, 4), rumble };
    level = 0;
    chantTimer = setInterval(() => { if (Math.random() < 0.6) chant(Math.random() < 0.78 ? 'home' : 'away'); }, 8500);
    setTimeout(() => chant('home'), 2200);
  }
  function stopCrowd() {
    if (chantTimer) { clearInterval(chantTimer); chantTimer = null; }
    if (!crowdNodes || !ctx) return;
    const n = crowdNodes, t = now();
    for (const s of [n.home, n.away]) { s.g.gain.cancelScheduledValues(t); s.g.gain.setTargetAtTime(0.0001, t, 0.4); }
    setTimeout(() => { try { [...n.home.stop, ...n.away.stop, n.rumble].forEach(x => x.stop()); } catch (e) { /* already stopped */ } }, 1600);
    crowdNodes = null;
  }
  // A terrace chant: drum and claps in one of several rhythms, with a sung line (detuned choir through vowel formants).
  const TUNES = [[0, 0, 4, 0, 7, 4], [7, 7, 9, 7, 4, 0], [0, 4, 7, 12, 7, 4], [5, 4, 2, 0, 2, 4], [0, 2, 4, 5, 4, 2, 0]];
  const RHYTHMS = [[0, 0.5, 1, 1.25, 1.5, 2.5, 3, 3.5, 3.75, 4], [0, 0.4, 0.8, 1.6, 2, 2.4, 3.2, 3.6, 4], [0, 0.75, 1, 1.75, 2, 2.75, 3, 3.75], [0, 1, 1.5, 2, 3, 3.5, 4]];
  function chant(who = 'home') {
    if (!crowdNodes || !ctx || suspended) return;
    const s = crowdNodes[who], away = who === 'away', k = away ? 0.4 : 1;
    const pan = s.pan;
    for (const t of RHYTHMS[vary('rh' + who, RHYTHMS.length)]) { clap(t, (0.06 + level * 0.04) * k, pan); if (Math.abs(t - Math.round(t)) < 0.01) tone(92, 0.22, { gain: 0.15 * k, slideTo: 50, delay: t, dest: bus.crowd, pan }); }
    const tune = TUNES[vary('tune' + who, TUNES.length)], root = rnd(196, 247), step = 0.62;
    const vowel = ['o', 'e', 'a'][vary('cv' + who, 3)];
    tune.forEach((semi, i) => {
      const f = root * 2 ** (semi / 12), t = now() + 0.1 + i * step;
      const g = ctx.createGain(); env(g, t, (0.05 + level * 0.03) * k, 0.06, step * 0.95, 0.12); g.connect(out(bus.crowd, pan));
      for (let v = 0; v < 6; v++) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * rnd(0.985, 1.015) * (v % 3 === 0 ? 0.5 : 1);
        VOWEL[vowel].forEach((ff, j) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = 5; const fg = ctx.createGain(); fg.gain.value = [0.5, 0.3, 0.1][j]; o.connect(bp); bp.connect(fg); fg.connect(g); });
        o.start(t); o.stop(t + step);
      }
    });
  }
  const clap = (delay, g = 0.11, pan = null) => { noise(0.07, { freq: 1500, q: 0.9, gain: g, attack: 0.004, release: 0.05, delay, dest: bus.crowd, pan }); noise(0.05, { freq: 2600, q: 1.2, gain: g * 0.5, attack: 0.004, release: 0.04, delay: delay + 0.008, dest: bus.crowd, pan }); };
  function applause(dur, density, gain, pan) { for (let i = 0; i < dur * density; i++) clap(rnd(0, dur), gain * rnd(0.5, 1), pan + rnd(-0.3, 0.3)); }
  function fansWhistle(n, pan, delay = 0) { for (let i = 0; i < n; i++) { const f = rnd(1800, 3100); tone(f, rnd(0.5, 1.2), { gain: 0.012, delay: delay + rnd(0, 0.8), slideTo: f * rnd(0.85, 1.12), dest: bus.crowd, pan: pan + rnd(-0.4, 0.4), attack: 0.05 }); } }
  const CROWD = {
    roar: (who, big = 1) => {
      const pan = crowdNodes ? crowdNodes[who].pan : 0, g = who === 'home' ? 1 : 0.38;
      voiceNoise(5, 'a', { gain: 0.6 * g * big, attack: 0.18, release: 2.4, slide: 1.12, pan });
      voiceNoise(4.4, ['e', 'a'][vary('roar', 2)], { gain: 0.3 * g * big, attack: 0.4, release: 2, delay: 0.2, slide: 1.08, pan });
      noise(4.6, { freq: 900, q: 0.4, gain: 0.3 * g * big, attack: 0.25, release: 2.2, dest: bus.crowd, pan, pink: true });
      if (who === 'home' && Math.random() < 0.6) for (const [f, d] of [[415, 0.9], [523, 0.9], [415, 2.1], [523, 2.1]]) tone(f, 0.75, { type: 'sawtooth', gain: 0.04, delay: d, dest: bus.crowd, pan });
      applause(4, 14, 0.07 * g, pan);
    },
    groan: (who) => { const pan = crowdNodes ? crowdNodes[who].pan : 0, g = who === 'home' ? 1 : 0.4; voiceNoise(2.2, 'o', { gain: 0.32 * g, attack: 0.12, release: 1.4, slide: 0.68, pan }); voiceNoise(1.6, 'u', { gain: 0.1 * g, attack: 0.3, release: 1, delay: 0.4, pan }); },
    ooh: (who, big) => { const pan = crowdNodes ? crowdNodes[who].pan : 0, g = who === 'home' ? 1 : 0.45; voiceNoise(rnd(1.3, 1.9), ['o', 'u'][vary('ooh', 2)], { gain: (0.24 + 0.14 * big) * g, attack: 0.12, release: 1, slide: rnd(0.66, 0.8), pan }); },
    gasp: (who) => { const pan = crowdNodes ? crowdNodes[who].pan : 0; noise(0.5, { freq: 2200, q: 0.7, gain: 0.08, attack: 0.04, release: 0.4, dest: bus.crowd, pan, sweep: 1400 }); },
    applaud: (who, dur = 2.5) => applause(dur, 12, who === 'home' ? 0.06 : 0.025, crowdNodes ? crowdNodes[who].pan : 0),
    boo: (who) => { const pan = crowdNodes ? crowdNodes[who].pan : 0, g = who === 'home' ? 1 : 0.4; voiceNoise(2.6, 'u', { gain: 0.22 * g, attack: 0.3, release: 1.2, slide: 0.88, pan }); voiceNoise(2.2, 'o', { gain: 0.1 * g, attack: 0.4, release: 1, delay: 0.3, slide: 0.9, pan }); },
    whistleFans: (who) => fansWhistle(who === 'home' ? 14 : 5, crowdNodes ? crowdNodes[who].pan : 0),
  };

  // 0 = quiet midfield, 1 = a goal is coming. The section whose team attacks rises more.
  function excite(x, side) {
    if (!crowdNodes || !ctx) return;
    level = Math.max(0, Math.min(1, Number(x) || 0));
    attackSide = side || attackSide;
    const t = now();
    for (const who of ['home', 'away']) {
      const s = crowdNodes[who], mine = attackSide === who, lv = level * (mine ? 1 : 0.35);
      s.g.gain.setTargetAtTime(s.base * (1 + lv * 1.9), t, 0.35);
      s.band.frequency.setTargetAtTime(650 + lv * 560, t, 0.4);
      s.vg.gain.setTargetAtTime(0.045 + lv * 0.12, t, 0.4);
    }
  }
  // Speech or a goal: dip the crowd (amount 0..1) for a while; boost it back afterwards.
  function duck(amount, dur = null) {
    if (!duckGain) return;
    const t = now();
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setTargetAtTime(Math.max(0.2, 1 - amount), t, 0.15);
    if (dur) duckGain.gain.setTargetAtTime(1, t + dur, 0.4);
  }

  // ── events from the match ──
  // data: { side ('home'|'away'), x (0..1 along the pitch), power (0..1), kind, ... }
  function event(type, d = {}) {
    if (!init() || suspended) return;
    if (ctx.state === 'suspended') ctx.resume();
    log.push([Math.round(performance.now()), type, d.side || '']); if (log.length > 300) log.shift();
    const pan = d.x != null ? (d.x - 0.5) * 1.4 : 0, side = d.side, other = side === 'home' ? 'away' : 'home';
    switch (type) {
      case 'KICK_OFF': REF.kickoff(); if (crowdNodes) { CROWD.applaud('home', 3); CROWD.applaud('away', 2); } break;
      case 'RESTART': REF.restart(); break;
      case 'PASS': if (d.long) { BALL.pass(Math.max(0.8, d.power || 0.8), pan); } else BALL.pass(d.power || 0.4, pan); if (d.call && ready('call', 2.5)) VOICE.call(pan + 0.05); break;
      case 'TOUCH': BALL.touch(pan); break;
      case 'HEADER': BALL.header(pan); break;
      case 'BOUNCE': BALL.bounce(pan); break;
      case 'TACKLE': BALL.tackle(!!d.slide, pan); if (crowdNodes && ready('tkl', 6)) (d.slide ? CROWD.applaud : CROWD.gasp)(side === 'home' ? 'home' : 'away', 1.2); break;
      case 'PRESS': if (ready('warn', 7)) VOICE.warn(pan); break;
      case 'GK_SHOUT': if (ready('gk', 9)) VOICE.keeper(pan); break;
      case 'LONG_KICK': BALL.longKick(pan); break;
      case 'SHOOT': BALL.shot(d.power || 1, pan); if (crowdNodes) CROWD.gasp(side === 'home' ? 'home' : 'away'); break;
      case 'GOAL':
        BALL.net(pan);
        if (crowdNodes) { CROWD.roar(side, 1); if (side === 'away') { CROWD.groan('home'); if (Math.random() < 0.5) setTimeout(() => crowdNodes && CROWD.whistleFans('home'), 1500); } }
        setTimeout(() => !suspended && REF.goal(), 900);
        setTimeout(() => !suspended && ctx && VOICE.celebrate(pan), 500);
        duck(-0.25, 5);                                   // the crowd is dominant during the celebration
        break;
      case 'SAVE':
        if (d.kind === 'catch') BALL.catch(pan); else if (d.kind === 'punch') BALL.punch(pan); else BALL.catch(pan);
        if (crowdNodes) { CROWD.ooh(side, 1); CROWD.applaud(other, 2); }
        break;
      case 'MISS': if (crowdNodes) CROWD.ooh(side, d.close ? 1 : 0.4); if (ready('groan', 4)) setTimeout(() => ctx && VOICE.groan(pan), 300); break;
      case 'WOODWORK': BALL.post(pan); if (crowdNodes) { CROWD.ooh(side, 1.2); CROWD.gasp(other); } break;
      case 'FOUL': REF.foul(); if (ready('appeal', 5)) VOICE.appeal(pan); break;
      case 'CARD':
        REF.card();
        if (crowdNodes) { if (side === 'away') CROWD.applaud('home', 1.5); else { CROWD.boo('home'); if (d.color === 'red') CROWD.whistleFans('home'); } }
        setTimeout(() => ctx && VOICE.appeal(pan), 450);
        break;
      case 'INJURY': REF.stoppage(); if (crowdNodes) CROWD.gasp(side); setTimeout(() => crowdNodes && CROWD.applaud('home', 2), 3500); break;
      case 'SUB': if (crowdNodes) CROWD.applaud(side, 2.5); break;
      case 'HALF_TIME': REF.half(); if (crowdNodes) { CROWD.applaud('home', 3); if (d.losing === 'home') CROWD.boo('home'); } break;
      case 'FULL_TIME': REF.full(); if (crowdNodes) { if (d.winner === 'home') { CROWD.roar('home', 0.6); } else if (d.winner === 'away') { CROWD.boo('home'); CROWD.roar('away', 0.8); } else CROWD.applaud('home', 4); } break;
      case 'CHIME': [659, 523].forEach((f, i) => tone(f, 0.7, { gain: 0.07, delay: i * 0.45, dest: bus.announcer, type: 'triangle' })); break;
      default: break;
    }
  }

  // ── old one-shot names (still used outside matches) ──
  const SOUNDS = {
    click: () => tone(1600, 0.03, { gain: 0.05, type: 'triangle', dest: bus.ball }),
    whistle: () => REF.kickoff(), whistle2: () => REF.half(), whistleEnd: () => REF.full(),
    pass: () => BALL.pass(0.4, 0), kick: () => BALL.shot(1, 0), net: () => BALL.net(0),
    goal: () => event('GOAL', { side: 'home' }), goalAway: () => event('GOAL', { side: 'away' }),
    save: () => event('SAVE', { side: 'home' }), miss: () => event('MISS', { side: 'home' }), card: () => event('CARD', { side: 'home' }),
    deal: () => { tone(523, 0.18, { gain: 0.12, dest: bus.ball }); tone(659, 0.3, { gain: 0.12, delay: 0.12, dest: bus.ball }); tone(784, 0.4, { gain: 0.1, delay: 0.24, dest: bus.ball }); },
    levelup: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { gain: 0.1, delay: i * 0.1, type: 'triangle', dest: bus.ball })); },
  };
  function play(name, vol) {
    if (!init()) return;
    resume();
    if (vol != null) setVolume(vol);
    const fn = SOUNDS[name];
    if (fn) fn();
  }

  function setVolume(v) { volume = Math.max(0, Math.min(1, Number(v) || 0)); if (master) master.gain.value = volume; }
  function setMix(m) { Object.assign(mix, m || {}); for (const c of CATS) if (bus[c]) bus[c].gain.value = Math.max(0, Math.min(1.2, Number(mix[c]) || 0)); }
  function suspend() { suspended = true; if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { suspended = false; if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function stopAll() { stopCrowd(); if (duckGain && ctx) { duckGain.gain.cancelScheduledValues(now()); duckGain.gain.value = 1; } }

  window.GafferSound = { play, crowd, excite, setVolume, setMix, event, duck, suspend, resume, stopAll, mix, log, CATS };
})();
