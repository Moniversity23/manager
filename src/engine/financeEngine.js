// src/engine/financeEngine.js
const { rng, clamp } = require('../utils');

const UPKEEP_BASE = 300_000;
const WAGE_PER_ABILITY = 800;

function weeklyWages(club) {
  const squad = club.squad.filter(p => !p.retired);
  return squad.reduce((sum, p) => sum + p.weeklyWage, 0);
}

function updateClubFinances(club, position, leagueSize, wonCup, isContWinner, econ) {
  const div = club.division || 1;
  const pres = club.prestige;

  // Revenue
  const ticketRev = Math.round(club.facilities.stadium * (15 + pres / 3) * (club.fanMood / 60) * econ);
  const tvMoney = Math.round((5 - Math.min(div, 4)) * 400_000 * (pres / 30) * econ);
  const sponsorRev = Math.round(club.finance.sponsorship * econ);
  const prizeMoney = position ? Math.round((leagueSize - position + 1) * 80_000 * (5 - Math.min(div, 4)) * econ) : 0;
  const cupBonus = wonCup ? Math.round(500_000 * econ) : 0;
  const contBonus = isContWinner ? Math.round(1_500_000 * econ) : 0;
  const merchRev = Math.round(pres * 12_000 * econ);

  // Expenses
  const wages = weeklyWages(club) * 4;
  const facilities = Math.round(UPKEEP_BASE + club.facilities.training * 60_000 + club.facilities.youth * 50_000 + club.facilities.medical * 40_000);
  const staffCost = Math.round(50_000 * div);

  const totalIn = ticketRev + tvMoney + sponsorRev + prizeMoney + cupBonus + contBonus + merchRev;
  const totalOut = wages + facilities + staffCost;

  club.finance.balance += totalIn - totalOut;

  // Debt handling
  if (club.finance.balance < -500_000) {
    club.finance.debt = clamp(club.finance.debt + Math.abs(club.finance.balance) * 0.08, 0, 200_000_000);
  } else if (club.finance.debt > 0 && club.finance.balance > 0) {
    const repay = Math.min(club.finance.debt, club.finance.balance * 0.12);
    club.finance.debt -= repay;
    club.finance.balance -= repay;
  }

  // Budget recalc
  const safeBalance = Math.max(0, club.finance.balance);
  club.finance.transferBudget = clamp(safeBalance * 0.20, 50_000, 80_000_000);
  club.finance.wageBudget = clamp(safeBalance * 0.12, 30_000, 40_000_000);
  club.finance.sponsorship = Math.round(club.finance.sponsorship * (1 + (position <= 3 ? 0.05 : position > leagueSize - 3 ? -0.03 : 0.01)));

  // Mood / prestige
  const topHalf = position <= Math.ceil(leagueSize / 2);
  club.fanMood = clamp(club.fanMood + (position <= 3 ? 8 : topHalf ? 2 : -6) + (wonCup ? 5 : 0), 0, 100);
  club.prestige = clamp(club.prestige + (position === 1 ? 4 : position <= 3 ? 2 : topHalf ? 0 : -2), 1, 99);
  club.boardTrust = clamp(club.boardTrust + (topHalf ? 5 : -8) + (club.finance.balance < 0 ? -6 : 0), 0, 100);
}

function upgradeFacilities(club) {
  if (club.finance.balance < 2_000_000) return;
  const opts = club.identity === 'youth' ? ['youth', 'training', 'medical'] : ['training', 'youth', 'medical', 'stadium'];
  const pick = rng.pick(opts);
  const cost = pick === 'stadium' ? 2_000_000 : 1_200_000;
  if (club.finance.balance < cost) return;

  club.finance.balance -= cost;
  if (pick === 'stadium') {
    club.facilities.stadium = Math.round(club.facilities.stadium * 1.15 + 500);
  } else {
    club.facilities[pick] = Math.min(10, (club.facilities[pick] || 1) + 1);
  }
}

module.exports = { updateClubFinances, upgradeFacilities, weeklyWages };