// src/engine/scoutingEngine.js — what the manager actually knows about other clubs' players.
//
// Knowledge (0–100) per player = max(base, scouted). Base comes from proximity (your own squad 100,
// your league 55, your country 35, abroad 15) plus your chief scout and the player's caps. Scouting
// a player raises it every week until a full report arrives. Below 100 the UI sees ranges instead
// of exact numbers; the ranges always contain the true value and never jitter (they are derived
// from the player id, not from the RNG), so browsing never changes the game.

const { clamp, hashString, ATTR_KEYS } = require('../utils');
const { staffRating } = require('./staffEngine');
const { post } = require('./financeEngine');

const SCOUT_FEE = [12_000, 8_000, 5_000, 3_000];

function baseKnowledge(world, p, me = world.club()) {
  if (p.clubId === me.id || (world.manager.ownedClubId != null && p.clubId === world.manager.ownedClubId)) return 100;
  let k;
  if (p.clubId == null) k = 30;
  else {
    const c = world.clubById(p.clubId);
    k = !c ? 15 : c.country === me.country ? (c.division === me.division ? 55 : 35) : 15;
  }
  k += Math.min(15, (p.history.caps || 0) * 1.5);
  k += staffRating(me, 'scout') * 0.8;
  return clamp(Math.round(k), 0, 100);
}

function knowledge(world, p, me) {
  return Math.max(baseKnowledge(world, p, me), (world.knowledge && world.knowledge[p.id]) || 0);
}

// Range [lo, hi] of the given width that contains v, placed by a fixed per-player offset.
function rangeAround(v, width, seed) {
  if (width <= 0) return [v, v];
  const below = Math.floor(width * ((seed % 1000) / 1000));
  return [Math.max(1, v - below), Math.min(99, v - below + width)];
}

// Per-player fog offset, derived from the id only (cached: it never changes).
const SEEDS = new Map();
function fogSeed(id) { let h = SEEDS.get(id); if (h === undefined) { h = hashString(`fog:${id}`); SEEDS.set(id, h); } return h; }

// The ability the manager believes a player has (midpoint of the visible range).
function estimate(world, p, me) {
  const k = knowledge(world, p, me);
  if (k >= 100) return Math.round(p.currentAbility);
  const [lo, hi] = rangeAround(Math.round(p.currentAbility), Math.round((100 - k) / 100 * 16), fogSeed(p.id));
  return Math.round((lo + hi) / 2);
}

// Replace exact numbers in a public player row with what the manager knows.
function fogRow(world, p, row, me) {
  const k = knowledge(world, p, me);
  if (k >= 100) return { ...row, known: 100 };
  const seed = fogSeed(p.id);
  const width = Math.round((100 - k) / 100 * 16);
  const [lo, hi] = rangeAround(Math.round(p.currentAbility), width, seed);
  const est = Math.round((lo + hi) / 2);
  const out = { ...row, known: k, fog: true, ovrLo: lo, ovrHi: hi, ovr: est, currentAbility: est };
  if (k < 40) { out.potLo = null; out.potHi = null; out.pot = null; out.hiddenPotential = null; out.hint = 'Unknown — scout him'; }
  else {
    const [plo, phi] = rangeAround(p.hiddenPotential, Math.round(width * 1.6), seed >>> 3);
    out.potLo = Math.max(plo, lo); out.potHi = Math.max(phi, hi);
    out.pot = out.hiddenPotential = Math.round((out.potLo + out.potHi) / 2);
  }
  if (k < 30) { out.attributes = null; out.attrs = null; }
  else {
    const step = k >= 80 ? 2 : k >= 55 ? 4 : 6;
    const a = Object.fromEntries(ATTR_KEYS.map(key => [key, clamp(Math.round(p.attributes[key] / step) * step, 1, 99)]));
    out.attributes = a; out.attrs = a;
  }
  if (k < 50) { out.personality = null; out.pers = null; }
  if (k < 60) out.injuryRisk = null;
  return out;
}

function slots(club) { return 2 + Math.floor(staffRating(club, 'scout') / 6); }

function assign(world, p) {
  const me = world.club();
  world.scouting = world.scouting || { assignments: [], reports: [] };
  const sc = world.scouting;
  if (!p || p.retired) return { ok: false, error: 'Player not found' };
  if (knowledge(world, p, me) >= 100) return { ok: false, error: `You already know everything about ${p.name}` };
  if (sc.assignments.some(a => a.playerId === p.id)) return { ok: false, error: `Your scouts are already watching ${p.name}` };
  if (sc.assignments.length >= slots(me)) return { ok: false, error: `All ${slots(me)} scouting slots are busy. A better chief scout adds slots.` };
  const fee = SCOUT_FEE[clamp(me.division, 1, 4) - 1];
  if (me.finance.balance < fee) return { ok: false, error: `Scouting costs $${Math.round(fee / 1000)}K` };
  post(me, 'Scouting', -fee, `Scout assignment: ${p.name}`);
  sc.assignments.push({ playerId: p.id, season: world.season, week: world.currentWeek });
  return { ok: true, player: p.name, fee, weeks: weeksToReport(world, p, me) };
}

function weeksToReport(world, p, me) {
  const k = knowledge(world, p, me);
  return Math.max(1, Math.ceil((100 - k) / weeklyGain(me)));
}
function weeklyGain(me) { return 18 + staffRating(me, 'scout') * 1.4; }

function cancel(world, playerId) {
  const sc = world.scouting || { assignments: [] };
  const before = sc.assignments.length;
  sc.assignments = sc.assignments.filter(a => a.playerId !== playerId);
  return { ok: sc.assignments.length < before };
}

// Weekly progress. Returns finished reports.
function weekly(world) {
  const sc = world.scouting;
  if (!sc || !sc.assignments.length) return [];
  const me = world.club();
  world.knowledge = world.knowledge || {};
  const done = [];
  for (const a of sc.assignments) {
    const p = world.players.get(a.playerId);
    if (!p || p.retired) { a.gone = true; continue; }
    world.knowledge[p.id] = clamp(Math.round(knowledge(world, p, me) + weeklyGain(me)), 0, 100);
    if (world.knowledge[p.id] >= 100) { a.gone = true; done.push(report(world, p)); }
  }
  sc.assignments = sc.assignments.filter(a => !a.gone);
  sc.reports = [...done, ...(sc.reports || [])].slice(0, 30);
  return done;
}

function verdict(world, p) {
  const me = world.club();
  const avg = me.squad.length ? me.squad.reduce((s, x) => s + x.currentAbility, 0) / me.squad.length : 40;
  const best = me.squad.filter(x => x.position === p.position).reduce((m, x) => Math.max(m, x.currentAbility), 0);
  if (p.currentAbility >= best + 3 || (p.age <= 21 && p.hiddenPotential >= avg + 15)) return 'Sign him';
  if (p.currentAbility >= avg || p.hiddenPotential >= avg + 8) return 'Good option';
  return 'Not good enough';
}

function report(world, p) {
  return { playerId: p.id, name: p.name, position: p.position, age: p.age, ovr: p.currentAbility, pot: p.hiddenPotential,
    personality: p.personality, verdict: verdict(world, p), season: world.season, week: world.currentWeek };
}

// Players found on a regional scouting trip are reported to 70% knowledge.
function reveal(world, ids, level = 70) {
  world.knowledge = world.knowledge || {};
  for (const id of ids) world.knowledge[id] = Math.max(world.knowledge[id] || 0, level);
}

// Keep the knowledge map small: forget retired players and fully known ones that left the world.
function prune(world) {
  if (!world.knowledge) return;
  for (const id of Object.keys(world.knowledge)) if (!world.players.has(Number(id))) delete world.knowledge[id];
}

module.exports = { baseKnowledge, knowledge, estimate, fogRow, assign, cancel, weekly, reveal, prune, slots, weeksToReport, verdict, SCOUT_FEE };
