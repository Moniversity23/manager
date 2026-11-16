// src/engine/boardEngine.js — board objectives and confidence, sackings, job offers, coaching badges.
//
// Objective: the board ranks every club in your league by squad strength; your target is that rank
// (a little kinder at the bottom). Confidence (club.boardTrust, 0–100) moves weekly with league
// position against the target and with the balance. Below 30 → ultimatum; below 12 after week 10,
// or a season far below target with low confidence → sacked. A sacked manager must take a job offer.

const { clamp } = require('../utils');
const { squadStrength } = require('./matchEngine');

const BADGES = [
  { name: 'None', cost: 0, weeks: 0 },
  { name: 'C Licence', cost: 5_000, weeks: 6 },
  { name: 'B Licence', cost: 20_000, weeks: 10 },
  { name: 'A Licence', cost: 60_000, weeks: 14 },
  { name: 'Pro Licence', cost: 150_000, weeks: 20 },
];
// Minimum licence to be offered a job in division 1 / 2 / 3 / 4.
const DIVISION_BADGE = [3, 2, 0, 0];

function setObjectives(world, club, league) {
  const ranked = league.clubIds.map(id => ({ id, s: squadStrength(world.clubById(id)) })).sort((a, b) => b.s - a.s || a.id - b.id);
  const rank = ranked.findIndex(r => r.id === club.id) + 1;
  const size = league.clubIds.length;
  const target = Math.min(size - 2, rank + (rank > size / 2 ? 2 : 1));
  let text;
  if (league.level > 1 && target <= 2) text = 'Win promotion automatically (top 2).';
  else if (league.level > 1 && target <= 6) text = `Reach the play-offs (finish ${target} or better).`;
  else if (league.level === 1 && target <= 4) text = `Qualify for continental football (top ${Math.max(target, 4)}).`;
  else text = `Finish ${target} or better${target >= size - 4 ? ' — avoid relegation' : ''}.`;
  club.objective = { season: world.season, strengthRank: rank, target, text, warned: false };
  return club.objective;
}

// Weekly update for the manager's club. Returns 'sacked' | 'ultimatum' | null.
function weeklyConfidence(world, club, league) {
  const obj = club.objective;
  if (!obj || world.currentWeek < 4) return null;
  const pos = league.positionOf(club.id);
  const gap = obj.target - pos; // positive = above target
  let delta = clamp(gap * 0.3, -1.5, 1.5);
  if (club.finance.balance < 0) delta -= 0.7;
  club.boardTrust = clamp(Math.round((club.boardTrust + delta) * 10) / 10, 0, 100);
  // A new manager gets a full first season; after that the board can act mid-season.
  const firstSeason = (world.manager.joinedSeason ?? world.season) >= world.season;
  if (club.boardTrust < 12 && world.currentWeek >= 16 && obj.warned && !firstSeason) return 'sacked';
  if (club.boardTrust < 30 && !obj.warned) { obj.warned = true; return 'ultimatum'; }
  return null;
}

// Season-end verdict. Returns 'sacked' | 'renewed'.
function seasonReview(world, club, finalPos, extras) {
  const obj = club.objective || { target: 8 };
  let delta = (obj.target - finalPos) * 4;
  if (extras.promoted) delta += 25;
  if (extras.relegated) delta -= 25;
  delta += 10 * (extras.trophies || 0);
  if (club.finance.balance < 0) delta -= 8;
  club.boardTrust = clamp(Math.round(club.boardTrust + delta), 0, 100);
  const firstSeason = (world.manager.joinedSeason ?? world.season) >= world.season;
  if (club.boardTrust < (firstSeason ? 8 : 20) && finalPos > obj.target + 3) return 'sacked';
  return 'renewed';
}

function badgeLevel(world) { return world.manager.badge || 0; }

// Job offers. kind 'sacked' → smaller or similar clubs; 'promotion' → bigger clubs that noticed you.
function jobOffers(world, kind) {
  const me = world.manager;
  const cur = world.club();
  const owned = me.ownedClubId;
  const rep = me.reputation;
  const lvl = badgeLevel(world);
  const pool = world.clubs.filter(c => c.id !== cur.id && c.id !== owned && lvl >= DIVISION_BADGE[clamp(c.division, 1, 4) - 1]);
  let picks;
  if (kind === 'sacked') {
    picks = pool.filter(c => c.division >= cur.division && c.prestige <= Math.max(cur.prestige, rep) + 5)
      .sort((a, b) => b.prestige - a.prestige || a.id - b.id);
    picks = world.rng.shuffle(picks.slice(0, 20)).slice(0, 3);
  } else {
    picks = pool.filter(c => c.prestige > cur.prestige + 4 && c.prestige <= rep + 15 && c.division <= cur.division)
      .sort((a, b) => b.prestige - a.prestige || a.id - b.id);
    picks = world.rng.shuffle(picks.slice(0, 12)).slice(0, 2);
  }
  return picks.map(c => ({ clubId: c.id, kind, season: world.season, week: world.currentWeek }));
}

// Job centre: clubs open to applications this season (deterministic, no randomness).
function vacancies(world) {
  const cur = world.club();
  // Only jobs within reach: clubs whose prestige is at most 20 above your reputation.
  return world.clubs.filter(c => c.id !== cur.id && c.id !== world.manager.ownedClubId && c.boardTrust < 45 && c.prestige <= world.manager.reputation + 20)
    .sort((a, b) => b.prestige - a.prestige || a.id - b.id).slice(0, 10)
    .map(c => ({ clubId: c.id, chance: clamp(Math.round(50 + (world.manager.reputation - c.prestige) * 4), 0, 95), needsBadge: DIVISION_BADGE[clamp(c.division, 1, 4) - 1] }));
}

module.exports = { setObjectives, weeklyConfidence, seasonReview, jobOffers, vacancies, BADGES, DIVISION_BADGE, badgeLevel };
