// src/engine/financeEngine.js — weekly itemised ledger, debt rule, facilities.
//
// Root cause fixed: finance used to run once per season as one opaque number, and many code paths
// changed club.finance.balance directly, so the manager could not see why money moved. Now every
// change goes through post(), which writes a categorised line into the club's open weekly period.
// closePeriod() archives it, and opening + Σ items = closing holds for every club, every week.

const { clamp } = require('../utils');
const { weeklyStaffWages } = require('./staffEngine');

const TV_PER_SEASON = [1_600_000, 1_000_000, 750_000, 450_000];
const TICKET_PRICE = [24, 16, 12, 9];
const PRIZE_PER_PLACE = [60_000, 25_000, 12_000, 6_000];
const BACKROOM_PER_SEASON = [180_000, 90_000, 45_000, 18_000]; // kit, travel, admin (named staff are paid separately)
// New contracts reflect the league: the same player earns less in a lower division.
const DIVISION_WAGE = [1, 0.85, 0.72, 0.6];
const MANAGER_SALARY_WEEK = [5_000, 2_500, 1_200, 600];
const FACILITY_UPKEEP_PER_LEVEL = 15_000;   // per season, per level of training/youth/medical
const SEAT_UPKEEP = 3;                      // per seat, per season
const OVERDRAFT_RATE = 0.10;                // per season, on a negative balance
const WEEKS = 32;
// Shirt sponsorship: what a deal is worth is set by the club itself — division, prestige, fans and
// stadium — never by the previous deal, so it cannot compound from one season to the next (it used
// to, and reached billions). Capped per division.
// Same scale as a new club's starting deal (models.js), so no club loses income it already had.
const SPONSOR_CAP = [2_500_000, 1_200_000, 600_000, 300_000];
const FACILITY_MAX = 10;
const FACILITY_TYPES = ['training', 'youth', 'medical'];
const DETAILED_KEEP = 60;
const BASIC_KEEP = 4;

const divIdx = d => clamp((d || 1) - 1, 0, 3);

function openPeriod(club, season, week, detailed) {
  club.finance.period = { season, week, opening: Math.round(club.finance.balance), items: {}, detailed: !!detailed, entries: detailed ? [] : undefined };
}

function sponsorValue(club, econ = 1) {
  const d = divIdx(club.division), divMult = Math.max(0.15, 1 / (d + 1));
  const fans = 0.85 + clamp(club.fanMood ?? 50, 0, 100) / 330;                       // 0.85 … 1.15
  const v = 300_000 * divMult * (1 + clamp(club.prestige || 50, 1, 99) / 60) * fans * econ;
  return Math.round(clamp(v, 25_000, SPONSOR_CAP[d]) / 1000) * 1000;
}

// The ONLY way money moves. amount > 0 is income, < 0 is a cost.
function post(club, category, amount, note) {
  const amt = Math.round(amount);
  if (!amt) return 0;
  if (!club.finance.period) openPeriod(club, null, null, false);
  const per = club.finance.period;
  club.finance.balance = Math.round(club.finance.balance + amt);
  per.items[category] = (per.items[category] || 0) + amt;
  if (per.detailed) per.entries.push({ cat: category, amount: amt, note: note || '' });
  syncBudgets(club);
  return amt;
}

function syncBudgets(club) {
  const safe = Math.max(0, club.finance.balance);
  club.finance.transferBudget = safe;
  club.finance.wageBudget = safe;
  club.finance.debt = Math.max(0, -club.finance.balance);
}

function closePeriod(club) {
  const per = club.finance.period;
  if (!per) return null;
  let income = 0, costs = 0;
  for (const v of Object.values(per.items)) { if (v > 0) income += v; else costs += -v; }
  const summary = { season: per.season, week: per.week, opening: per.opening, income, costs, closing: Math.round(club.finance.balance), items: per.items };
  if (per.detailed) summary.entries = per.entries;
  club.ledger.push(summary);
  const keep = per.detailed ? DETAILED_KEEP : BASIC_KEEP;
  if (club.ledger.length > keep) club.ledger.splice(0, club.ledger.length - keep);
  club.finance.period = null;
  return summary;
}

function weeklyWageBill(club) {
  let total = 0;
  for (const p of [...club.squad, ...club.youth]) {
    if (p.retired) continue;
    total += p.loan && p.loan.parentClubId !== club.id ? (p.loan.wageContribution ?? p.weeklyWage) : p.weeklyWage;
  }
  return total;
}

// Wages this club still pays for its players out on loan elsewhere.
function loanedOutWageShare(club, players) {
  let total = 0;
  for (const p of players) {
    if (p.loan && p.loan.parentClubId === club.id && p.clubId !== club.id && !p.retired) {
      total += Math.max(0, p.weeklyWage - (p.loan.wageContribution || 0));
    }
  }
  return total;
}

function upkeepPerSeason(club) {
  const f = club.facilities;
  return FACILITY_TYPES.reduce((s, k) => s + (f[k] || 1) * FACILITY_UPKEEP_PER_LEVEL, 0) + (f.stadium || 0) * SEAT_UPKEEP;
}

// Regular weekly income and costs (gate receipts are posted by the match itself).
function weeklyPostings(club, ctx) {
  const d = divIdx(club.division);
  const econ = ctx.econ || 1;
  post(club, 'TV money', TV_PER_SEASON[d] / WEEKS * econ, `Division ${club.division} broadcast share`);
  // 30% of a signed shirt deal is paid up front (sponsorAdvance); the rest arrives weekly.
  post(club, 'Sponsorship', Math.max(0, (club.finance.sponsorship || 0) - (club.finance.sponsorAdvance || 0)) / WEEKS * econ, 'Sponsor instalment');
  post(club, 'Merchandise', club.prestige * 12_000 / WEEKS * econ * clamp(club.fanMood / 60, 0.5, 1.5), 'Club shop');
  post(club, 'Player wages', -weeklyWageBill(club), `${club.squad.length + club.youth.length} players`);
  const loanShare = ctx.loanedOut ? loanedOutWageShare(club, ctx.loanedOut) : 0;
  if (loanShare) post(club, 'Player wages', -loanShare, 'Share of wages for players out on loan');
  post(club, 'Staff wages', -weeklyStaffWages(club), 'Assistant, coaches, physio, scout, head of youth');
  post(club, 'Backroom costs', -BACKROOM_PER_SEASON[d] / WEEKS, 'Kit, travel and administration');
  post(club, 'Facility upkeep', -upkeepPerSeason(club) / WEEKS, 'Grounds, training and medical');
  if (club.finance.balance < 0) post(club, 'Overdraft interest', club.finance.balance * OVERDRAFT_RATE / WEEKS, '10% a year on the overdraft');
  if (ctx.isManagerClub) {
    const salary = MANAGER_SALARY_WEEK[d];
    post(club, 'Manager salary', -salary, 'Your weekly salary');
    return salary;
  }
  return 0;
}

function gateReceipts(home, away, ctx) {
  const d = divIdx(home.division);
  const capacity = Math.max(500, Math.round(home.facilities.stadium || 1000));
  // Ticket price multiplier set by the manager (0.5×–2×): dearer tickets, fewer fans.
  const mult = clamp(home.ticketPrice || 1, 0.5, 2);
  const fill = clamp((0.3 + home.fanMood / 220 + home.prestige / 260 + (away ? away.prestige : 30) / 700) * (1 - 0.4 * (mult - 1)), 0.1, 1);
  const attendance = Math.round(capacity * fill);
  const price = TICKET_PRICE[d] * (1 + home.prestige / 150) * (ctx.econ || 1) * mult;
  post(home, 'Gate receipts', attendance * price, `${attendance.toLocaleString('en-US')} fans vs ${away ? away.name : 'opponent'} @ $${price.toFixed(0)}`);
  return attendance;
}

// Pure estimate of one home gate (no posting) for budget projections.
function gateEstimate(home, ctx) {
  const d = divIdx(home.division);
  const capacity = Math.max(500, Math.round(home.facilities.stadium || 1000));
  const mult = clamp(home.ticketPrice || 1, 0.5, 2);
  const fill = clamp((0.3 + home.fanMood / 220 + home.prestige / 260 + 30 / 700) * (1 - 0.4 * (mult - 1)), 0.1, 1);
  return Math.round(capacity * fill) * TICKET_PRICE[d] * (1 + home.prestige / 150) * (ctx.econ || 1) * mult;
}

function prizeMoney(club, position, leagueSize, ctx) {
  const d = divIdx(club.division);
  return post(club, 'League prize money', (leagueSize - position + 1) * PRIZE_PER_PLACE[d] * (ctx.econ || 1), `Finished ${position} of ${leagueSize}`);
}

function facilityUpgradeCost(club, type) {
  if (type === 'stadium') {
    const seats = club.facilities.stadium || 1000;
    return Math.round(1000 * 250 * (1 + seats / 20_000));
  }
  const lv = club.facilities[type] || 1;
  if (lv >= FACILITY_MAX) return null;
  return Math.round(300_000 * Math.pow(1.6, lv - 1));
}

function upgradeFacility(club, type) {
  if (type !== 'stadium' && !FACILITY_TYPES.includes(type)) return { ok: false, error: 'Invalid facility' };
  const cost = facilityUpgradeCost(club, type);
  if (cost == null) return { ok: false, error: 'Already at max level' };
  if (club.finance.balance < cost) return { ok: false, error: `Need $${Math.round(cost / 1000)}K` };
  if (type === 'stadium') {
    post(club, 'Facility investment', -cost, 'Stadium expansion (+1,000 seats)');
    club.facilities.stadium = (club.facilities.stadium || 1000) + 1000;
    return { ok: true, newLevel: club.facilities.stadium, cost };
  }
  post(club, 'Facility investment', -cost, `${type} level ${club.facilities[type] + 1}`);
  club.facilities[type] = (club.facilities[type] || 1) + 1;
  return { ok: true, newLevel: club.facilities[type], cost };
}

// AI clubs invest profits rationally (no hidden boosts).
function aiInvest(club, rng) {
  const type = club.identity === 'youth' ? rng.pick(['youth', 'training', 'youth', 'medical']) : rng.pick(['training', 'youth', 'medical', 'stadium']);
  const cost = facilityUpgradeCost(club, type);
  if (cost == null) return null;
  if (club.finance.balance < Math.max(1_500_000, cost * 3)) return null;
  return upgradeFacility(club, type).ok ? type : null;
}

// Season-end debt review. Returns the stage the club is at after this season.
//  1 season in debt → warning; 2 → final warning + transfer-spending freeze; 3+ → forced sales.
function debtReview(club) {
  if (club.finance.balance < 0) club.finance.debtSeasons = (club.finance.debtSeasons || 0) + 1;
  else { club.finance.debtSeasons = 0; club.finance.administration = false; }
  const n = club.finance.debtSeasons;
  return n >= 3 ? 'forced' : n === 2 ? 'final' : n === 1 ? 'warning' : 'ok';
}

function spendingFrozen(club) {
  return club.finance.administration || ((club.finance.debtSeasons || 0) >= 2 && club.finance.balance < 0);
}

module.exports = {
  openPeriod, post, closePeriod, syncBudgets, weeklyPostings, gateReceipts, prizeMoney,
  weeklyWageBill, upkeepPerSeason, facilityUpgradeCost, upgradeFacility, aiInvest,
  debtReview, spendingFrozen, gateEstimate, FACILITY_MAX, FACILITY_TYPES, TV_PER_SEASON, MANAGER_SALARY_WEEK, DIVISION_WAGE, WEEKS, TICKET_PRICE,
  BACKROOM_PER_SEASON, PRIZE_PER_PLACE, sponsorValue, SPONSOR_CAP,
};
