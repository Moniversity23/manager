const { rng, clamp, applyStats, selectBestXI, positionAbility } = require('../utils');

// Tactic vs tactic effectiveness matrix
const TACTIC_MATRIX = {
  high_press: { high_press: 1.0, counter: 0.88, possession: 1.12, low_block: 1.08 },
  counter:    { high_press: 1.14, counter: 1.0, possession: 1.06, low_block: 0.94 },
  possession: { high_press: 0.90, counter: 0.96, possession: 1.0, low_block: 1.10 },
  low_block:  { high_press: 0.94, counter: 1.08, possession: 0.92, low_block: 1.0  },
};

const TACTIC_FATIGUE = {
  high_press: 1.12,
  counter: 0.94,
  possession: 0.98,
  low_block: 0.88,
};

function tacticBonus(myTactic, opponentTactic) {
  return (TACTIC_MATRIX[myTactic] || {})[opponentTactic] || 1.0;
}

function squadStrength(club, asHome) {
  const squad = club.squad.filter(p => !p.retired && p.fitness > 20);
  if (squad.length < 7) return 28;

  // Select best XI for the formation
  const xi = club._manualXI || selectBestXI(squad, club.formation);
  club._currentXI = xi.map(s => s.player).filter(Boolean);

  const xiPlayers = club._currentXI;
  const posAbility = xi.reduce((sum, s) => {
    if (!s.player) return sum;
    return sum + positionAbility(s.player, s.slot);
  }, 0) / Math.max(xi.length, 1);

  const avgFitness = xiPlayers.reduce((s, p) => s + p.fitness, 0) / Math.max(xiPlayers.length, 1);
  const avgMorale  = xiPlayers.reduce((s, p) => s + p.morale, 0) / Math.max(xiPlayers.length, 1);
  const bench = squad
    .filter(p => !club._currentXI.some(x => x.id === p.id))
    .sort((a, b) => b.currentAbility - a.currentAbility)
    .slice(0, 5);
  const benchDepth = bench.length ? bench.reduce((s, p) => s + p.currentAbility, 0) / bench.length : posAbility * 0.85;
  const chemBonus  = 1 + club.chemistry / 220;
  const homeBonus  = asHome ? 1.07 : 1.0;
  const presBonus  = 1 + club.prestige / 1000;
  const fitFactor  = clamp(avgFitness / 86, 0.82, 1.08);
  const morFactor  = clamp(avgMorale / 76, 0.86, 1.08);

  return (posAbility * 0.82 + benchDepth * 0.18) * chemBonus * homeBonus * presBonus * fitFactor * morFactor;
}

function simulateMatch(home, away, table) {
  const hStr = squadStrength(home, true) * tacticBonus(home.tactic, away.tactic);
  const aStr = squadStrength(away, false) * tacticBonus(away.tactic, home.tactic);
  const total = Math.max(hStr + aStr, 1);
  const strengthDelta = (hStr - aStr) / total;
  const posH = clamp(50 + strengthDelta * 24 + rng.int(-5, 5), 35, 65);

  const hAttack = clamp(hStr / 52, 0.7, 1.8);
  const aAttack = clamp(aStr / 52, 0.7, 1.8);
  const hDef = clamp((aStr / 55), 0.7, 1.6);
  const aDef = clamp((hStr / 55), 0.7, 1.6);

  const homeXg = clamp(1.15 + (hAttack - hDef) * 0.55 + strengthDelta * 0.9 + (posH - 50) / 90 + rng.float(-0.22, 0.28), 0.2, 3.8);
  const awayXg = clamp(0.95 + (aAttack - aDef) * 0.5 - strengthDelta * 0.72 + (50 - posH) / 95 + rng.float(-0.24, 0.24), 0.15, 3.4);

  const sh = clamp(Math.round(homeXg * 5.4 + rng.int(2, 6)), 4, 23);
  const sa = clamp(Math.round(awayXg * 5.2 + rng.int(2, 6)), 3, 21);
  const gh = poissonGoals(homeXg);
  const ga = poissonGoals(awayXg);

  applyStats(home, gh, ga, TACTIC_FATIGUE[home.tactic] || 1);
  applyStats(away, ga, gh, TACTIC_FATIGUE[away.tactic] || 1);

  const hr = table.find(r => r.club.id === home.id);
  const ar = table.find(r => r.club.id === away.id);
  if (!hr || !ar) return { homeGoals: gh, awayGoals: ga, home: home.name, away: away.name };

  hr.gf += gh; hr.ga += ga;
  ar.gf += ga; ar.ga += gh;

  if (gh > ga) {
    hr.points += 3; hr.wins += 1; ar.losses += 1;
    home.fanMood = clamp(home.fanMood + 3, 0, 100);
    away.fanMood = clamp(away.fanMood - 2, 0, 100);
  } else if (ga > gh) {
    ar.points += 3; ar.wins += 1; hr.losses += 1;
    away.fanMood = clamp(away.fanMood + 3, 0, 100);
    home.fanMood = clamp(home.fanMood - 2, 0, 100);
  } else {
    hr.points += 1; ar.points += 1; hr.draws += 1; ar.draws += 1;
  }

  return {
    homeGoals: gh, awayGoals: ga,
    home: home.name, away: away.name,
    homeShots: sh, awayShots: sa,
    possession: posH,
    homeXg: round2(homeXg),
    awayXg: round2(awayXg),
    homeForm: gh > ga ? 'W' : gh < ga ? 'L' : 'D',
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function poissonGoals(lambda) {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > l && k < 12);
  return clamp(k - 1, 0, 8);
}

function knockout(a, b) {
  const pa = squadStrength(a, true) + rng.int(-5, 5);
  const pb = squadStrength(b, false) + rng.int(-5, 5);
  if (pa === pb) return rng.chance(0.5) ? a : b;
  return pa > pb ? a : b;
}

module.exports = { simulateMatch, knockout, squadStrength };
