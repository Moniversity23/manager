// src/utils.js — shared, pure helpers. No module-level mutable state:
// every GameWorld owns its own RNG so two worlds never disturb each other.

// mulberry32: small, fast, good-quality 32-bit PRNG whose whole state is one integer,
// so the state can live in the save and any bug can be replayed exactly.
class RNG {
  constructor(seed = 1) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a, b) { return Math.floor(this.next() * (b - a + 1)) + a; }
  float(a, b) { return this.next() * (b - a) + a; }
  pick(arr) { return arr.length ? arr[this.int(0, arr.length - 1)] : undefined; }
  shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = this.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  chance(p) { return this.next() < p; }
  poisson(lambda) {
    if (lambda <= 0) return 0;
    const l = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > l && k < 15);
    return k - 1;
  }
  weighted(items, weightFn) {
    let total = 0;
    const w = items.map(it => { const v = Math.max(0, weightFn(it)); total += v; return v; });
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  getState() { return this.s >>> 0; }
  setState(s) { this.s = s >>> 0; }
}

// Deterministic 32-bit hash of a string (used to derive seeds, never for gameplay randomness).
function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = v => Math.round(v * 100) / 100;

// ─── POSITIONS & FORMATIONS ───────────────────────────────────────
const POS_ALL = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST', 'CF'];
const ATTR_KEYS = ['pace', 'finishing', 'passing', 'dribbling', 'defending', 'strength', 'vision', 'workRate'];
const POS_ATTRS = {
  GK:  ['strength', 'vision', 'workRate', 'defending'],
  CB:  ['defending', 'strength', 'workRate', 'pace'],
  LB:  ['pace', 'defending', 'passing', 'workRate'],
  RB:  ['pace', 'defending', 'passing', 'workRate'],
  CDM: ['defending', 'workRate', 'passing', 'strength'],
  CM:  ['passing', 'vision', 'workRate', 'dribbling'],
  CAM: ['vision', 'passing', 'dribbling', 'finishing'],
  LW:  ['pace', 'dribbling', 'finishing', 'vision'],
  RW:  ['pace', 'dribbling', 'finishing', 'vision'],
  ST:  ['finishing', 'pace', 'strength', 'vision'],
  CF:  ['finishing', 'vision', 'dribbling', 'pace'],
};
const POS_GROUP = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', CDM: 'MID', CM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT', CF: 'ATT' };

const FORMATION_SLOTS = {
  '4-3-3':   ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'CDM', 'LW', 'RW', 'ST'],
  '4-2-3-1': ['GK', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CDM', 'CAM', 'LW', 'RW', 'ST'],
  '4-4-2':   ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'LW', 'RW', 'ST', 'ST'],
  '3-5-2':   ['GK', 'CB', 'CB', 'CB', 'CDM', 'CM', 'CM', 'LW', 'RW', 'ST', 'ST'],
  '5-3-2':   ['GK', 'CB', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'CM', 'ST', 'ST'],
  '4-1-4-1': ['GK', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CM', 'LW', 'RW', 'ST'],
};
const FORMATIONS = Object.keys(FORMATION_SLOTS);
// Where each place of a formation stands, for drawing it (the Lineup screen and the match board):
// [depth from his own goal 0..1, across the pitch 0..1 from the left], in FORMATION_SLOTS order, so
// slotKey `${slot}-${i + 1}` stands at FORMATION_LAYOUT[formation][i]. A 4-4-2's wide players are in
// the midfield line, a lone holding midfielder or striker is central, three centre-backs are spread.
// Drawing only: the match engine and its timeline do not use it.
const FORMATION_LAYOUT = {
  '4-3-3':   [[0.05, 0.5], [0.2, 0.39], [0.2, 0.61], [0.24, 0.12], [0.24, 0.88], [0.47, 0.31], [0.47, 0.69], [0.34, 0.5], [0.7, 0.15], [0.7, 0.85], [0.8, 0.5]],
  '4-2-3-1': [[0.05, 0.5], [0.2, 0.39], [0.2, 0.61], [0.24, 0.12], [0.24, 0.88], [0.36, 0.38], [0.36, 0.62], [0.58, 0.5], [0.62, 0.14], [0.62, 0.86], [0.8, 0.5]],
  '4-4-2':   [[0.05, 0.5], [0.2, 0.39], [0.2, 0.61], [0.24, 0.12], [0.24, 0.88], [0.45, 0.38], [0.45, 0.62], [0.48, 0.13], [0.48, 0.87], [0.77, 0.4], [0.77, 0.6]],
  '3-5-2':   [[0.05, 0.5], [0.19, 0.29], [0.18, 0.5], [0.19, 0.71], [0.34, 0.5], [0.47, 0.32], [0.47, 0.68], [0.5, 0.1], [0.5, 0.9], [0.77, 0.4], [0.77, 0.6]],
  '5-3-2':   [[0.05, 0.5], [0.19, 0.31], [0.18, 0.5], [0.19, 0.69], [0.29, 0.1], [0.29, 0.9], [0.45, 0.28], [0.43, 0.5], [0.45, 0.72], [0.76, 0.4], [0.76, 0.6]],
  '4-1-4-1': [[0.05, 0.5], [0.2, 0.39], [0.2, 0.61], [0.24, 0.12], [0.24, 0.88], [0.33, 0.5], [0.49, 0.37], [0.49, 0.63], [0.52, 0.13], [0.52, 0.87], [0.79, 0.5]],
};
const TACTICS = ['high_press', 'counter', 'possession', 'low_block'];
const TRAINING_FOCUS = ['technical', 'physical', 'tactical', 'mental', 'balanced'];

// Which natural positions can fill a slot, in order of preference.
const POS_COMPAT = {
  GK:  ['GK'],
  CB:  ['CB', 'CDM'],
  LB:  ['LB', 'CB', 'LW'],
  RB:  ['RB', 'CB', 'RW'],
  CDM: ['CDM', 'CM', 'CB'],
  CM:  ['CM', 'CDM', 'CAM'],
  CAM: ['CAM', 'CM', 'LW', 'RW'],
  LW:  ['LW', 'CAM', 'LB', 'RW'],
  RW:  ['RW', 'CAM', 'RB', 'LW'],
  ST:  ['ST', 'CF', 'LW', 'RW'],
  CF:  ['CF', 'ST', 'CAM'],
};

function buildSlotMap(formation) {
  const slots = FORMATION_SLOTS[formation] || FORMATION_SLOTS['4-4-2'];
  return slots.map((slot, index) => ({ slot, slotKey: `${slot}-${index + 1}`, index }));
}

// Rating of a player in a given slot: mean of that slot's key attributes,
// minus a familiarity penalty when it is not his natural position.
function positionAbility(player, pos) {
  const key = pos || player.position;
  const weights = POS_ATTRS[key] || ATTR_KEYS;
  const a = player.attributes;
  let total = 0, count = 0;
  for (const k of weights) { if (a[k] !== undefined) { total += a[k]; count++; } }
  let penalty = 0;
  if (player.position !== key) {
    const compat = POS_COMPAT[key] || [];
    penalty = key === 'GK' || player.position === 'GK' ? 30 : compat.includes(player.position) ? 4 : 12;
  }
  return clamp(Math.round(total / Math.max(count, 1)) - penalty, 1, 99);
}

// Weekly wage curve. Convex so that divisions differ economically.
function wageFor(ability) {
  return Math.round(clamp(1000 * Math.pow(1.07, ability - 40), 250, 120000));
}

module.exports = {
  RNG, hashString, clamp, round2,
  POS_ALL, ATTR_KEYS, POS_ATTRS, POS_GROUP, POS_COMPAT,
  FORMATION_SLOTS, FORMATION_LAYOUT, FORMATIONS, TACTICS, TRAINING_FOCUS,
  buildSlotMap, positionAbility, wageFor,
};
