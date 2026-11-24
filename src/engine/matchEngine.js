// src/engine/matchEngine.js — segment-based match simulation.
//
// A match is six 15-minute segments (plus two for extra time). In each segment every on-pitch
// player tires, the two sides' strengths are recomputed from the players actually on the pitch,
// shots are generated with an xG value each, and goals come from those shots.
//
// Lineup integrity: the starters are exactly the XI picked by selection.pickXI, the bench is exactly
// selection.pickBench, and substitutes come on only through the manager (halftime decisions) or the
// assistant rules below. Only players who appeared ever receive match stats (checked in finalize).
//
// The match state is plain JSON (ids only) so a match paused at halftime can be saved.

const { clamp, round2, positionAbility, buildSlotMap, POS_COMPAT } = require('../utils');
const { pickXI, pickBench, slotScore } = require('./selection');
const TL = require('./timeline');

const TACTIC_MATRIX = {
  high_press: { high_press: 1.0, counter: 0.95, possession: 1.05, low_block: 1.03 },
  counter:    { high_press: 1.05, counter: 1.0, possession: 1.03, low_block: 0.97 },
  possession: { high_press: 0.96, counter: 0.98, possession: 1.0, low_block: 1.04 },
  low_block:  { high_press: 0.98, counter: 1.03, possession: 0.96, low_block: 1.0 },
};
const TACTIC_INTENSITY = { high_press: 1.15, counter: 0.95, possession: 1.0, low_block: 0.9 };

// Team instructions on top of the tactic: line height, width and tempo, each a slider from 0 to 100
// (50 = normal). Each trades something for something else; 50 changes nothing, so results without
// instructions are exactly what they were. They scale a side's shot volume and quality, what it
// concedes and how fast its players tire — no extra random draws. 20 and 80 are the old
// deep/narrow/slow and high/wide/fast settings (saved careers that used them keep their meaning).
const INSTRUCTIONS = { line: ['deep', 'normal', 'high'], width: ['narrow', 'normal', 'wide'], tempo: ['slow', 'normal', 'fast'] };
const WORD_VALUE = { deep: 20, narrow: 20, slow: 20, normal: 50, high: 80, wide: 80, fast: 80 };
function instrValue(v) {
  if (typeof v === 'string' && WORD_VALUE[v] != null) return WORD_VALUE[v];
  if (v == null || v === '') return 50;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
}
function normInstr(x) {
  const o = {};
  for (const k of Object.keys(INSTRUCTIONS)) o[k] = instrValue(x ? x[k] : null);
  return o;
}
const FWD_SLOTS = ['ST', 'CF', 'LW', 'RW'], DEF_SLOTS = ['CB', 'LB', 'RB'], FB_SLOTS = ['LB', 'RB'];
function avgAttr(side, ctx, slots, attr) {
  let s = 0, n = 0;
  for (const x of side.onPitch) if (slots.includes(x.slot)) { const p = ctx.getPlayer(x.playerId); if (p) { s += p.attributes[attr]; n++; } }
  return n ? s / n : 60;
}
function instrMods(m, key, ctx) {
  const side = m[key], opp = m[key === 'home' ? 'away' : 'home'];
  const me = normInstr(side.instr);
  const r = { vol: 1, qual: 1, concVol: 1, concQual: 1, fatigue: 1 };
  const l = (me.line - 50) / 30, w = (me.width - 50) / 30, t = (me.tempo - 50) / 30;   // 80 → 1, 20 → −1
  // A high line squeezes the pitch and wins the ball higher, but quick forwards get in behind it.
  if (l > 0) {
    const edge = clamp((avgAttr(opp, ctx, FWD_SLOTS, 'pace') - avgAttr(side, ctx, DEF_SLOTS, 'pace')) / 25, -1, 1);
    r.concQual *= 1 + 0.14 * edge * l; r.concVol *= 1 - 0.05 * l; r.vol *= 1 + 0.04 * l; r.fatigue *= 1 + 0.05 * l;
  } else if (l < 0) { const d = -l; r.concQual *= 1 - 0.08 * d; r.concVol *= 1 + 0.07 * d; r.vol *= 1 - 0.06 * d; r.fatigue *= 1 - 0.03 * d; }
  // Width stretches the opponents (more so against weak full-backs) and leaves gaps; narrow is the opposite.
  if (w > 0) {
    const fb = clamp((60 - avgAttr(opp, ctx, FB_SLOTS, 'defending')) / 25, -1, 1);
    r.vol *= 1 + (0.03 + 0.04 * fb) * w; r.concVol *= 1 + 0.03 * w;
  } else if (w < 0) { const d = -w; r.vol *= 1 - 0.04 * d; r.qual *= 1 + 0.03 * d; r.concVol *= 1 - 0.05 * d; }
  // Tempo: fast means more, hurried attacks, an open game and tired legs; slow the reverse.
  if (t > 0) { r.vol *= 1 + 0.08 * t; r.qual *= 1 - 0.04 * t; r.concVol *= 1 + 0.03 * t; r.fatigue *= 1 + 0.08 * t; }
  else if (t < 0) { const d = -t; r.vol *= 1 - 0.08 * d; r.qual *= 1 + 0.04 * d; r.concVol *= 1 - 0.05 * d; r.fatigue *= 1 - 0.06 * d; }
  return r;
}

const MAX_SUBS = 5;
const MAX_WINDOWS = 3;          // in-play windows; halftime is free
const DRAIN_PER_MIN = 0.2;      // condition points per minute for an average player
const BASE_XG = 1.27;           // xG per 90 for a side facing an equal opponent (before home edge)
const SHOT_XG = 0.11;           // average xG per shot
const HOME_EDGE = 1.085;
const INJURY_TYPES = ['hamstring strain', 'ankle sprain', 'calf strain', 'knee ligament', 'groin strain', 'thigh bruise', 'concussion'];

const SHOOT_W = { ST: 5, CF: 5, LW: 3, RW: 3, CAM: 3, CM: 1.4, CDM: 0.7, LB: 0.6, RB: 0.6, CB: 0.6, GK: 0.01 };
const ASSIST_W = { CAM: 3, LW: 3, RW: 3, CM: 2.4, ST: 1.6, CF: 1.6, LB: 1.3, RB: 1.3, CDM: 1, CB: 0.4, GK: 0.1 };

// ── helpers ───────────────────────────────────────────────────────
function drainFactor(p) {
  const a = p.attributes;
  return clamp(1 - 0.005 * (a.workRate - 50) - 0.003 * (a.strength - 50), 0.55, 1.3);
}

function sideClub(m, key, ctx) { return ctx.getClub(m[key].clubId); }

function buildSide(club, isHome) {
  const { xi, changes } = pickXI(club);
  const bench = pickBench(club, xi.map(s => s.playerId));
  const onPitch = xi.filter(s => s.playerId != null).map(s => ({ slot: s.slot, slotKey: s.slotKey, playerId: s.playerId }));
  const apps = {};
  for (const s of onPitch) apps[s.playerId] = { start: true, minIn: 0, minOut: null };
  return {
    clubId: club.id, isHome, tactic: club.tactic, formation: club.formation, instr: normInstr(club.instructions),
    startXI: onPitch.map(s => ({ slotKey: s.slotKey, playerId: s.playerId })),
    onPitch, bench, apps, subsUsed: 0, windowsUsed: 0, manualSubs: 0,
    goals: 0, xg: 0, shots: 0, form: 1, selectionChanges: changes,
  };
}

function createMatch(ctx, { id, comp, compName, week, home, away, neutral = false, knockout = false, interactiveSide = null, recordShots = false, international = false }) {
  const m = {
    id, comp, compName: compName || comp, week, neutral, knockout, interactiveSide, recordShots, international,
    home: buildSide(home, true), away: buildSide(away, false),
    minute: 0, phase: 'pre', events: [], pens: null,
  };
  m.home.form = ctx.rng.float(0.9, 1.1);
  m.away.form = ctx.rng.float(0.9, 1.1);
  return m;
}

function sideStrength(m, key, ctx) {
  const side = m[key];
  const opp = m[key === 'home' ? 'away' : 'home'];
  const club = sideClub(m, key, ctx);
  if (!side.onPitch.length) return 1;
  let sum = 0, mor = 0;
  for (const s of side.onPitch) {
    const p = ctx.getPlayer(s.playerId);
    sum += positionAbility(p, s.slot) * (0.7 + 0.3 * p.fitness / 100);
    mor += p.morale;
  }
  const n = side.onPitch.length;
  let str = (sum / 11) * Math.pow(n / 11, 0.3);
  str *= clamp((mor / n) / 72, 0.92, 1.06);
  str *= 1 + (club.chemistry || 50) / 400;
  if (side.isHome && !m.neutral) str *= HOME_EDGE;
  str *= (TACTIC_MATRIX[side.tactic] || {})[opp.tactic] || 1;
  str *= side.form;
  return Math.max(1, str);
}

function pickWeighted(rng, onPitch, ctx, table, attrFn, excludeId) {
  const pool = onPitch.filter(s => s.playerId !== excludeId);
  if (!pool.length) return null;
  return rng.weighted(pool, s => (table[s.slot] || 1) * attrFn(ctx.getPlayer(s.playerId)));
}

function injure(ctx, p) {
  const rng = ctx.rng;
  const r = rng.next();
  const weeks = r < 0.6 ? rng.int(1, 2) : r < 0.9 ? rng.int(3, 6) : rng.int(7, 16);
  p.injury = { type: rng.pick(INJURY_TYPES), weeks };
  p.seasonStats.inj = (p.seasonStats.inj || 0) + 1; p.history.injuries = (p.history.injuries || 0) + 1;
  return p.injury;
}

// ── substitutions ─────────────────────────────────────────────────
function bestBenchFor(side, slot, ctx) {
  const options = side.bench.filter(id => !side.apps[id]).map(id => ctx.getPlayer(id)).filter(p => p && !(p.injury && p.injury.weeks > 0));
  if (!options.length) return null;
  const compat = POS_COMPAT[slot] || [slot];
  const keepers = options.filter(p => p.position === 'GK');
  const pool = slot === 'GK' ? (keepers.length ? keepers : options) : options.filter(p => p.position !== 'GK');
  if (!pool.length) return null;
  pool.sort((a, b) => (slotScore(b, slot) + (compat.includes(b.position) ? 3 : 0)) - (slotScore(a, slot) + (compat.includes(a.position) ? 3 : 0)));
  return pool[0];
}

function makeSub(m, key, offId, onId, minute, reason, ctx) {
  const side = m[key];
  const idx = side.onPitch.findIndex(s => s.playerId === offId);
  if (idx < 0) return false;
  if (!side.bench.includes(onId) || side.apps[onId]) return false;
  if (side.subsUsed >= MAX_SUBS) return false;
  const slot = side.onPitch[idx];
  side.onPitch[idx] = { slot: slot.slot, slotKey: slot.slotKey, playerId: onId };
  side.apps[offId].minOut = minute;
  side.apps[onId] = { start: false, minIn: minute, minOut: null };
  side.subsUsed++;
  m.events.push({ min: minute, type: 'sub', side: key, offId, onId, reason });
  return true;
}

// Assistant rules: tired players first, then a tactical change when chasing or protecting a result.
function assistantSubs(m, key, minute, ctx) {
  const side = m[key];
  if (side.manualSubs > 0) return;                 // the manager has taken charge of changes
  if (side.subsUsed >= MAX_SUBS - 1 || side.windowsUsed >= MAX_WINDOWS) return; // keep one for injuries
  const opp = m[key === 'home' ? 'away' : 'home'];
  const diff = side.goals - opp.goals;
  // Thresholds are set so a side that started fresh still gets 2–3 changes in the last half hour,
  // and tired legs (below ~60%) are always replaced first because the list is sorted by condition.
  const want = minute <= 60 ? 2 : 1;
  const threshold = minute <= 60 ? 91 : 89;
  let made = 0;
  const outfield = side.onPitch.filter(s => s.slot !== 'GK').map(s => ({ s, p: ctx.getPlayer(s.playerId) }))
    .sort((a, b) => a.p.fitness - b.p.fitness);
  for (const { s, p } of outfield) {
    if (made >= want || side.subsUsed >= MAX_SUBS - 1) break;
    if (p.fitness >= threshold) break;
    let slot = s.slot;
    // Chasing the game: bring on attacking legs; protecting a lead late: shore up.
    if (diff < 0 && minute >= 60 && ['CB', 'CDM', 'LB', 'RB'].includes(slot) && made === 0) slot = 'ST';
    const on = bestBenchFor(side, slot, ctx) || bestBenchFor(side, s.slot, ctx);
    if (!on) break;
    const reason = slot !== s.slot ? (diff < 0 ? 'assistant: chasing the game' : 'assistant: tactical') : 'assistant: fatigue';
    if (makeSub(m, key, s.playerId, on.id, minute, reason, ctx)) made++;
  }
  if (made) side.windowsUsed++;
}

function forcedInjurySub(m, key, p, minute, ctx) {
  const side = m[key];
  const slotEntry = side.onPitch.find(s => s.playerId === p.id);
  if (!slotEntry) return;
  const on = side.subsUsed < MAX_SUBS ? bestBenchFor(side, slotEntry.slot, ctx) : null;
  if (on && makeSub(m, key, p.id, on.id, minute, 'injury', ctx)) return;
  // No substitute left: the side plays on a man down.
  side.onPitch = side.onPitch.filter(s => s.playerId !== p.id);
  side.apps[p.id].minOut = minute;
}

function sendOff(m, key, p, minute, reason) {
  const side = m[key];
  if (!side.onPitch.some(s => s.playerId === p.id)) return;
  side.onPitch = side.onPitch.filter(s => s.playerId !== p.id);
  side.apps[p.id].minOut = minute;
  side.reds = side.reds || {};
  side.reds[p.id] = reason;
  m.events.push({ min: minute, type: 'red', side: key, playerId: p.id, reason });
}

// A card or injury cannot come before something the player did in this segment (a shot, a goal,
// an assist, his first booking): its rolled minute is moved after his last action. No extra random
// draws, so scores never change; only the minute of the card or injury does.
function afterLastAction(m, key, pid, from, minute) {
  let last = minute;
  for (const e of m.events) {
    if (e.side !== key || e.min <= from) continue;
    if (e.playerId === pid || e.assistId === pid) last = Math.max(last, e.min);
  }
  return last;
}

// ── simulation ────────────────────────────────────────────────────
function playSegment(m, from, to, ctx) {
  const rng = ctx.rng;
  const len = to - from;
  const strengths = { home: sideStrength(m, 'home', ctx), away: sideStrength(m, 'away', ctx) };
  const mods = { home: instrMods(m, 'home', ctx), away: instrMods(m, 'away', ctx) };
  for (const key of ['home', 'away']) {
    const side = m[key];
    const oppKey = key === 'home' ? 'away' : 'home';
    const opp = m[oppKey];
    const ratio = strengths[key] / strengths[oppKey];
    const xgSeg = BASE_XG * Math.pow(ratio, 1.45) * (len / 90);
    const nShots = rng.poisson(xgSeg / SHOT_XG * mods[key].vol * mods[oppKey].concVol);
    const gkSlot = opp.onPitch.find(s => s.slot === 'GK');
    const gk = gkSlot ? ctx.getPlayer(gkSlot.playerId) : null;
    const keeperAdj = gk ? clamp(1 - (positionAbility(gk, 'GK') - 55) / 400, 0.88, 1.15) : 1.35;
    for (let i = 0; i < nShots; i++) {
      const shooter = pickWeighted(rng, side.onPitch, ctx, SHOOT_W, p => 0.5 + p.attributes.finishing / 100);
      if (!shooter) break;
      const sp = ctx.getPlayer(shooter.playerId);
      const q = SHOT_XG * rng.float(0.3, 1.7) * mods[key].qual * mods[oppKey].concQual;
      side.shots++;
      side.xg += q;
      const finisherAdj = 0.85 + sp.attributes.finishing / 400;
      if (rng.chance(clamp(q * finisherAdj * keeperAdj, 0.005, 0.85))) {
        side.goals++;
        const minute = rng.int(from + 1, to);
        let assistId = null;
        if (rng.chance(0.7)) {
          const a = pickWeighted(rng, side.onPitch, ctx, ASSIST_W, p => 0.5 + (p.attributes.passing + p.attributes.vision) / 200, sp.id);
          assistId = a ? a.playerId : null;
        }
        m.events.push({ min: minute, type: 'goal', side: key, playerId: sp.id, assistId, xg: round2(q) });
      } else if (m.recordShots) {
        // Shot detail for the 2D view. Outcome derived from shot quality: no extra random draws,
        // so recording shots never changes the simulation.
        const minute = from + 1 + Math.floor((i + 0.5) * len / Math.max(nShots, 1)) % len;
        m.events.push({ min: Math.min(minute, to), type: 'shot', side: key, playerId: sp.id, xg: round2(q), outcome: q * finisherAdj > 0.12 ? 'saved' : 'off' });
      }
    }
  }
  // Fatigue and injuries for everyone on the pitch during this segment.
  for (const key of ['home', 'away']) {
    const side = m[key];
    const intensity = (TACTIC_INTENSITY[side.tactic] || 1) * instrMods(m, key, ctx).fatigue;
    for (const s of [...side.onPitch]) {
      const p = ctx.getPlayer(s.playerId);
      p.fitness = clamp(p.fitness - DRAIN_PER_MIN * intensity * drainFactor(p) * len, 0, 100);
      const risk = 0.0011 * (0.5 + p.injuryRisk / 15) * (1 + Math.max(0, 75 - p.fitness) / 25) * (len / 15);
      if (rng.chance(risk)) {
        const inj = injure(ctx, p);
        const minute = afterLastAction(m, key, p.id, from, rng.int(from + 1, to));
        m.events.push({ min: minute, type: 'injury', side: key, playerId: p.id, weeks: inj.weeks, injury: inj.type });
        forcedInjurySub(m, key, p, minute, ctx);
        continue;
      }
      // Discipline: about 1.7 yellows and 0.06 straight reds per side per match.
      const physical = ['CB', 'CDM', 'LB', 'RB'].includes(s.slot) ? 1.3 : s.slot === 'GK' ? 0.3 : 1;
      const yellowP = 0.025 * physical * (side.tactic === 'high_press' ? 1.2 : 1) * (len / 15);
      const r = rng.next();
      // Booked players are careful: a second yellow is much rarer than the first.
      const booked = side.cards && side.cards[p.id];
      if (r < 0.0004 * (len / 15)) sendOff(m, key, p, afterLastAction(m, key, p.id, from, rng.int(from + 1, to)), 'straight red');
      else if (r < yellowP * (booked ? 0.3 : 1)) {
        const minute = afterLastAction(m, key, p.id, from, rng.int(from + 1, to));
        side.cards = side.cards || {};
        side.cards[p.id] = (side.cards[p.id] || 0) + 1;
        m.events.push({ min: minute, type: 'yellow', side: key, playerId: p.id });
        if (side.cards[p.id] >= 2) sendOff(m, key, p, minute, 'second yellow');
      }
    }
  }
  m.minute = to;
}

// The manager's own match (interactiveSide set, watched or not) is played in five-minute segments,
// so a change he makes while watching takes effect within five minutes. The rates are the same as
// in 15-minute segments (shots are Poisson per minute; cards, injuries and fatigue scale with the
// segment's length), so only the order of the random draws differs. Other matches keep 15, and
// recording the timeline (recordShots) still never changes a result.
const LIVE_SEGMENT = 5;
function segmentsOf(m, from, to) {
  const len = m.interactiveSide ? LIVE_SEGMENT : 15;
  const out = [];
  for (let a = from; a < to; a += len) out.push([a, Math.min(to, a + len)]);
  return out;
}
// Plays [from, to). ctx.snapshot(m, minute), when given, is called before every segment so a live
// match can be rewound to that minute; the assistant's substitutions at 60 and 75 come after it.
function playRange(m, from, to, ctx) {
  for (const [a, b] of segmentsOf(m, from, to)) {
    if (ctx.snapshot) ctx.snapshot(m, a);
    if (a === 60 || a === 75) { assistantSubs(m, 'home', a, ctx); assistantSubs(m, 'away', a, ctx); }
    playSegment(m, a, b, ctx);
  }
}

function playFirstHalf(m, ctx, from = 0) {
  m.phase = 'first';
  playRange(m, from, 45, ctx);
  if (m.recordShots) TL.extend(m, ctx, 0, 45);           // the authoritative action timeline (src/engine/timeline.js)
  m.phase = 'halftime';
}

// Manager decisions at halftime: { tactic, formation, subs: [{ offId, onId }] }. During play
// (minute < 45 or > 45) the same decisions apply at that minute, and substitutions use one of
// the three in-play windows.
function applyHalftime(m, key, decisions = {}, ctx, minute = 45) {
  const side = m[key];
  const club = sideClub(m, key, ctx);
  const applied = { subs: 0, tactic: null, formation: null, errors: [] };
  if (decisions.tactic && TACTIC_MATRIX[decisions.tactic]) { side.tactic = decisions.tactic; club.tactic = decisions.tactic; applied.tactic = decisions.tactic; }
  if (decisions.instructions && typeof decisions.instructions === 'object') { side.instr = normInstr({ ...side.instr, ...decisions.instructions }); club.instructions = { ...side.instr }; applied.instructions = side.instr; }
  const inPlay = minute !== 45 && minute !== 90;
  const subs = (decisions.subs || []).slice(0, MAX_SUBS);
  if (inPlay && subs.length && side.windowsUsed >= MAX_WINDOWS) applied.errors.push('All three substitution windows have been used');
  else {
    for (const s of subs) {
      const offId = parseInt(s.offId, 10), onId = parseInt(s.onId, 10);
      if (makeSub(m, key, offId, onId, minute, 'manager', ctx)) { side.manualSubs++; applied.subs++; }
      else applied.errors.push(`Invalid substitution ${offId} → ${onId}`);
    }
    if (inPlay && applied.subs) side.windowsUsed++;
  }
  if (decisions.formation && decisions.formation !== side.formation && buildSlotMap(decisions.formation).length === 11) {
    reslot(side, decisions.formation, ctx);
    club.formation = decisions.formation;
    applied.formation = decisions.formation;
  }
  return applied;
}

// Re-assign the players on the pitch to a new formation's slots (best fit, keeper first).
function reslot(side, formation, ctx) {
  const slots = buildSlotMap(formation);
  const players = side.onPitch.map(s => ctx.getPlayer(s.playerId));
  const used = new Set();
  const next = [];
  const order = slots.slice().sort((a, b) => (a.slot === 'GK' ? -1 : 0) - (b.slot === 'GK' ? -1 : 0));
  for (const s of order) {
    let best = null, bestScore = -1;
    for (const p of players) {
      if (used.has(p.id)) continue;
      if (s.slot === 'GK' && p.position !== 'GK' && players.some(q => !used.has(q.id) && q.position === 'GK')) continue;
      const sc = slotScore(p, s.slot);
      if (sc > bestScore) { best = p; bestScore = sc; }
    }
    if (best) { used.add(best.id); next.push({ slot: s.slot, slotKey: s.slotKey, playerId: best.id }); }
  }
  side.onPitch = next;
  side.formation = formation;
}

// The second half from `from` (45, or a later minute when a live match is rewound), then extra
// time and penalties in a knockout tie.
function playSecondHalf(m, ctx, from = 45) {
  m.phase = 'second';
  if (from < 90) playRange(m, from, 90, ctx);
  if (from > 90 || (m.knockout && m.home.goals === m.away.goals)) {
    m.phase = 'extra';
    playRange(m, Math.max(90, from), 120, ctx);
    if (m.home.goals === m.away.goals) m.pens = shootout(m, ctx);
  }
  if (m.recordShots) TL.extend(m, ctx, 45, m.minute);
  m.phase = 'full';
}

function shootout(m, ctx) {
  const rng = ctx.rng;
  const takers = key => m[key].onPitch.map(s => ctx.getPlayer(s.playerId))
    .sort((a, b) => b.attributes.finishing - a.attributes.finishing);
  const keeper = key => { const s = m[key].onPitch.find(x => x.slot === 'GK'); return s ? ctx.getPlayer(s.playerId) : null; };
  const order = { home: takers('home'), away: takers('away') };
  const score = { home: 0, away: 0 };
  const kick = (key, i) => {
    const t = order[key][i % Math.max(order[key].length, 1)];
    const gk = keeper(key === 'home' ? 'away' : 'home');
    const pr = clamp(0.74 + ((t ? t.attributes.finishing : 50) - 60) / 400 - ((gk ? positionAbility(gk, 'GK') : 40) - 60) / 500, 0.5, 0.92);
    if (rng.chance(pr)) score[key]++;
  };
  for (let i = 0; i < 5; i++) { kick('home', i); kick('away', i); }
  let i = 5;
  while (score.home === score.away && i < 30) { kick('home', i); kick('away', i); i++; }
  if (score.home === score.away) score[rng.chance(0.5) ? 'home' : 'away']++;
  return score;
}

// Writes stats ONLY for players who appeared, then returns a compact result.
function finalizeMatch(m, ctx) {
  if (m.international) return finalizeInternational(m, ctx);
  const appeared = { home: new Set(Object.keys(m.home.apps).map(Number)), away: new Set(Object.keys(m.away.apps).map(Number)) };
  const endMinute = m.minute;
  for (const key of ['home', 'away']) {
    const side = m[key];
    for (const [pidStr, a] of Object.entries(side.apps)) {
      const p = ctx.getPlayer(Number(pidStr));
      const mins = Math.max(0, (a.minOut ?? endMinute) - a.minIn);
      p.history.minutes = (p.history.minutes || 0) + mins;
      p.seasonStats.minutes += mins;
      p.recentMinutes = (p.recentMinutes || 0) + mins;
      if (a.start) {
        p.history.appearances++; p.seasonStats.apps++;
        if ((key === 'home' ? m.away.goals : m.home.goals) === 0) { p.seasonStats.cs = (p.seasonStats.cs || 0) + 1; p.history.cs = (p.history.cs || 0) + 1; }   // clean sheet
      }
      else { p.history.subApps = (p.history.subApps || 0) + 1; p.seasonStats.subApps++; }
    }
  }
  // Discipline: bans are served by missing the club's matches; new cards are added afterwards.
  for (const key of ['home', 'away']) {
    const side = m[key];
    const club = sideClub(m, key, ctx);
    for (const p of club.squad) if (p.suspension > 0 && !side.apps[p.id]) p.suspension--;
    for (const [pidStr, n] of Object.entries(side.cards || {})) {
      const p = ctx.getPlayer(Number(pidStr));
      const secondYellow = side.reds && side.reds[pidStr] === 'second yellow';
      p.history.yellows = (p.history.yellows || 0) + n;
      p.seasonStats.yellows = (p.seasonStats.yellows || 0) + n;
      if (!secondYellow) {
        p.yellowAcc = (p.yellowAcc || 0) + n;
        if (p.yellowAcc >= 5) { p.yellowAcc -= 5; p.suspension = (p.suspension || 0) + 1; }
      }
    }
    for (const [pidStr, reason] of Object.entries(side.reds || {})) {
      const p = ctx.getPlayer(Number(pidStr));
      p.history.reds = (p.history.reds || 0) + 1;
      p.seasonStats.reds = (p.seasonStats.reds || 0) + 1;
      p.suspension = (p.suspension || 0) + (reason === 'straight red' ? 2 : 1);
    }
  }
  for (const e of m.events) {
    if (e.type !== 'goal') continue;
    const set = appeared[e.side];
    if (!set.has(e.playerId) || (e.assistId != null && !set.has(e.assistId))) {
      throw new Error(`Match integrity: stat for a player who did not appear (match ${m.id})`);
    }
    const s = ctx.getPlayer(e.playerId);
    s.history.goals++; s.seasonStats.goals++;
    if (e.assistId != null) { const a = ctx.getPlayer(e.assistId); a.history.assists++; a.seasonStats.assists++; }
  }
  const hg = m.home.goals, ag = m.away.goals;
  const homeWon = hg > ag || (hg === ag && m.pens && m.pens.home > m.pens.away);
  const awayWon = ag > hg || (hg === ag && m.pens && m.pens.away > m.pens.home);
  for (const key of ['home', 'away']) {
    const won = key === 'home' ? homeWon : awayWon;
    const lost = key === 'home' ? awayWon : homeWon;
    const club = sideClub(m, key, ctx);
    for (const pid of appeared[key]) {
      const p = ctx.getPlayer(pid);
      p.morale = clamp(p.morale + (won ? 3 : lost ? -3 : 0.5), 20, 100);
    }
    club.chemistry = clamp((club.chemistry || 50) + (won ? 1 : lost ? -1 : 0), 20, 98);
    club.fanMood = clamp(club.fanMood + (won ? 2 : lost ? -2 : 0), 0, 100);
    club.lastXI = m[key].startXI.map(s => ({ ...s }));
  }
  const sh = Math.max(m.home.shots, hg), sa = Math.max(m.away.shots, ag);

  return {
    id: m.id, comp: m.comp, week: m.week, h: m.home.clubId, a: m.away.clubId, hg, ag,
    hx: round2(m.home.xg), ax: round2(m.away.xg), hs: sh, as: sa,
    // Possession: measured from the timeline's possession spells where there is one; otherwise the
    // expected share from both midfields and tactics (never from expected goals).
    pos: m.tl ? TL.possession(m) : Math.round(TL.possessionShare(m, ctx) * 100),
    ...(m.tl ? { ts: TL.summary(m) } : {}),
    pens: m.pens, winner: homeWon ? m.home.clubId : awayWon ? m.away.clubId : null,
  };
}

// International matches count as caps and international goals only: club season stats, bans,
// club chemistry and fan mood are untouched (injuries and tiredness still come home with them).
function finalizeInternational(m, ctx) {
  for (const key of ['home', 'away']) {
    for (const pidStr of Object.keys(m[key].apps)) {
      const p = ctx.getPlayer(Number(pidStr));
      p.history.caps = (p.history.caps || 0) + 1;
    }
  }
  for (const e of m.events) {
    if (e.type !== 'goal') continue;
    const s = ctx.getPlayer(e.playerId);
    s.history.intlGoals = (s.history.intlGoals || 0) + 1;
  }
  const hg = m.home.goals, ag = m.away.goals;
  const homeWon = hg > ag || (hg === ag && m.pens && m.pens.home > m.pens.away);
  const awayWon = ag > hg || (hg === ag && m.pens && m.pens.away > m.pens.home);
  for (const key of ['home', 'away']) {
    const won = key === 'home' ? homeWon : awayWon, lost = key === 'home' ? awayWon : homeWon;
    for (const pidStr of Object.keys(m[key].apps)) {
      const p = ctx.getPlayer(Number(pidStr));
      p.morale = clamp(p.morale + (won ? 2 : lost ? -1 : 0), 20, 100);
    }
  }
  return {
    id: m.id, comp: m.comp, week: m.week, h: m.home.clubId, a: m.away.clubId, hg, ag,
    hx: round2(m.home.xg), ax: round2(m.away.xg), hs: Math.max(m.home.shots, hg), as: Math.max(m.away.shots, ag), pos: 50,
    pens: m.pens, winner: homeWon ? m.home.clubId : awayWon ? m.away.clubId : null,
  };
}

// Plays a whole match with no human input (assistant handles everything).
function playMatch(ctx, opts) {
  const m = createMatch(ctx, opts);
  playFirstHalf(m, ctx);
  playSecondHalf(m, ctx);
  return { match: m, result: finalizeMatch(m, ctx) };
}

// Quick strength estimate for previews and valuations (no randomness, no mutation).
function squadStrength(club) {
  const { xi } = pickXI(club);
  const ps = xi.filter(s => s.playerId != null);
  if (!ps.length) return 20;
  const byId = new Map(club.squad.map(p => [p.id, p]));
  return ps.reduce((s, e) => s + positionAbility(byId.get(e.playerId), e.slot), 0) / 11;
}

module.exports = {
  createMatch, playFirstHalf, applyHalftime, playSecondHalf, finalizeMatch, playMatch, squadStrength,
  drainFactor, MAX_SUBS, MAX_WINDOWS, LIVE_SEGMENT, segmentsOf, TACTIC_MATRIX, DRAIN_PER_MIN, INSTRUCTIONS, normInstr, instrMods, instrValue,
};
