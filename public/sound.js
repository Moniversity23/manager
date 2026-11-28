// The Gaffer sound: a football ground in Web Audio.
// Real stadium recordings play the crowd, the referee and the ball: CC0 recordings from freesound.org,
// cut and levelled by tools/stadium-audio/build-stadium.py, with every source, author and licence in
// public/audio/stadium/index.json and docs/ASSET_LICENCES.md (registered before use).
//  • A match murmur loops under the play and a fuller crowd swells in as an attack builds
//    (excite(0..1) crossfades the two), as a real ground does.
//  • Each key event gets its real reaction: a goal roar (three different ones; a goal for the visitors
//    is a distant away end and groans nearby), a gasp and applause for a save, "ooh"s and groans for
//    misses, boos or jeers for cards, applause for substitutions, the referee's whistle (one long blast
//    for kick-off, two for half-time, three for full-time), passes, dribbling touches and shots.
//  • The recordings are fetched when the first match starts (the service worker keeps them for offline
//    play) and decoded in the background. Until they are ready, or if one cannot load, the original
//    synthesised ground plays that sound instead (filtered-noise "voices", a pea whistle, kicks, chants
//    with claps and a drum), so a match is never silent.
// The match sends its events through GafferSound.event(); passes and shots as the ball leaves the boot.
// Crowd, referee and ball sounds have their own volume (Settings → Match audio mixer). The recorded
// commentary (public/commentary.js) plays through voice() into the same output, and the crowd dips
// under it (duck()).
// Browsers only allow audio after a user gesture: the first tap, click or key anywhere creates the
// audio context and plays a silent sound inside that gesture (what iOS and Android require), and any
// later gesture wakes it again if the system suspended or interrupted it (a call, another app, the
// screen locking). Two things silence it on purpose and are kept apart: the app pausing (the match
// paused, a replay, leaving the match) and the tab being hidden; it plays again only when neither holds.
// Phones: small speakers cannot play the low end, which would still drive the compressor and make
// everything quieter, so on touch devices the output is high-passed and the presence range lifted.
(function () {
  let ctx = null, master = null, noiseBuf = null, crowdNodes = null, volume = 0.6, chantTimer = null, level = 0, voiceOut = null;
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
    let out = master, post = comp;
    if (phone) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.7;
      const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2400; pres.Q.value = 0.9; pres.gain.value = 4;
      master.connect(hp); hp.connect(pres); out = pres; post = hp;
    }
    out.connect(comp); comp.connect(ctx.destination);
    master.comp = comp;
    // The commentator's voice: after the master volume (commentary.js sets its own level) but through
    // the same speaker EQ and compressor as the ground.
    voiceOut = ctx.createGain(); voiceOut.gain.value = 1; voiceOut.connect(post);
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
  // A struck, ringing tone that dies away (a ball on the post, the PA chime).
  function ping(freq, dur, gain, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(OUT()); o.start(t); o.stop(t + dur + 0.02);
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
    post: () => { ping(820, 0.55, 0.12); ping(1330, 0.4, 0.06); ping(2140, 0.22, 0.03); thud(0.2, 130); },
    chime: () => { ping(784, 1.2, 0.07); ping(1568, 0.5, 0.012); ping(659, 1.6, 0.07, 0.42); ping(1318, 0.6, 0.012, 0.42); },
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

  const CAT = { whistle: 'ref', whistle2: 'ref', whistleEnd: 'ref', restart: 'ref', card: 'ref', chime: 'ref', pass: 'ball', kick: 'ball', net: 'ball', post: 'ball', click: 'ball', deal: 'ball', levelup: 'ball', goal: 'crowd', goalAway: 'crowd', save: 'crowd', miss: 'crowd' };
  function play(name, vol) {
    if (!init()) return;
    if (ctx.state !== 'running' && !appPaused && !hidden) wake();
    if (vol != null) setVolume(vol);
    const fn = SOUNDS[name];
    if (fn) using(CAT[name] || 'ball', fn);
  }

  // ── The recorded ground ──
  const REC_BASE = 'audio/stadium/';
  const MAX_REACTION_BYTES = 10 * 1024 * 1024;
  const rec = { files: null, buf: {}, order: new Map(), decodedBytes: 0, peakDecodedBytes: 0, loading: null, generation: 0, ready: false, beds: null, live: new Set(), last: {}, goal: Math.floor(Math.random() * 3) };
  const bufferBytes = b => b ? b.length * (b.numberOfChannels || 1) * 4 : 0;
  function residentReactionBytes() {
    const cached = new Set(Object.values(rec.buf)); let bytes = rec.decodedBytes;
    for (const s of rec.live) if (s.buffer && !cached.has(s.buffer)) { cached.add(s.buffer); bytes += bufferBytes(s.buffer); }
    rec.peakDecodedBytes = Math.max(rec.peakDecodedBytes, bytes); return bytes;
  }
  function trimReactions(incomingBytes = 0) {
    const live = new Set([...rec.live].map(s => s.buffer).filter(Boolean));
    while (rec.decodedBytes + incomingBytes > MAX_REACTION_BYTES && rec.order.size) {
      const name = [...rec.order.keys()].find(k => !live.has(rec.buf[k])); if (!name) break;
      const old = rec.buf[name]; rec.order.delete(name); delete rec.buf[name]; rec.decodedBytes -= bufferBytes(old);
    }
  }
  function keepReaction(name, buffer) {
    if (!buffer) return;
    if (rec.buf[name]) rec.decodedBytes -= bufferBytes(rec.buf[name]);
    rec.buf[name] = buffer; rec.order.delete(name); rec.order.set(name, true);
    rec.decodedBytes += bufferBytes(buffer);
    trimReactions();
    residentReactionBytes();
  }
  // Bed levels (calm murmur, fuller crowd) and how far the synthesised murmur steps back under them.
  const BED = { calm: 0.65, lively: 0.72, under: 0.12 };
  function decode(ab) {
    return new Promise(res => {
      try { const p = ctx.decodeAudioData(ab, b => res(b), () => res(null)); if (p && p.then) p.then(res, () => res(null)); } catch (e) { res(null); }
    });
  }
  // The two long ambience beds stream through media elements. Short event recordings decode in small
  // batches and remain in a byte-bounded LRU; the service worker retains the compressed offline files.
  function loadStadium() {
    if (rec.loading || !init() || typeof fetch !== 'function') return rec.loading;
    const generation = rec.generation;
    rec.loading = (async () => {
      try {
        const r = await fetch(REC_BASE + 'index.json'); if (!r.ok) throw new Error('index ' + r.status);
        rec.files = (await r.json()).files || {};
        const one = async n => { try { const meta = rec.files[n], f = await fetch(REC_BASE + meta.file); if (!f.ok) return; const estimated = Math.ceil((Number(meta.seconds) || 0) * (Number(meta.channels) || 1) * ctx.sampleRate * 4 * 1.03); trimReactions(estimated); const b = await decode(await f.arrayBuffer()); if (b && generation === rec.generation) keepReaction(n, b); } catch (e) { /* this sound stays synthesised */ } };
        const names = Object.keys(rec.files), rest = names.filter(n => !n.startsWith('bed-'));
        if (crowdNodes) startBeds();
        // Decode one reaction at a time so four large clips cannot temporarily sit beside
        // the whole cache on a phone. The byte LRU still allows recently used takes to be reused.
        for (const name of rest) { if (generation !== rec.generation) return false; await one(name); }
        if (generation !== rec.generation) return false;
        rec.ready = true;
        return true;
      } catch (e) { if (generation === rec.generation) { rec.files = null; rec.loading = null; } return false; }
    })();
    return rec.loading;
  }
  // Where a decoded recording's sound starts and ends: MP3 decoding pads both ends with a little
  // silence, which would be a gap every time a bed loops.
  function span(b) {
    const d = b.getChannelData(0), thr = 1e-4; let i = 0, j = d.length - 1;
    while (i < j && Math.abs(d[i]) < thr) i++;
    while (j > i && Math.abs(d[j]) < thr) j--;
    return [i / b.sampleRate, (j + 1) / b.sampleRate];
  }
  function startBeds() {
    if (rec.beds || !crowdNodes || !rec.files) return;
    if (!ctx.createMediaElementSource || !document.createElement) return;
    const loop = name => {
      const meta = rec.files[name]; if (!meta) return null;
      try {
        const el = document.createElement('audio'); if (!el || typeof el.play !== 'function') return null;
        el.__gafferName = name; el.preload = 'auto'; el.loop = true; el.src = REC_BASE + meta.file;
        const source = ctx.createMediaElementSource(el), g = ctx.createGain(); g.gain.value = 0.0001;
        source.connect(g); g.connect(bus.crowd || master);
        return { el, source, g };
      } catch (e) { return null; }
    };
    const t = ctx.currentTime, beds = { calm: loop('bed-calm'), lively: loop('bed-lively') };
    if (!beds.calm && !beds.lively) return;
    rec.beds = beds; bedLevel(1.2); crowdNodes.syn.gain.setTargetAtTime(BED.under, t, 1.2);
    const parts = [beds.calm, beds.lively].filter(Boolean);
    Promise.all(parts.map(p => Promise.resolve().then(() => p.el.play()).then(() => true, () => false))).then(ok => {
      if (rec.beds !== beds || ok.every(Boolean)) return;
      stopBeds(); // if autoplay is denied, the synthesised crowd remains audible; a later tap retries.
    });
  }
  // An equal-power crossfade from the murmur to the fuller crowd as the danger rises (a little of the
  // fuller crowd is always there, for depth).
  function bedLevel(tc = 0.6) {
    const b = rec.beds; if (!b || !ctx) return;
    const t = ctx.currentTime, x = level;
    if (b.calm) b.calm.g.gain.setTargetAtTime(Math.max(0.0001, BED.calm * Math.cos(x * Math.PI * 0.4)), t, tc);
    if (b.lively) b.lively.g.gain.setTargetAtTime(Math.max(0.0001, BED.lively * (0.12 + 0.88 * Math.sin(x * Math.PI / 2))), t, tc);
  }
  function stopBeds() {
    const b = rec.beds; rec.beds = null; if (!b || !ctx) return;
    const t = ctx.currentTime, parts = [b.calm, b.lively].filter(Boolean);
    for (const p of parts) { p.g.gain.cancelScheduledValues(t); p.g.gain.setTargetAtTime(0.0001, t, 0.5); }
    setTimeout(() => { for (const p of parts) { try { if (p.el) { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); p.source.disconnect(); } else p.s.stop(); } catch (e) { /* already stopped */ } } }, 2500);
  }
  // One recording, once: on a category's volume, optionally later, faster or slower, left or right.
  function shot(name, cat, gain = 1, { delay = 0, rate = 1, pan = 0 } = {}) {
    const b = name && rec.buf[name]; if (!b || !ctx) return false;
    if (rec.order.has(name)) { rec.order.delete(name); rec.order.set(name, true); }
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain; s.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); out = p; }
    out.connect(bus[cat] || master);
    rec.live.add(s); residentReactionBytes(); s.onended = () => { rec.live.delete(s); s.buffer = null; };
    s.start(ctx.currentTime + delay);
    return true;
  }
  // One of several takes, never the same one twice running.
  function any(names) {
    const ok = names.filter(n => rec.buf[n]); if (!ok.length) return null;
    let n = ok[Math.floor(Math.random() * ok.length)];
    if (ok.length > 1 && n === rec.last[names[0]]) n = ok[(ok.indexOf(n) + 1) % ok.length];
    rec.last[names[0]] = n; return n;
  }
  const PAN = d => (d && d.x != null && isFinite(d.x) ? (Number(d.x) - 0.5) * 0.7 : 0);   // the broadcast camera's view: the home side attacks to the right
  const TOUCHES = ['touch-1', 'touch-2', 'touch-3', 'touch-4', 'touch-5', 'touch-6'], KICKS = ['kick-1', 'kick-2', 'kick-3'], GOALS = ['goal-1', 'goal-2', 'goal-3'];
  // Each event as the recordings play it; false when a recording is missing (the synthesised sound plays).
  const RECORDED = {
    // Levels balanced on a phone (headless Chrome, phone emulation): the commentator about 10 dB
    // over the murmur, a goal roar above both, the whistle clear but not over the voice.
    KICK_OFF: () => shot('whistle-long', 'ref', 0.58),
    RESTART: () => shot('whistle-short', 'ref', 0.5),
    INJURY: () => shot('whistle-short', 'ref', 0.5),
    HALF_TIME: d => shot('whistle-long', 'ref', 0.58) && (shot('whistle-long', 'ref', 0.58, { delay: 1.15 }), d.losing === 'home' ? shot('boo', 'crowd', 0.45, { delay: 2.1 }) : shot('applause', 'crowd', 0.7, { delay: 2.1 }), true),
    FULL_TIME: d => shot('whistle-short', 'ref', 0.55) && (shot('whistle-short', 'ref', 0.55, { delay: 0.5 }), shot('whistle-long', 'ref', 0.62, { delay: 1 }),
      d.winner === 'away' ? shot('boo', 'crowd', 0.75, { delay: 2 }) : (shot('cheer', 'crowd', 0.85, { delay: 1.9 }), shot('applause', 'crowd', 0.6, { delay: 3.4 })), true),
    PASS: d => shot(any(TOUCHES), 'ball', 0.32 + 0.4 * Math.min(1, d.power ?? 0.5), { rate: d.long ? 0.82 : 0.94 + Math.random() * 0.12, pan: PAN(d) }),
    DRIBBLE: d => shot(any(TOUCHES), 'ball', 0.15 + Math.random() * 0.06, { rate: 1.08 + Math.random() * 0.16, pan: PAN(d) }),
    TOUCH: d => shot(any(TOUCHES), 'ball', 0.3, { rate: 0.86 + Math.random() * 0.1, pan: PAN(d) }),      // a first touch, a deflection
    BOUNCE: d => shot(any(TOUCHES), 'ball', 0.26, { rate: 0.72, pan: PAN(d) }),                         // a lofted pass landing
    HEADER: d => shot(any(TOUCHES), 'ball', 0.4, { rate: 0.66, pan: PAN(d) }),
    TACKLE: d => shot(any(TOUCHES), 'ball', d.slide ? 0.55 : 0.38, { rate: 0.78, pan: PAN(d) }) && (d.slide && Math.random() < 0.4 && shot('ooh', 'crowd', 0.3, { delay: 0.15 }), true),
    SHOOT: d => shot(any(KICKS), 'ball', 0.6 + 0.4 * Math.min(1, d.power ?? 1), { pan: PAN(d) }),
    SAVE: () => shot('save-gasp', 'crowd', 0.9) && (shot('applause', 'crowd', 0.55, { delay: 1.1 }), true),
    MISS: d => shot(d.close ? any(['nearmiss-2', 'ooh', 'gasp']) : any(['groan', 'ooh']), 'crowd', d.close ? 0.95 : 0.8),
    WOODWORK: () => shot(any(['ooh', 'nearmiss-2']), 'crowd', 1, { delay: 0.05 }) && (using('ball', SOUNDS.post), true),
    GOAL: d => (d.side === 'away' ? shot('goal-away', 'crowd', 1.2, { pan: -0.25 }) : shot(any([GOALS[rec.goal++ % 3]]) || any(GOALS), 'crowd', 1.5)) && (using('ball', SOUNDS.net), true),
    CARD: d => shot('whistle-short', 'ref', 0.5) && (shot(d.side === 'home' ? 'boo' : 'applause', 'crowd', d.color === 'red' ? 0.85 : 0.55, { delay: 0.45 }), true),
    SUB: () => shot('applause', 'crowd', 0.45),
  };

  // Key match events → sounds. Synthesised fallbacks for the big moments; small touches are only heard
  // from the recordings (synthesised, they cluttered the sound).
  const EVENTS = { KICK_OFF: 'whistle', RESTART: 'restart', INJURY: 'restart', PASS: 'pass', SHOOT: 'kick', SAVE: 'save', MISS: 'miss', WOODWORK: 'miss', CARD: 'card', HALF_TIME: 'whistle2', FULL_TIME: 'whistleEnd' };
  const MIN_GAP = { DRIBBLE: 230, TOUCH: 120, BOUNCE: 120, HEADER: 200, TACKLE: 300 };     // ms: a burst of touches is not a machine gun
  function event(type, d = {}) {
    if (appPaused || hidden) return;
    const name = type === 'GOAL' ? (d.side === 'away' ? 'goalAway' : 'goal') : EVENTS[type], recorded = RECORDED[type];
    if (!name && !recorded) return;
    const now = performance.now();
    if (MIN_GAP[type]) { if (now - (rec.last['@' + type] || -1e9) < MIN_GAP[type]) return; rec.last['@' + type] = now; }
    log.push([Math.round(now), type, d.side || '']); if (log.length > 300) log.shift();
    if (!init()) return;
    if (ctx.state !== 'running' && !appPaused && !hidden) wake();
    let done = false;
    if (recorded && rec.files) { try { done = !!recorded(d || {}); } catch (e) { done = false; } }
    if (!done && name) play(name);
  }

  // A terrace chant: drum and claps in a football rhythm, with a sung line underneath (the sung line
  // only without the recordings, which carry the voices).
  function chant() {
    if (!crowdNodes || !ctx || appPaused || hidden) return;
    using('crowd', chantNow);
  }
  function chantNow() {
    const k = rec.beds ? 0.6 : 1;
    const pattern = Math.random() < 0.5 ? [0, 0.5, 1, 1.25, 1.5, 2.5, 3, 3.5, 3.75, 4] : [0, 0.4, 0.8, 1.6, 2, 2.4, 3.2, 3.6, 4];
    pattern.forEach(t => { clap(t, (0.07 + level * 0.04) * k); if (Math.abs(t - Math.round(t)) < 0.01) drum(t, 0.16 * k); });
    if (!rec.beds) voiceNoise(4.4, Math.random() < 0.5 ? 'o' : 'e', { gain: 0.1 + level * 0.06, attack: 0.5, release: 1.2 });
  }

  // Looping crowd bed: the recorded murmur when it is ready, over a synthesised one that steps back
  // under it (and carries the crowd alone until then, or without the recordings).
  function crowd(on, vol) {
    if (!on) {
      if (chantTimer) { clearInterval(chantTimer); chantTimer = null; }
      stopBeds();
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
    const syn = ctx.createGain(); syn.gain.value = 1; syn.connect(bus.crowd || master);
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(syn);
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
    crowdNodes = { g, band, vg, syn, stop };
    level = 0;
    chantTimer = setInterval(() => { if (Math.random() < (rec.beds ? 0.35 : 0.55)) chant(); }, 9000);
    setTimeout(chant, 2500);
    if (rec.files) startBeds(); else loadStadium();
  }

  // 0 = quiet midfield, 1 = a goal is coming / being celebrated.
  function excite(x) {   // (a second argument, the attacking side, is accepted and ignored)
    if (!crowdNodes || !ctx) return;
    level = Math.max(0, Math.min(1, Number(x) || 0));
    const t = ctx.currentTime;
    crowdNodes.g.gain.setTargetAtTime(0.085 + level * 0.16, t, 0.35);
    crowdNodes.band.frequency.setTargetAtTime(700 + level * 520, t, 0.4);
    crowdNodes.vg.gain.setTargetAtTime(0.05 + level * 0.12, t, 0.4);
    bedLevel();
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
  function release() {
    rec.generation++; rec.loading = null; rec.ready = false;
    crowd(false); duck(0);
    for (const s of rec.live) { try { s.stop(); } catch (e) { /* already ended */ } }
    for (const s of rec.live) { try { s.buffer = null; } catch (e) { /* stopped */ } }
    rec.live.clear(); rec.buf = {}; rec.order.clear(); rec.decodedBytes = 0; rec.last = {};
  }
  function stopAll() { release(); }
  // A gesture: create the context (first time), play one silent sample inside the gesture, wake it.
  function unlock() {
    if (!init()) return;
    if (!unlocked) { try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); unlocked = true; } catch (e) { /* tried again on the next gesture */ } }
    if (crowdNodes && rec.files && !rec.beds) startBeds();
    if (!appPaused && !hidden) wake();
  }
  if (typeof document !== 'undefined') {
    for (const g of ['pointerdown', 'touchend', 'keydown', 'click']) document.addEventListener(g, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; apply(); });
    window.addEventListener('pageshow', () => { hidden = document.hidden; apply(); });
    window.addEventListener('pagehide', () => { hidden = true; apply(); });
  }
  // The commentary's way in: the audio context and the voice output (created on demand, like play()).
  function voice() { return init() ? { ctx, out: voiceOut, running: ctx.state === 'running' } : null; }
  // Fetches the recordings without decoding them, so the service worker has them for offline play.
  async function prefetch() {
    if (typeof fetch !== 'function') return 0;
    try {
      const files = (await (await fetch(REC_BASE + 'index.json')).json()).files || {};
      let n = 0; for (const f of Object.values(files)) { try { if ((await fetch(REC_BASE + f.file)).ok) n++; } catch (e) { /* next time */ } }
      return n;
    } catch (e) { return 0; }
  }
  // For checks: the state of the audio, and the level at the output (RMS, 0..1) over the last frame.
  function state() { const residentBytes = residentReactionBytes(); return { context: ctx ? ctx.state : 'none', unlocked, appPaused, hidden, crowd: !!crowdNodes, volume, mix: { ...mix }, phone, sampleRate: ctx ? ctx.sampleRate : null, decodedBytes: residentBytes, cacheBytes: rec.decodedBytes, peakDecodedBytes: rec.peakDecodedBytes, decodedBuffers: Object.keys(rec.buf).length, recorded: { ready: rec.ready, loaded: Object.keys(rec.buf).length, decodedBytes: residentBytes, cacheBytes: rec.decodedBytes, peakDecodedBytes: rec.peakDecodedBytes, decodedLimitBytes: MAX_REACTION_BYTES, beds: !!rec.beds, bedMode: rec.beds ? 'media-stream' : 'stopped-or-synth', playing: rec.live.size } }; }
  function outputLevel() {
    if (!ctx || !master) return 0;
    if (!meter) { meter = ctx.createAnalyser(); meter.fftSize = 2048; master.comp.connect(meter); }
    const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a);
    let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
    return Math.sqrt(sum / a.length);
  }

  window.GafferSound = { play, crowd, excite, setVolume, setMix, event, duck, suspend, resume, stopAll, release, unlock, state, level: outputLevel, mix, log, voice, preload: loadStadium, prefetch, recordings: () => Object.keys(rec.buf) };
})();
