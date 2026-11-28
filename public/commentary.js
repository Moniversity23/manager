// The Gaffer — match commentary and stadium announcements.
//
// The commentator is a recorded voice: a mature British male broadcaster's voice, made once for the
// game with Kokoro-82M (Apache-2.0 weights, run offline by tools/commentary/build-commentary.py) from
// an original script (tools/commentary/lines.mjs). Every line and every surname the game can give a
// player ships as a small MP3 in audio/commentary/ (index.json lists them), so nothing is generated
// during a match, nothing needs a connection (the service worker keeps the files) and nothing costs
// anything to run. A call is put together as a broadcaster would say it: the player's name, the line,
// and for goals and results a line for the situation ("Goal! … Okafor! … And they're in front!",
// "It's two-one. To the home side."). Every line is also shown as a caption.
// Only what happened is said: each call comes from a real match event with its real names and score,
// and quiet play stays quiet (cooldowns, priorities, and lines dropped when they would be late).
// Voices (Settings → Commentary voice): the recorded commentator (default), the device's own speech
// (Web Speech API; for other languages and as the old option), or captions only. The stadium
// announcer is a chime and a caption with the recorded voice (its lines name clubs and numbers that
// cannot be recorded in advance), and speaks with the device voice when that is chosen.
// Rules: lines are never repeated back to back (the last uses of each bank are remembered);
// each event kind has a cooldown; only important lines are spoken at 4× and 8×; stale lines
// are dropped instead of lagging behind the match; a goal or announcement outranks chatter.
(function () {
  const PHRASES = {
    en: {
      kickoff: ['And we are under way here, {home} against {away}.', 'The referee blows, and {comp} football is back.', "{away} and {home}, let's get started."],
      kickoff2: ['The second half is under way.', "We're back for the second half here.", "And they're off again: forty-five minutes to go."],
      build: ['{player} brings it forward for {club}.', '{player} on the ball, looking for options.', '{club} keeping it nicely now.', 'Patient stuff from {club}.', '{player} carrying it into midfield.'],
      attack: ['A dangerous attack developing for {club}!', '{club} break forward in numbers.', 'This is promising for {club}.', '{player} is in space here!', 'Here come {club}!'],
      shot: ['{player} shoots!', '{player} lets fly!', 'A strike from {player}!', 'Has a go, {player}!'],
      goal: ['Goal! {player} scores for {club}!', "It's in! {player}! What a finish!", 'What a fantastic goal by {player}!', '{player} finds the net! {club} have scored!', "Goal! And it's {player} for {club}!"],
      score: ['{home} {hs}, {away} {as}.', 'That makes it {home} {hs}, {away} {as}.', "And it's {hs} {as} now."],
      save: ['A wonderful save by {keeper}!', 'Kept out by {keeper}!', '{keeper} gets down well to save.', 'Good hands from {keeper}.', "Denied! {keeper}'s save."],
      punch: ['{keeper} punches it clear!', 'Fisted away by {keeper}.'],
      miss: ['Just wide! So close from {player}.', 'Over the bar.', "That was a close attempt from {player}.", 'Wide of the post.', '{player} will be disappointed with that one.'],
      woodwork: ['Off the post! {player} so unlucky!', 'It hits the woodwork!', 'Off the crossbar! Inches away!'],
      yellow: ['The referee books {player}.', 'A yellow card for {player} of {club}.', "{player} goes into the book."],
      red: ["Red card! {player} is sent off, and {club} are down to ten.", "Off he goes! {player} sees red."],
      injury: ['{player} is down and needs treatment.', 'A worry for {club}: {player} is hurt.'],
      sub: ['A change for {club}: {in} replaces {out}.', 'Substitution, {club}. {out} makes way for {in}.'],
      half: ["That's half-time. {home} {hs}, {away} {as}.", "The referee blows for half-time. It's {hs} {as}."],
      full: ["And that's the final whistle! {home} {hs}, {away} {as}.", "It's all over here. {home} {hs}, {away} {as}."],
      replay: ["Let's see that again.", 'Have another look at this.', 'Here it is again.'],
      late: ['We are into the final minutes here.', 'Time running out for {club}.'],
      // Play-by-play from the match timeline (real actions by the real players).
      dribble: ['{player} takes on his man!', 'Lovely footwork from {player}.', '{player} skips past the challenge.', '{player} runs at the defence.'],
      cross: ['{player} whips in a cross!', 'The cross comes in from {player}.', '{player} looks for a head in the box.'],
      through: ['Lovely ball through from {player}!', '{player} threads it through!', 'A defence-splitting pass from {player}.'],
      longball: ['{player} goes long.', 'A long ball forward from {player}.'],
      tackle: ['Strong tackle from {player}.', 'Won back by {player} with a good challenge.', '{player} times that tackle perfectly.'],
      interception: ['{player} reads it and intercepts.', 'Cut out by {player}.', 'Good anticipation from {player}.'],
      keepball: ['{club} keeping it nicely: {n} passes in this move.', 'Patient from {club}. That is {n} passes now.', '{club} are passing them around, {n} in a row.'],
    },
  };
  // Stadium announcer (the PA): spoken more slowly with a different voice, after a chime.
  const PA = {
    en: {
      welcome: 'Good afternoon, and welcome to {home} for this {comp} match against {away}. Today\'s attendance is {att}.',
      lineup: 'Your {home} team today: {names}.',
      goal: '{club} goal, scored by number {num}, {player}{assist}.',
      assist: ', assisted by {who}',
      sub: 'Substitution for {club}: number {outNum}, {out}, is replaced by number {inNum}, {in}.',
      added: 'There will be a minimum of {n} minutes of added time.',
      half: 'Half-time: {home} {hs}, {away} {as}.',
      full: 'Full-time: {home} {hs}, {away} {as}. Thank you for your support, and have a safe journey home.',
    },
  };
  const PRIORITY = { goal: 10, score: 9, full: 9, half: 8, red: 8, woodwork: 7, save: 7, punch: 7, shot: 6, miss: 6, sub: 5, yellow: 5, injury: 5, kickoff: 5, kickoff2: 5, replay: 4, attack: 4, late: 3, through: 3, cross: 3, keepball: 2, dribble: 2, tackle: 2, interception: 2, longball: 1, build: 1 };
  const COOLDOWN = { build: 14, attack: 7, shot: 1, late: 60, dribble: 12, cross: 8, through: 10, longball: 16, tackle: 12, interception: 12, keepball: 25 };
  const IMPORTANT_FAST = new Set(['goal', 'score', 'full', 'half', 'red', 'kickoff', 'kickoff2']);
  let opts = { lang: 'en', speech: true, captions: true, commentary: true, announcer: true, volume: 0.9, paVolume: 0.8, speed: 1, voice: 'recorded' };
  let caption = () => {}, onSpeak = () => {};
  const recent = {}, cool = {};
  const queue = [];
  let speaking = null, voices = [], unlocked = false;
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (synth) { const load = () => { voices = synth.getVoices() || []; }; load(); if (synth.addEventListener) synth.addEventListener('voiceschanged', load); }

  const fill = (s, d) => s.replace(/\{(\w+)\}/g, (_, k) => (d[k] != null ? String(d[k]) : ''));
  function pick(kind) {
    const bank = (PHRASES[opts.lang] || PHRASES.en)[kind];
    if (!bank) return null;
    const r = recent[kind] || (recent[kind] = []);
    let i, n = 0;
    do { i = Math.floor(Math.random() * bank.length); n++; } while (r.includes(i) && n < 12);
    r.push(i); if (r.length > Math.max(1, bank.length - 2)) r.shift();
    return bank[i];
  }
  function voiceFor(pa) {
    const en = voices.filter(v => (v.lang || '').toLowerCase().startsWith(opts.lang));
    if (!en.length) return null;
    const gb = en.filter(v => /GB|UK|en-gb|Daniel|Arthur/i.test(v.name + v.lang));
    const pool = gb.length ? gb : en;
    return pa ? (pool[1] || en[1] || pool[0]) : pool[0];
  }

  // ── The recorded commentator ──
  const BASE = 'audio/commentary/';
  const LEVEL = 0.62;                 // the voice over the ground: about 10 dB above the crowd's murmur
  const MAX_DECODED = 48, MAX_DECODED_BYTES = 7 * 1024 * 1024;
  const R = { index: null, loading: null, generation: 0, banks: {}, names: {}, namesX: {}, lower: {}, bytes: new Map(), byteSizes: new Map(), compressedBytes: 0, pending: new Map(), decoded: new Map(), live: new Set(), decodedBytes: 0, peakDecodedBytes: 0, recent: {} };
  const bufferBytes = b => b ? b.length * (b.numberOfChannels || 1) * 4 : 0;
  function residentDecodedBytes() {
    const cached = new Set(R.decoded.values()); let bytes = R.decodedBytes;
    for (const s of R.live) if (s.buffer && !cached.has(s.buffer)) { cached.add(s.buffer); bytes += bufferBytes(s.buffer); }
    R.peakDecodedBytes = Math.max(R.peakDecodedBytes, bytes); return bytes;
  }
  const audio = () => { try { return window.GafferSound && window.GafferSound.voice ? window.GafferSound.voice() : null; } catch (e) { return null; } };
  function loadIndex() {
    if (R.index) return Promise.resolve(R.index);
    if (R.loading || typeof fetch !== 'function') return R.loading || Promise.resolve(null);
    R.loading = fetch(BASE + 'index.json').then(r => (r.ok ? r.json() : null)).then(ix => {
      if (!ix || !ix.lines) throw new Error('no commentary index');
      R.banks = {};
      for (const [id, l] of Object.entries(ix.lines)) (R.banks[l.kind] || (R.banks[l.kind] = [])).push(id);
      R.names = ix.names || {}; R.namesX = ix.namesX || {};
      R.lower = {}; for (const n of Object.keys(R.names)) R.lower[n.toLowerCase()] = n;
      R.index = ix; return ix;
    }).catch(() => { R.loading = null; return null; });
    return R.loading;
  }
  function bytes(file) {
    let p = R.bytes.get(file);
    if (!p) {
      p = fetch(BASE + file).then(r => (r.ok ? r.arrayBuffer() : null)).then(ab => { if (ab) { R.byteSizes.set(file, ab.byteLength); R.compressedBytes += ab.byteLength; } return ab; }).catch(() => null);
      R.bytes.set(file, p); p.then(b => { if (!b) R.bytes.delete(file); });
    }
    return p;
  }
  async function decoded(file) {
    if (R.decoded.has(file)) { const b = R.decoded.get(file); R.decoded.delete(file); R.decoded.set(file, b); return b; }
    if (R.pending.has(file)) return R.pending.get(file);
    const V = audio(); if (!V) return null;
    const generation = R.generation;
    const task = (async () => {
      let b = null;
      try {
        const ab = await bytes(file); if (ab) b = await new Promise(res => { try { const p = V.ctx.decodeAudioData(ab.slice(0), res, () => res(null)); if (p && p.then) p.then(res, () => res(null)); } catch (e) { res(null); } });
      } finally {
        R.bytes.delete(file); R.compressedBytes = Math.max(0, R.compressedBytes - (R.byteSizes.get(file) || 0)); R.byteSizes.delete(file);
      }
      if (b && generation === R.generation) {
        R.decoded.set(file, b); R.decodedBytes += bufferBytes(b);
        while (R.decoded.size > MAX_DECODED || (R.decodedBytes > MAX_DECODED_BYTES && R.decoded.size > 1)) {
          const oldest = R.decoded.keys().next().value, old = R.decoded.get(oldest); R.decoded.delete(oldest); R.decodedBytes -= bufferBytes(old);
        }
        residentDecodedBytes();
      }
      return generation === R.generation ? b : null;
    })();
    R.pending.set(file, task);
    try { return await task; } finally { if (R.pending.get(file) === task) R.pending.delete(file); }
  }
  // The surname as recorded ("Okafor" for "Chidi Okafor"; accents and case forgiven).
  function nameOf(full) {
    const s = String(full || '').trim().split(/\s+/).pop(); if (!s) return null;
    return R.names[s] ? s : R.lower[s.toLowerCase()] || null;
  }
  function line(kind, ok) {
    const bank = (R.banks[kind] || []).filter(id => !ok || ok(R.index.lines[id])); if (!bank.length) return null;
    const r = R.recent[kind] || (R.recent[kind] = []);
    let id, n = 0;
    do { id = bank[Math.floor(Math.random() * bank.length)]; n++; } while (r.includes(id) && n < 12);
    r.push(id); if (r.length > Math.max(1, bank.length - 2)) r.shift();
    return id;
  }
  const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
  const ROLE = { player: 'player', keeper: 'keeper', in: 'in' };
  // What happened → the recordings to play, in order, and the caption they make.
  function compose(kind, d) {
    const L = R.index && R.index.lines; if (!L) return null;
    const parts = [];
    const lineP = (id, gap = 0.1) => { const l = L[id]; if (l) parts.push({ file: l.file, text: l.text, gap }); return l; };
    const nameP = (who, called) => { const n = nameOf(who); if (!n) return false; parts.push({ file: (called && R.namesX[n]) || R.names[n], text: n, called, rate: called && !R.namesX[n] ? 1.07 : 1, gap: called ? 0.05 : 0.12 }); return true; };
    const scoreId = (hs, as) => { const a = Math.max(hs, as), b = Math.min(hs, as); return a === b ? (a >= 1 && a <= 6 ? `s${a}${a}` : null) : a <= 9 ? `s${a}${b}` : null; };
    const hs = Number(d.hs), as = Number(d.as), known = Number.isFinite(hs) && Number.isFinite(as);
    if (kind === 'goal') {
      lineP(line('goal'), 0.08);
      nameP(d.player, true);
      if (known && (d.side === 'home' || d.side === 'away')) {
        const us = d.side === 'home' ? hs : as, them = d.side === 'home' ? as : hs, late = Number(d.min) >= 85;
        const ctx = us === them ? (late ? 'goalLate2' : 'goalLevel') : us === them + 1 ? (late ? 'goalLate' : 'goalAhead')
          : us > them + 1 ? (us - them === 2 ? 'goalMore' : 'goalPraise') : (them - us >= 2 && Number(d.min) >= 75 ? 'goalConsolation' : 'goalPraise');
        lineP(line(ctx));
      } else lineP(line('goalPraise'));
    } else if (kind === 'score') {
      if (!known) return null;
      const id = scoreId(hs, as); if (!id || !L[id]) return null;
      lineP(id, 0.15);
      if (hs !== as) lineP(hs > as ? 'sideHome' : 'sideAway');
    } else if (kind === 'half' || kind === 'full') {
      lineP(line(kind), 0.25);
      if (known) {
        const id = hs + as > 0 ? scoreId(hs, as) : null; if (id && L[id]) lineP(id, 0.2);
        const k = kind === 'half' ? (hs + as === 0 ? 'halfNil' : hs === as ? 'halfLevel' : hs > as ? 'halfHome' : 'halfAway')
          : (hs + as === 0 ? 'fullNil' : hs === as ? 'fullDraw' : hs > as ? 'fullHome' : 'fullAway');
        lineP(line(k));
      }
    } else {
      if (!R.banks[kind]) return null;
      // A line that names the player when his name is recorded; otherwise one that needs no name.
      const role = l => l.name && ROLE[l.name];
      const who = l => d[role(l)];
      let id = line(kind, l => !role(l) || nameOf(who(l))) || line(kind);
      const l = L[id];
      if (role(l) && nameOf(who(l))) nameP(who(l), false);
      lineP(id);
    }
    if (!parts.length) return null;
    // The caption says what is heard: "Okafor, takes him on!", "Goal! Okafor! And they're in front!"
    const isName = p => p.file.startsWith('names/');
    const text = parts.map((p, i) => (isName(p) ? p.text + (p.called ? '!' : ',') : i > 0 && isName(parts[i - 1]) && !parts[i - 1].called ? lc(p.text) : p.text)).join(' ');
    return { parts, text };
  }
  // Plays a composed call through the game's audio (ducking the crowd); done(true) when it ends,
  // done(false) when a recording could not be had (the caption stays, nothing is said).
  function playParts(item, done) {
    const V = audio(); if (!V) { done(false); return; }
    (async () => { const bufs = []; for (const part of item.parts) bufs.push(await decoded(part.file)); return bufs; })().then(bufs => {
      if (item.cancelled) return;
      if (!bufs.some(Boolean) || !bufs[bufs.length - 1]) { done(false); return; }
      const c = V.ctx, g = c.createGain(); g.gain.value = Math.max(0, Math.min(1.6, opts.volume)) * LEVEL; g.connect(V.out);
      let t = c.currentTime + 0.03; const srcs = [];
      item.parts.forEach((p, i) => {
        const b = bufs[i]; if (!b) return;
        const s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = p.rate || 1; s.connect(g); s.start(t);
        R.live.add(s); residentDecodedBytes();
        s.onended = () => { R.live.delete(s); s.buffer = null; residentDecodedBytes(); };
        t += b.duration / (p.rate || 1) + (p.gap ?? 0.1); srcs.push(s);
      });
      let over = false;
      const fin = () => { if (over) return; over = true; try { g.disconnect(); } catch (e) { /* gone */ } done(true); };
      item.stop = () => { for (const s of srcs) { try { s.stop(); } catch (e) { /* ended */ } R.live.delete(s); s.buffer = null; } residentDecodedBytes(); fin(); };
      const last = srcs[srcs.length - 1], lastEnded = last.onended;
      last.onended = () => { if (lastEnded) lastEnded(); fin(); };
      // A stand-in for onended, which some browsers skip: measured on the audio clock, so a paused
      // match (a suspended context) does not end the line early.
      const endAt = t;
      const check = () => { if (over) return; if (c.state === 'running' && c.currentTime > endAt + 0.8) fin(); else setTimeout(check, 700); };
      setTimeout(check, Math.max(300, (endAt - c.currentTime) * 1000 + 900));
    }).catch(() => done(false));
  }
  // Warms the recordings for a match: every line, and the names of the players in it.
  async function preload(names = []) {
    const ix = await loadIndex(); if (!ix) return 0;
    const files = Object.values(ix.lines).map(l => l.file);
    for (const n of names) { const s = nameOf(n); if (s) { files.push(R.names[s]); if (R.namesX[s]) files.push(R.namesX[s]); } }
    // Warm the service-worker/browser compressed cache without retaining every MP3 ArrayBuffer
    // in this page's heap. The first spoken call fetches its single file if needed, then decodes it.
    let ok = 0;
    for (let i = 0; i < files.length; i += 6) ok += (await Promise.all(files.slice(i, i + 6).map(f => fetch(BASE + f).then(r => r.ok, () => false)))).filter(Boolean).length;
    return ok;
  }
  // Fetches every recording (no decoding), so the service worker has the whole voice for offline play.
  async function prefetch() {
    const ix = await loadIndex(); if (!ix) return 0;
    const files = [...Object.values(ix.lines).map(l => l.file), ...Object.values(ix.names || {}), ...Object.values(ix.namesX || {})];
    let ok = 0;
    for (let i = 0; i < files.length; i += 3) { for (const r of await Promise.all(files.slice(i, i + 3).map(f => fetch(BASE + f).then(x => x.ok, () => false)))) ok += r ? 1 : 0; }
    return ok;
  }
  function voiceMode() {
    if (opts.voice === 'off') return 'off';
    if (opts.voice === 'device') return synth ? 'device' : 'off';
    return 'recorded';
  }

  function push(item) {
    const t = performance.now();
    if (opts.speed >= 8 && !IMPORTANT_FAST.has(item.kind) && !item.pa) return;
    if (opts.speed >= 4 && (PRIORITY[item.kind] || 0) < 3 && !item.pa) return;
    item.at = t; item.expires = t + (item.pa ? 15000 : (PRIORITY[item.kind] || 0) >= 8 ? 9000 : 3500);
    // A more important line replaces a less important one that is speaking or waiting.
    for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].pa && (queue[i].prio || 0) < (item.prio || 0) && !item.pa) queue.splice(i, 1);
    if (speaking && !speaking.pa && (speaking.prio || 0) < (item.prio || 0) - 2) cut(speaking);
    queue.push(item);
    queue.sort((a, b) => (b.prio || 0) - (a.prio || 0) || a.at - b.at);
    pump();
  }
  function cut(item) {
    item.cancelled = true;
    if (item.stop) { try { item.stop(); } catch (e) { /* ended */ } }
    else if (item.device && synth) { try { synth.cancel(); } catch (e) { /* none */ } }
    if (speaking === item) speaking = null;
  }
  function pump() {
    if (speaking) return;
    const t = performance.now();
    while (queue.length && queue[0].expires < t) queue.shift();
    const item = queue.shift();
    if (!item) { onSpeak(false); return; }
    speaking = item;
    if (opts.captions) caption(item.text, item.pa ? 'pa' : 'comm');
    const mode = voiceMode();
    let done = false;
    const finish = () => { if (done) return; done = true; if (speaking === item) speaking = null; onSpeak(false); setTimeout(pump, item.pa ? 400 : 150); };
    const quiet = () => { const ms = Math.min(4200, 900 + item.text.length * 45); setTimeout(finish, ms); };
    const wanted = opts.speech && mode !== 'off' && (item.pa ? opts.announcer : opts.commentary) && (item.pa ? opts.paVolume : opts.volume) > 0;
    if (!wanted) { quiet(); return; }
    if (mode === 'recorded') {
      if (item.pa) { try { if (window.GafferSound) window.GafferSound.play('chime'); } catch (e) { /* no sound */ } quiet(); return; }
      if (!item.parts) { quiet(); return; }
      onSpeak(true, false);
      playParts(item, ok => { if (ok) finish(); else if (!done) { onSpeak(false); quiet(); } });
      return;
    }
    // The device's own voice.
    item.device = true;
    const u = new SpeechSynthesisUtterance(item.text);
    const v = voiceFor(item.pa); if (v) u.voice = v;
    u.lang = v ? v.lang : 'en-GB';
    u.rate = item.pa ? 0.9 : item.kind === 'goal' ? 1.15 : 1.05;
    u.pitch = item.pa ? 0.8 : item.kind === 'goal' ? 1.15 : 1;
    u.volume = Math.max(0, Math.min(1, item.pa ? opts.paVolume : opts.volume));
    u.onend = finish; u.onerror = finish;
    setTimeout(finish, 2500 + item.text.length * 110);            // some browsers never fire onend
    onSpeak(true, item.pa);
    try { synth.speak(u); } catch (e) { finish(); }
  }

  // kind: a phrase bank (commentary) or a PA line; data fills {player}, {club}, {home} …
  function say(kind, data = {}, { prio, cooldown } = {}) {
    if (!opts.commentary && !opts.captions) return;
    const tnow = performance.now() / 1000, cd = cooldown ?? COOLDOWN[kind] ?? 0;
    if (cd && cool[kind] && tnow < cool[kind]) return;
    cool[kind] = tnow + cd;
    // The recordings' index is still loading (the first line of the first match): wait for it, but
    // not long, so the line is spoken and not only captioned.
    if (voiceMode() === 'recorded' && !R.index && R.loading) {
      const asked = performance.now();
      R.loading.then(() => { if (performance.now() - asked < 1500) sayNow(kind, data, prio); else sayNow(kind, data, prio, true); });
      return;
    }
    sayNow(kind, data, prio);
  }
  function sayNow(kind, data, prio, captionOnly = false) {
    const c = !captionOnly && voiceMode() === 'recorded' && R.index ? compose(kind, data || {}) : null;
    if (c) { push({ kind, text: c.text, parts: c.parts, prio: prio ?? PRIORITY[kind] ?? 2 }); return; }
    const phrase = pick(kind); if (!phrase) return;
    push({ kind, text: fill(phrase, data || {}), prio: prio ?? PRIORITY[kind] ?? 2 });
  }
  function announce(kind, data = {}) {
    if (!opts.announcer) return;
    const bank = (PA[opts.lang] || PA.en);
    if (!bank[kind]) return;
    const extra = kind === 'goal' && data.assistName ? fill(bank.assist, { who: data.assistName }) : '';
    push({ kind: 'pa-' + kind, pa: true, prio: 1, text: fill(bank[kind], { ...data, assist: extra }) });
  }
  function stop() { queue.length = 0; if (speaking) cut(speaking); speaking = null; if (synth) { try { synth.cancel(); } catch (e) { /* none */ } } onSpeak(false); caption(''); }
  // Drop decoded PCM after a match; the service worker keeps the compressed MP3s for offline play.
  function release() {
    stop();
    R.generation++; R.pending.clear(); R.bytes.clear(); R.byteSizes.clear(); R.compressedBytes = 0;
    for (const s of R.live) { try { s.stop(); } catch (e) { /* already ended */ } s.buffer = null; }
    R.live.clear(); R.decoded.clear(); R.decodedBytes = 0; R.recent = {};
  }
  // The recorded voice pauses with the match's audio (GafferSound.suspend()); the device voice here.
  function pause() { if (synth) { try { synth.pause(); } catch (e) { /* none */ } } }
  function resume() { if (synth) { try { synth.resume(); } catch (e) { /* none */ } } }
  // iOS and some Android browsers only speak after a gesture: a silent line from the first tap,
  // click or key anywhere unlocks the device voice (the recorded voice is unlocked with the match sound).
  function unlock() { if (unlocked || !synth) return; unlocked = true; try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch (e) { /* tried once */ } }
  if (typeof document !== 'undefined') {
    if (synth) {
      const first = () => { unlock(); for (const g of ['pointerdown', 'touchend', 'keydown']) document.removeEventListener(g, first, true); };
      for (const g of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(g, first, { capture: true, passive: true });
    }
    // A hidden tab does not go on talking: what was waiting is dropped (it would be stale), and the
    // match's next lines speak when it is visible again.
    document.addEventListener('visibilitychange', () => { if (document.hidden) { queue.length = 0; if (speaking) cut(speaking); speaking = null; if (synth) { try { synth.cancel(); } catch (e) { /* none */ } } onSpeak(false); } });
  }
  function configure(o) { Object.assign(opts, o || {}); if (voiceMode() === 'recorded') loadIndex(); }
  function onCaption(fn) { caption = fn || (() => {}); }
  function onSpeaking(fn) { onSpeak = fn || (() => {}); }

  function state() { const residentBytes = residentDecodedBytes(); return { available: !!synth, unlocked, voices: voices.length, speaking: !!speaking, queued: queue.length, speech: opts.speech, volume: opts.volume, paVolume: opts.paVolume, voice: voiceMode(), recorded: { ready: !!R.index, lines: R.index ? Object.keys(R.index.lines).length : 0, names: Object.keys(R.names).length, called: Object.keys(R.namesX).length, fetched: R.bytes.size, compressedBytes: R.compressedBytes, decoded: R.decoded.size, decodedBytes: residentBytes, cacheBytes: R.decodedBytes, liveBuffers: R.live.size, peakDecodedBytes: R.peakDecodedBytes, decodedLimitBytes: MAX_DECODED_BYTES } }; }
  window.GafferCommentary = { say, announce, stop, release, pause, resume, unlock, configure, onCaption, onSpeaking, state, preload, prefetch, compose: (k, d) => (R.index ? compose(k, d || {}) : null), ready: loadIndex, PHRASES, PA, get available() { return !!synth; }, get voices() { return voices.map(v => `${v.name} (${v.lang})`); } };
})();
