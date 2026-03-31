class RNG {
  constructor(seed = Date.now() >>> 0) { this.s = seed >>> 0; }
  next() { this.s = (1664525 * this.s + 1013904223) >>> 0; return this.s / 4294967296; }
  int(a, b) { return Math.floor(this.next() * (b - a + 1)) + a; }
  float(a, b) { return this.next() * (b - a) + a; }
  pick(arr) { return arr[this.int(0, arr.length - 1)]; }
  shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = this.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  chance(p) { return this.next() < p; }
}

const rng = new RNG();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Tactic modifiers
function tmod(t) {
  const m = {
    high_press:  { a: 1.07, d: 0.96, f: 1.15 },
    counter:     { a: 0.98, d: 1.06, f: 0.95 },
    possession:  { a: 1.02, d: 1.03, f: 0.92 },
    low_block:   { a: 0.90, d: 1.12, f: 0.88 },
  };
  return m[t] || { a: 1, d: 1, f: 1 };
}

// Formation modifiers
function formationMod(f) {
  const m = {
    '4-3-3':   { a: 1.06, d: 0.97, base: 1.0 },
    '4-2-3-1': { a: 1.03, d: 1.02, base: 0.8 },
    '4-4-2':   { a: 1.01, d: 1.01, base: 0.7 },
    '3-5-2':   { a: 1.04, d: 0.99, base: 0.6 },
    '5-3-2':   { a: 0.94, d: 1.10, base: 0.5 },
    '4-1-4-1': { a: 1.00, d: 1.05, base: 0.7 },
  };
  return m[f] || { a: 1, d: 1, base: 0.5 };
}

// Position definitions
const POSITIONS = ['GK', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CM', 'LW', 'RW', 'ST'];
const POS_ALL = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST', 'CF'];
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
const POS_GROUPS = {
  GK: ['GK'],
  DEF: ['CB','LB','RB'],
  MID: ['CDM','CM','CAM'],
  ATT: ['LW','RW','ST','CF'],
};

// Formation -> required positions
const FORMATION_SLOTS = {
  '4-3-3':   ['GK','CB','CB','LB','RB','CM','CM','CDM','LW','RW','ST'],
  '4-2-3-1': ['GK','CB','CB','LB','RB','CDM','CDM','CAM','LW','RW','ST'],
  '4-4-2':   ['GK','CB','CB','LB','RB','CM','CM','LW','RW','ST','ST'],
  '3-5-2':   ['GK','CB','CB','CB','CDM','CM','CM','LW','RW','ST','ST'],
  '5-3-2':   ['GK','CB','CB','CB','LB','RB','CM','CM','CM','ST','ST'],
  '4-1-4-1': ['GK','CB','CB','LB','RB','CDM','CM','CM','LW','RW','ST'],
};

// Position compatibility for lineup selection
const POS_COMPAT = {
  GK:  ['GK'],
  CB:  ['CB','CDM'],
  LB:  ['LB','CB','LW'],
  RB:  ['RB','CB','RW'],
  CDM: ['CDM','CM','CB'],
  CM:  ['CM','CDM','CAM'],
  CAM: ['CAM','CM','LW','RW'],
  LW:  ['LW','CAM','LB'],
  RW:  ['RW','CAM','RB'],
  ST:  ['ST','CF','LW','RW'],
  CF:  ['CF','ST','CAM'],
};

// Position-specific ability calculation (weighted attributes)
function positionAbility(player, pos) {
  const key = pos || player.position;
  const weights = POS_ATTRS[key] || Object.keys(player.attributes);
  const a = player.attributes;
  let total = 0, count = 0;
  weights.forEach(k => { if (a[k]) { total += a[k]; count++; } });
  // Penalty for playing out of natural position
  const natural = player.position === key ? 0 : -4;
  return clamp(Math.round(total / Math.max(count, 1)) + natural, 20, 99);
}

// Select best XI for a formation
function selectBestXI(squad, formation) {
  const slots = FORMATION_SLOTS[formation] || FORMATION_SLOTS['4-4-2'];
  const available = squad.filter(p => !p.retired && p.fitness > 30).sort((a, b) => b.currentAbility - a.currentAbility);
  const used = new Set();
  const lineup = [];

  for (const slot of slots) {
    const compat = POS_COMPAT[slot] || [slot];
    // Find best available compatible player
    const candidates = available.filter(p => !used.has(p.id) && compat.some(c => c === p.position));
    if (candidates.length > 0) {
      used.add(candidates[0].id);
      lineup.push({ player: candidates[0], slot });
    } else {
      // Fallback: anyone available
      const fallback = available.find(p => !used.has(p.id));
      if (fallback) { used.add(fallback.id); lineup.push({ player: fallback, slot }); }
      else lineup.push({ player: null, slot });
    }
  }
  return lineup;
}

// Apply match stats to players
function applyStats(club, gf, ga, fatigue) {
  const xi = club._currentXI || club.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility).slice(0, 11);
  xi.forEach((p, i) => {
    if (!p) return;
    p.history.appearances += 1;
    const isForward = ['ST','CF','LW','RW','CAM'].includes(p.position);
    const goalChance = isForward ? 0.22 : i < 6 ? 0.08 : 0.03;
    const assistChance = ['CM','CAM','LW','RW'].includes(p.position) ? 0.15 : 0.06;
    for (let g = 0; g < gf; g++) {
      if (rng.chance(goalChance)) p.history.goals += 1;
      if (rng.chance(assistChance)) p.history.assists += 1;
    }
    // Fatigue affected by strength attribute
    const strFactor = 1 - (p.attributes.strength - 50) * 0.003;
    p.fitness = clamp(p.fitness - rng.int(2, 8) * fatigue * Math.max(0.5, strFactor), 20, 100);
    p.morale = clamp(p.morale + (gf > ga ? 3 : gf < ga ? -3 : 0), 20, 100);
    p.weeklyMinutes = (p.weeklyMinutes || 0) + 90;
  });
  club.chemistry = clamp(club.chemistry + (gf > ga ? 1 : gf < ga ? -1 : 0), 20, 98);
}

function goals(shots, atk, oppDef) {
  let g = 0;
  const q = clamp((atk / (oppDef * 1.5)) * 0.22, 0.04, 0.40);
  for (let i = 0; i < shots; i++) if (rng.chance(q + rng.float(-0.02, 0.04))) g++;
  return clamp(g, 0, 9);
}

module.exports = { RNG, rng, clamp, tmod, formationMod, goals, applyStats, POSITIONS, POS_ALL, POS_ATTRS, POS_GROUPS, FORMATION_SLOTS, POS_COMPAT, positionAbility, selectBestXI };