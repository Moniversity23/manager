// src/engine/selection.js — who starts and who sits on the bench.
//
// Rules (owner requirements):
//  • Manual picks always win: any slot the manager sets is exactly who starts (if available).
//  • Otherwise the auto-pick keeps a stable first XI: last week's starter keeps his slot unless he is
//    injured, below the rotation condition threshold, sold, or the formation changed.
//  • Auto-pick makes at most MAX_UPGRADES_PER_WEEK voluntary changes; forced changes are unlimited.
//  • The bench is exactly the manager's bench when set, otherwise chosen automatically.
// Every function here is pure (no RNG, no mutation) so the UI preview equals what kicks off.

const { buildSlotMap, positionAbility, POS_COMPAT } = require('../utils');

const BENCH_SIZE = 7;
const MIN_MATCH_FITNESS = 30;     // below this a player cannot be picked at all
const ROTATE_FITNESS = 75;        // auto-pick rests a starter below this condition
const MAX_UPGRADES_PER_WEEK = 2;
const UPGRADE_MARGIN = 5;

function isAvailable(p) {
  return !!p && !p.retired && !(p.injury && p.injury.weeks > 0) && !(p.suspension > 0) && p.fitness >= MIN_MATCH_FITNESS;
}

function slotScore(p, slot) {
  return positionAbility(p, slot) * (0.75 + 0.25 * Math.min(100, p.fitness) / 100);
}

function bestFor(slot, pool, used) {
  const compat = POS_COMPAT[slot] || [slot];
  let best = null, bestScore = -1;
  for (const p of pool) {
    if (used.has(p.id)) continue;
    if (slot === 'GK' && p.position !== 'GK' && pool.some(q => !used.has(q.id) && q.position === 'GK')) continue;
    const s = slotScore(p, slot) + (compat.includes(p.position) ? 0 : -3);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  return best;
}

// Returns { xi: [{slot, slotKey, playerId, source}], changes: [{slotKey, outId, inId, reason}] }
function pickXI(club) {
  const slots = buildSlotMap(club.formation);
  const pool = club.squad.filter(isAvailable);
  const byId = new Map(club.squad.map(p => [p.id, p]));
  const used = new Set();
  const out = new Array(slots.length).fill(null);
  const changes = [];

  // 1. Manual overrides.
  const manual = new Map((club.manualXI || []).map(m => [m.slotKey, m.playerId]));
  slots.forEach((s, i) => {
    const pid = manual.get(s.slotKey);
    if (pid == null) return;
    const p = byId.get(pid);
    if (p && isAvailable(p) && !used.has(p.id)) {
      out[i] = { slot: s.slot, slotKey: s.slotKey, playerId: p.id, source: 'manual' };
      used.add(p.id);
    } else if (p) {
      changes.push({ slotKey: s.slotKey, outId: pid, inId: null, reason: p.isInjured && p.isInjured() ? 'injured' : 'unavailable' });
    }
  });

  // 2. Keep last week's starters (stable first XI).
  const last = new Map((club.lastXI || []).map(m => [m.slotKey, m.playerId]));
  slots.forEach((s, i) => {
    if (out[i]) return;
    const pid = last.get(s.slotKey);
    if (pid == null) return;
    const p = byId.get(pid);
    if (p && isAvailable(p) && p.fitness >= ROTATE_FITNESS && !used.has(p.id)) {
      out[i] = { slot: s.slot, slotKey: s.slotKey, playerId: p.id, source: 'core' };
      used.add(p.id);
    } else {
      const reason = !p ? 'left club' : p.injury && p.injury.weeks > 0 ? 'injured' : p.suspension > 0 ? 'suspended' : p.fitness < ROTATE_FITNESS ? 'rested (condition)' : 'unavailable';
      changes.push({ slotKey: s.slotKey, outId: pid, inId: null, reason });
    }
  });

  // 3. Fill empty slots with the best available (GK first so a keeper is never wasted).
  const order = slots.map((s, i) => i).sort((a, b) => (slots[a].slot === 'GK' ? -1 : 0) - (slots[b].slot === 'GK' ? -1 : 0));
  for (const i of order) {
    if (out[i]) continue;
    const s = slots[i];
    const p = bestFor(s.slot, pool, used);
    if (p) {
      used.add(p.id);
      out[i] = { slot: s.slot, slotKey: s.slotKey, playerId: p.id, source: 'auto' };
      const ch = changes.find(c => c.slotKey === s.slotKey && c.inId == null);
      if (ch) ch.inId = p.id;
    } else {
      out[i] = { slot: s.slot, slotKey: s.slotKey, playerId: null, source: 'empty' };
    }
  }

  // 4. Limited voluntary upgrades of core slots, so the team evolves but never churns.
  let upgrades = 0;
  if (club.lastXI) {
    const candidates = [];
    out.forEach((e, i) => {
      if (!e || e.source !== 'core') return;
      const cur = byId.get(e.playerId);
      const alt = bestFor(e.slot, pool, used);
      if (!alt) return;
      const gain = slotScore(alt, e.slot) - slotScore(cur, e.slot);
      if (gain >= UPGRADE_MARGIN) candidates.push({ i, alt, gain });
    });
    candidates.sort((a, b) => b.gain - a.gain);
    for (const c of candidates) {
      if (upgrades >= MAX_UPGRADES_PER_WEEK) break;
      if (used.has(c.alt.id)) continue;
      const e = out[c.i];
      changes.push({ slotKey: e.slotKey, outId: e.playerId, inId: c.alt.id, reason: 'better option' });
      used.delete(e.playerId);
      used.add(c.alt.id);
      out[c.i] = { ...e, playerId: c.alt.id, source: 'auto' };
      upgrades++;
    }
  }
  return { xi: out, changes };
}

function pickBench(club, xiIds) {
  const inXI = new Set(xiIds.filter(Boolean));
  const pool = club.squad.filter(p => isAvailable(p) && !inXI.has(p.id));
  const bench = [];
  for (const pid of (club.manualBench || [])) {
    const p = pool.find(x => x.id === pid);
    if (p && !bench.includes(p.id) && bench.length < BENCH_SIZE) bench.push(p.id);
  }
  const rest = pool.filter(p => !bench.includes(p.id)).sort((a, b) => b.currentAbility - a.currentAbility);
  // Make sure a reserve keeper sits on the bench when one exists.
  if (!bench.some(id => pool.find(p => p.id === id)?.position === 'GK')) {
    const gk = rest.find(p => p.position === 'GK');
    if (gk && bench.length < BENCH_SIZE) bench.push(gk.id);
  }
  for (const p of rest) {
    if (bench.length >= BENCH_SIZE) break;
    if (!bench.includes(p.id)) bench.push(p.id);
  }
  return bench;
}

function countAvailable(club) {
  const avail = club.squad.filter(isAvailable);
  return { total: avail.length, keepers: avail.filter(p => p.position === 'GK').length };
}

module.exports = { pickXI, pickBench, isAvailable, countAvailable, slotScore, BENCH_SIZE, MIN_MATCH_FITNESS, ROTATE_FITNESS, MAX_UPGRADES_PER_WEEK };
