// The Gaffer — match commentary and stadium announcements.
//
// Commentary is chosen from phrase banks by match event and spoken with the device's own speech
// synthesis (Web Speech API): free, offline on most phones and computers, no per-match cost and
// no recordings to license. Every line is also shown as a caption, so it works with speech off
// or on devices without voices. The architecture is ready for more:
//   • Languages: PHRASES[lang] — add a bank and pick a matching system voice.
//   • Voices: the commentator and the announcer use different system voices where available.
//   • Recorded clips could replace speak() later without touching the event logic.
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
  const PRIORITY = { goal: 10, score: 9, full: 9, half: 8, red: 8, woodwork: 7, save: 7, punch: 7, shot: 6, miss: 6, sub: 5, yellow: 5, injury: 5, kickoff: 5, kickoff2: 5, replay: 4, attack: 4, late: 3, through: 3, cross: 3, dribble: 2, tackle: 2, interception: 2, longball: 1, build: 1 };
  const COOLDOWN = { build: 14, attack: 7, shot: 1, late: 60, dribble: 12, cross: 8, through: 10, longball: 16, tackle: 12, interception: 12 };
  const IMPORTANT_FAST = new Set(['goal', 'score', 'full', 'half', 'red', 'kickoff', 'kickoff2']);
  let opts = { lang: 'en', speech: true, captions: true, commentary: true, announcer: true, volume: 0.9, paVolume: 0.8, speed: 1 };
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

  function push(item) {
    const t = performance.now();
    if (opts.speed >= 8 && !IMPORTANT_FAST.has(item.kind) && !item.pa) return;
    if (opts.speed >= 4 && (PRIORITY[item.kind] || 0) < 6 && !item.pa) return;
    item.at = t; item.expires = t + (item.pa ? 15000 : (PRIORITY[item.kind] || 0) >= 8 ? 9000 : 3500);
    // A more important line replaces a less important one that is speaking or waiting.
    for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].pa && (queue[i].prio || 0) < (item.prio || 0) && !item.pa) queue.splice(i, 1);
    if (speaking && !speaking.pa && (speaking.prio || 0) < (item.prio || 0) - 2 && synth) { try { synth.cancel(); } catch {} speaking = null; }
    queue.push(item);
    queue.sort((a, b) => (b.prio || 0) - (a.prio || 0) || a.at - b.at);
    pump();
  }
  function pump() {
    if (speaking) return;
    const t = performance.now();
    while (queue.length && queue[0].expires < t) queue.shift();
    const item = queue.shift();
    if (!item) { onSpeak(false); return; }
    speaking = item;
    if (opts.captions) caption(item.text, item.pa ? 'pa' : 'comm');
    const canSpeak = synth && opts.speech && (item.pa ? opts.announcer : opts.commentary) && (item.pa ? opts.paVolume : opts.volume) > 0;
    if (!canSpeak) { const ms = Math.min(4200, 900 + item.text.length * 45); setTimeout(() => { speaking = null; pump(); }, ms); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    const v = voiceFor(item.pa); if (v) u.voice = v;
    u.lang = v ? v.lang : 'en-GB';
    u.rate = item.pa ? 0.9 : item.kind === 'goal' ? 1.15 : 1.05;
    u.pitch = item.pa ? 0.8 : item.kind === 'goal' ? 1.15 : 1;
    u.volume = Math.max(0, Math.min(1, item.pa ? opts.paVolume : opts.volume));
    let done = false;
    const finish = () => { if (done) return; done = true; speaking = null; onSpeak(false); setTimeout(pump, item.pa ? 400 : 150); };
    u.onend = finish; u.onerror = finish;
    setTimeout(finish, 2500 + item.text.length * 110);            // some browsers never fire onend
    onSpeak(true, item.pa);
    try { synth.speak(u); } catch { finish(); }
  }

  // kind: a phrase bank (commentary) or a PA line; data fills {player}, {club}, {home} …
  function say(kind, data = {}, { prio, cooldown } = {}) {
    if (!opts.commentary && !opts.captions) return;
    const tnow = performance.now() / 1000, cd = cooldown ?? COOLDOWN[kind] ?? 0;
    if (cd && cool[kind] && tnow < cool[kind]) return;
    cool[kind] = tnow + cd;
    const line = pick(kind); if (!line) return;
    push({ kind, text: fill(line, data), prio: prio ?? PRIORITY[kind] ?? 2 });
  }
  function announce(kind, data = {}) {
    if (!opts.announcer) return;
    const bank = (PA[opts.lang] || PA.en);
    if (!bank[kind]) return;
    const extra = kind === 'goal' && data.assistName ? fill(bank.assist, { who: data.assistName }) : '';
    push({ kind: 'pa-' + kind, pa: true, prio: 1, text: fill(bank[kind], { ...data, assist: extra }) });
  }
  function stop() { queue.length = 0; speaking = null; if (synth) { try { synth.cancel(); } catch {} } onSpeak(false); caption(''); }
  function pause() { if (synth) { try { synth.pause(); } catch {} } }
  function resume() { if (synth) { try { synth.resume(); } catch {} } }
  // iOS and some Android browsers only speak after a gesture: a silent line from a tap unlocks it.
  function unlock() { if (unlocked || !synth) return; unlocked = true; try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch {} }
  function configure(o) { Object.assign(opts, o || {}); }
  function onCaption(fn) { caption = fn || (() => {}); }
  function onSpeaking(fn) { onSpeak = fn || (() => {}); }

  window.GafferCommentary = { say, announce, stop, pause, resume, unlock, configure, onCaption, onSpeaking, PHRASES, PA, get available() { return !!synth; }, get voices() { return voices.map(v => `${v.name} (${v.lang})`); } };
})();
