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

// Share of the gap to potential closed per season at each age. Players keep improving into their
// mid-twenties and can still add a little until their positional peak.
function growthRate(age, pe) {
  if (age <= 20) return 0.2;
  if (age <= 23) return 0.16;
  if (age <= 26) return 0.1;
  if (age <= pe) return 0.05;
  return 0;
}

// Everything that speeds up or slows down a player's development, as multipliers. One source for
// training and for the profile screen ("what drives his development").
function growthFactors(p, club) {
  const f = [];
  const mins = p.recentMinutes || 0;
  // Playing time matters most for young players, still a lot up to 27.
  f.push(['Playing time', p.age <= 23 ? clamp(0.55 + mins / 180, 0.55, 1.25) : p.age <= 27 ? clamp(0.75 + mins / 400, 0.75, 1.15) : clamp(0.85 + mins / 600, 0.85, 1.05)]);
  const r = p.ratings && p.ratings.length ? p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length : (p.seasonStats && p.seasonStats.rn ? p.seasonStats.rs / p.seasonStats.rn : null);
  if (r != null) f.push(['Match form', clamp(1 + (r - 6.6) * 0.18, 0.85, 1.25)]);
  f.push(['Personality', PERSONALITY_GROWTH[p.personality] || 1]);
  f.push(['Morale', clamp(0.9 + (p.morale - 40) / 250, 0.9, 1.1)]);
  f.push(['Training facilities', 1 + 0.05 * ((club.facilities.training || 1) - 1)]);
  f.push(['Coaches', staffMod(club, 'coach', 0.02) * (p.age <= 21 ? staffMod(club, 'youth', 0.02) : 1) * (1 + (club.badgeBonus || 0))]);
  f.push(['Training intensity', 1 + (clamp(club.trainingIntensity || 3, 1, 5) - 3) * 0.05]);
  const key = POS_ATTRS[p.position] || ATTR_KEYS, focus = FOCUS_ATTRS[club.trainingFocus] || ATTR_KEYS;
  if (focus !== ATTR_KEYS && key.filter(k => focus.includes(k)).length >= 2) f.push(['Training focus suits his position', 1.06]);
  if (p.fitness < 60) f.push(['Low condition', 0.9]);
  return f.map(([k, m]) => [k, Math.round(m * 100) / 100]);
}
// The same multipliers as growthFactors, computed without building lists (this runs for every
// player every week). Club-wide parts are worked out once per club per week.
function clubGrowth(club) {
  return { facilities: 1 + 0.05 * ((club.facilities.training || 1) - 1), coach: staffMod(club, 'coach', 0.02) * (1 + (club.badgeBonus || 0)), youth: staffMod(club, 'youth', 0.02),
    intensity: 1 + (clamp(club.trainingIntensity || 3, 1, 5) - 3) * 0.05, focus: FOCUS_ATTRS[club.trainingFocus] || ATTR_KEYS };
}
function growthMultiplier(p, cg) {
  const mins = p.recentMinutes || 0;
  let m = p.age <= 23 ? clamp(0.55 + mins / 180, 0.55, 1.25) : p.age <= 27 ? clamp(0.75 + mins / 400, 0.75, 1.15) : clamp(0.85 + mins / 600, 0.85, 1.05);
  let r = null;
  if (p.ratings && p.ratings.length) { r = 0; for (const x of p.ratings) r += x; r /= p.ratings.length; }
  else if (p.seasonStats && p.seasonStats.rn) r = p.seasonStats.rs / p.seasonStats.rn;
  if (r != null) m *= clamp(1 + (r - 6.6) * 0.18, 0.85, 1.25);
  m *= (PERSONALITY_GROWTH[p.personality] || 1) * clamp(0.9 + (p.morale - 40) / 250, 0.9, 1.1);
  m *= cg.facilities * cg.coach * (p.age <= 21 ? cg.youth : 1) * cg.intensity;
  if (cg.focus !== ATTR_KEYS) { const key = POS_ATTRS[p.position] || ATTR_KEYS; let n = 0; for (const k of key) if (cg.focus.includes(k)) n++; if (n >= 2) m *= 1.06; }
  if (p.fitness < 60) m *= 0.9;
  return m;
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
function trainPlayer(p, club, rng, cg = clubGrowth(club)) {
  if (p.retired || (p.injury && p.injury.weeks > 0)) return 0;
  const pe = peakEnd(p.position);
  const rate = growthRate(p.age, pe);
  const gap = p.hiddenPotential - p.currentAbility;
  if (rate <= 0 || gap <= 0) return 0;
  // Playing time, form, personality, morale, facilities, coaches, intensity and focus (growthFactors).
  const weeklyOvr = gap * rate / WEEKS_PER_SEASON * growthMultiplier(p, cg) * rng.float(0.6, 1.4);
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
  const cg = clubGrowth(club);
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
    trainPlayer(p, club, rng, cg);
    ageDecline(p, rng);
    p.recentMinutes = (p.recentMinutes || 0) * 0.6;
  }
}

// Season end: ages players and decides retirements. No attribute growth happens here.
// Potential is not fixed: a young player who plays a lot and plays well can raise his ceiling (more
// so with a good attitude); one who hardly plays in his early twenties can lose some of it.
function potentialShift(p, rng) {
  p.potChange = 0;
  if (p.retired || p.age > 27) return 0;
  const ss = p.seasonStats || {};
  const games = (ss.apps || 0) + (ss.subApps || 0) * 0.5;
  const form = ss.rn ? ss.rs / ss.rn : (p.ratings && p.ratings.length ? p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length : null);
  const near = p.hiddenPotential - p.currentAbility <= 3;
  const contributions = (ss.goals || 0) + (ss.assists || 0);
  let d = 0;
  if (games >= 16 && ((form != null && form >= 7.2) || (near && (form == null || form >= 6.8)) || contributions >= 15)) {
    d = rng.int(1, 3) + (p.age <= 21 ? 1 : 0);
    if (['Professional', 'Model Pro', 'Determined'].includes(p.personality)) d += 1;
  } else if (games >= 24 && near) d = rng.int(1, 2);
  if (d <= 0 && p.age <= 23 && games < 4 && !p.loan && rng.chance(0.6)) d = -rng.int(1, 2);
  if (d > 0 && p.personality === 'Lazy') d = Math.max(0, d - 1);
  const cap = p.wonderkid ? 96 : 92;
  const before = p.hiddenPotential;
  p.hiddenPotential = clamp(p.hiddenPotential + d, Math.ceil(p.currentAbility), Math.max(cap, before));
  p.potChange = p.hiddenPotential - before;
  return p.potChange;
}

function seasonAgeing(p, rng) {
  if (p.retired) return false;
  potentialShift(p, rng);
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

module.exports = { trainWeek, trainPlayer, ageDecline, seasonAgeing, growthFactors, growthRate, potentialShift, resetCondition, weeklyRecovery, peakEnd, WEEKS_PER_SEASON };
