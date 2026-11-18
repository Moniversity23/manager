// src/engine/developmentEngine.js — the ONE development model.
//
// Root cause fixed: players used to grow twice (weekly trainWeek + season-end seasonDevelop), and only
// the manager's club trained weekly. Now every club trains weekly through trainWeek(); season end only
// ages players and decides retirements (seasonAgeing). Training never lowers an attribute; decline
// comes only from age (ageDecline) and is applied separately so the two can be tested apart.

const { clamp, POS_ATTRS, ATTR_KEYS } = require('../utils');
const { staffMod, staffRating } = require('./staffEngine');

const WEEKS_PER_SEASON = 32;
const PEAK_END = { GK: 33, CB: 31, LW: 28, RW: 28 };
const PERSONALITY_GROWTH = { Professional: 1.25, 'Model Pro': 1.3, Determined: 1.15, Ambitious: 1.1, Leader: 1.05, Balanced: 1, Temperamental: 0.8, Lazy: 0.6 };
const FOCUS_ATTRS = {
  technical: ['passing', 'dribbling', 'finishing'],
  physical: ['pace', 'strength', 'workRate'],
  tactical: ['defending', 'vision', 'passing'],
  mental: ['vision', 'workRate', 'defending'],
  balanced: ATTR_KEYS,
};
const DECLINE_PHYSICAL = ['pace', 'strength', 'workRate'];
const DECLINE_TECHNICAL = ['finishing', 'dribbling', 'passing', 'defending'];

function peakEnd(position) { return PEAK_END[position] || 29; }

function growthRate(age, pe) {
  if (age <= 21) return 0.16;
  if (age <= 25) return 0.09;
  if (age <= pe) return 0.03;
  return 0;
}

// Weekly condition recovery. Rises with medical level and the physical attributes (stamina proxies).
function weeklyRecovery(p, club) {
  const med = club.facilities.medical || 1;
  const a = p.attributes;
  const bracket = clamp(1 + 0.004 * (a.workRate - 50) + 0.002 * (a.strength - 50), 0.7, 1.4);
  const intensity = clamp(club.trainingIntensity || 3, 1, 5);
  return 7 * 2.8 * (1 + 0.07 * (med - 1)) * bracket * (1.1 - 0.05 * intensity) * staffMod(club, 'fitness', 0.015);
}

// Training gains for one player for one week. Returns the attribute points added (always >= 0).
function trainPlayer(p, club, rng) {
  if (p.retired || (p.injury && p.injury.weeks > 0)) return 0;
  const pe = peakEnd(p.position);
  const rate = growthRate(p.age, pe);
  const gap = p.hiddenPotential - p.currentAbility;
  if (rate <= 0 || gap <= 0) return 0;
  const pers = PERSONALITY_GROWTH[p.personality] || 1;
  // Facilities, first-team coach, head of youth (for 21 and under) and the manager's licence.
  const train = (1 + 0.05 * ((club.facilities.training || 1) - 1)) * staffMod(club, 'coach', 0.02)
    * (p.age <= 21 ? staffMod(club, 'youth', 0.02) : 1) * (1 + (club.badgeBonus || 0));
  const mins = p.recentMinutes || 0;
  const minutesFactor = p.age <= 23 ? clamp(0.6 + mins / 150, 0.6, 1.15) : clamp(0.85 + mins / 600, 0.85, 1.05);
  const weeklyOvr = gap * rate / WEEKS_PER_SEASON * pers * train * minutesFactor * rng.float(0.6, 1.4);
  const points = Math.max(0, weeklyOvr * ATTR_KEYS.length);
  if (points <= 0) return 0;
  const keyAttrs = POS_ATTRS[p.position] || ATTR_KEYS;
  const keyW = [0.3, 0.27, 0.23, 0.2];
  const focus = FOCUS_ATTRS[club.trainingFocus] || ATTR_KEYS;
  keyAttrs.forEach((k, i) => { p.attributes[k] = Math.min(99, p.attributes[k] + points * 0.6 * keyW[i]); });
  for (const k of focus) p.attributes[k] = Math.min(99, p.attributes[k] + points * 0.4 / focus.length);
  p.refreshAbility();
  return points;
}

// Age-driven decline after the positional peak: physicals first, then technique.
function ageDecline(p, rng) {
  const pe = peakEnd(p.position);
  if (p.retired || p.age <= pe) return 0;
  const annual = 0.8 + 0.6 * (p.age - pe);
  const prof = p.personality === 'Professional' || p.personality === 'Model Pro' ? 0.85 : 1;
  const points = annual / WEEKS_PER_SEASON * rng.float(0.7, 1.3) * prof * ATTR_KEYS.length;
  for (const k of DECLINE_PHYSICAL) p.attributes[k] = Math.max(10, p.attributes[k] - points * 0.65 / DECLINE_PHYSICAL.length);
  for (const k of DECLINE_TECHNICAL) p.attributes[k] = Math.max(10, p.attributes[k] - points * 0.35 / DECLINE_TECHNICAL.length);
  p.refreshAbility();
  return points;
}

// The weekly tick for one club: recovery, injuries healing, training knocks, morale drift,
// training growth and age decline. Applied identically to AI clubs and the manager's club.
function trainWeek(club, rng, events) {
  const intensity = clamp(club.trainingIntensity || 3, 1, 5);
  const med = club.facilities.medical || 1;
  for (const p of [...club.squad, ...club.youth]) {
    if (p.retired) continue;
    if (p.injury && p.injury.weeks > 0) {
      p.injury.weeks -= 1;
      if (p.injury.weeks > 0 && rng.chance(clamp(0.05 * (med - 1) + 0.02 * (staffRating(club, 'physio') - 10), 0, 0.6))) p.injury.weeks -= 1;
      if (p.injury.weeks <= 0) { p.injury = null; if (events) events.push({ type: 'recovered', playerId: p.id }); }
    }
    p.fitness = clamp(p.fitness + weeklyRecovery(p, club), 0, 100);
    p.morale = clamp(p.morale + (66 - p.morale) * 0.04, 20, 100);
    if (!p.injury && rng.chance(0.002 * (0.5 + p.injuryRisk / 15) * (intensity / 3))) {
      p.injury = { type: 'training knock', weeks: rng.int(1, 3) };
      p.seasonStats.inj = (p.seasonStats.inj || 0) + 1; p.history.injuries = (p.history.injuries || 0) + 1;
      if (events) events.push({ type: 'knock', playerId: p.id, weeks: p.injury.weeks });
    }
    trainPlayer(p, club, rng);
    ageDecline(p, rng);
    p.recentMinutes = (p.recentMinutes || 0) * 0.6;
  }
}

// Season end: ages players and decides retirements. No attribute growth happens here.
function seasonAgeing(p, rng) {
  if (p.retired) return false;
  p.age += 1;
  p.seasonStats = { apps: 0, subApps: 0, minutes: 0, goals: 0, assists: 0, yellows: 0, reds: 0 };
  if (p.age >= 40) { p.retired = true; return true; }
  if (p.age >= 34) {
    let prob = 0.12 + 0.12 * (p.age - 34);
    if (p.personality === 'Determined' || p.personality === 'Model Pro') prob -= 0.05;
    if (!p.clubId) prob += 0.25;
    if (rng.chance(clamp(prob, 0.02, 0.95))) { p.retired = true; return true; }
  }
  return false;
}

// Season start: every player fit and injury-free.
function resetCondition(p) {
  p.fitness = 100;
  p.injury = null;
  p.suspension = 0;
  p.yellowAcc = 0;
}

module.exports = { trainWeek, trainPlayer, ageDecline, seasonAgeing, resetCondition, weeklyRecovery, peakEnd, WEEKS_PER_SEASON };
