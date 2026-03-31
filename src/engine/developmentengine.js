const { rng, clamp, POS_ATTRS } = require('../utils');

// Weekly automatic training — players improve by just playing and training
function weeklyDevelopment(club) {
  const squad = club.squad.filter(p => !p.retired);
  const trainingLv = club.facilities.training || 1;
  const intensity = clamp(club.trainingIntensity || 3, 1, 5);
  const focus = club.trainingFocus || 'balanced';
  const focusAttrs = {
    technical: ['passing', 'dribbling', 'finishing'],
    physical: ['pace', 'strength', 'workRate'],
    tactical: ['defending', 'vision', 'passing'],
    mental: ['vision', 'workRate', 'strength'],
  };

  squad.forEach(p => {
    // Fitness recovery (improved by medical facility)
    const medLv = club.facilities.medical || 1;
    const recovery = 3 + medLv * 0.8 - intensity * 0.35;
    p.fitness = clamp(p.fitness + rng.float(recovery * 0.6, recovery * 1.35), 20, 100);

    // Morale drift toward 65
    p.morale = clamp(p.morale + (66 - p.morale) * 0.04 + rng.float(-1, 1) - Math.max(0, intensity - 4) * 0.5, 20, 100);

    // Weekly training gains are small, but they help younger players.
    if (p.age <= 24 && rng.chance(0.6)) {
      const attrs = focusAttrs[focus] || Object.keys(p.attributes);
      const attr = rng.pick(attrs);
      if (p.attributes[attr] !== undefined) {
        const gain = rng.float(0.02, 0.14) * (1 + trainingLv * 0.08) * (1 + intensity * 0.04);
        p.attributes[attr] = clamp(p.attributes[attr] + gain, 20, 99);
      }
      p.currentAbility = p.overall();
    }

    // Contract year countdown (weekly tick, ~38 per season)
    if (rng.chance(1 / 38)) {
      p.contractYears = Math.max(0, (p.contractYears || 1) - 1);
    }
  });
}

// Season-end development — main growth + age decline
function seasonDevelop(player, trainingQuality, competitionMinutes) {
  if (player.retired) return;

  const age = player.age;

  // Age factor
  const ageFactor =
    age <= 18 ? 1.5 :
    age <= 21 ? 1.2 :
    age <= 25 ? 1.0 :
    age <= 28 ? 0.55 :
    age <= 31 ? 0.15 :
    -0.5;

  // Personality factor
  const persMod =
    player.personality === 'Professional' ? 1.25 :
    player.personality === 'Ambitious'    ? 1.10 :
    player.personality === 'Leader'       ? 1.05 :
    player.personality === 'Lazy'         ? 0.60 :
    player.personality === 'Temperamental'? 0.80 : 1.0;

  // Experience factor (more minutes = more growth)
  const expFactor = clamp((competitionMinutes || 0) / 2500, 0, 1.3);

  const gap = Math.max(0, player.hiddenPotential - player.currentAbility);
  const growthRate = gap * 0.025 * ageFactor * persMod * (1 + trainingQuality * 0.05) * (1 + expFactor * 0.3);

  if (ageFactor > 0) {
    // Position-specific growth — boost the most relevant attributes
    const posAttrs = POS_ATTRS[player.position] || Object.keys(player.attributes);
    posAttrs.forEach((attr, idx) => {
      if (!player.attributes[attr]) return;
      const weight = 1 - idx * 0.08; // primary attr grows more
      const gain = growthRate * weight * rng.float(0.6, 1.4);
      player.attributes[attr] = clamp(player.attributes[attr] + gain, 20, 99);
    });
    // Small random improvement to secondary attrs
    Object.keys(player.attributes).forEach(attr => {
      if (posAttrs.includes(attr)) return;
      if (rng.chance(0.3)) {
        player.attributes[attr] = clamp(player.attributes[attr] + rng.float(-0.2, 0.6), 20, 99);
      }
    });
  } else {
    // Decline phase — mainly pace and strength
    const declineAttrs = ['pace', 'strength'];
    declineAttrs.forEach(attr => {
      if (player.attributes[attr]) {
        player.attributes[attr] = clamp(player.attributes[attr] + ageFactor * rng.float(0.4, 1.2), 20, 99);
      }
    });
    // Vision and workRate hold longer
    if (age > 34) {
      player.attributes.vision   = clamp(player.attributes.vision   - rng.float(0, 0.5), 20, 99);
      player.attributes.workRate = clamp(player.attributes.workRate  - rng.float(0, 0.3), 20, 99);
    }
  }

  player.currentAbility = player.overall();
  player.age += 1;
  player.contractYears = Math.max(0, player.contractYears - 1);
  player.weeklyMinutes = 0; // reset season counter

  // Retirement check
  if (age >= 36 && rng.chance(0.20)) player.retired = true;
  if (age >= 38 && rng.chance(0.50)) player.retired = true;
  if (age >= 40) player.retired = true;
}

// Contract expiry notification
function getExpiringContracts(squad) {
  return squad.filter(p => !p.retired && p.contractYears <= 1);
}

module.exports = { weeklyDevelopment, seasonDevelop, getExpiringContracts };
