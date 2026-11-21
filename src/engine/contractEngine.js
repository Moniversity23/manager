// src/engine/contractEngine.js — renewals and season-end expiry.
//
// Root causes fixed: contracts used to tick down twice (a random 1/38 weekly tick plus a season-end
// tick) and nothing ever happened at zero, so the manager had no way to renew and expired players
// lingered. Now contractYears = season-ends left, it ticks once per season, players in their final
// season trigger a warning, the manager can renew at any time, and an unrenewed player leaves.

const { wageFor } = require('../utils');
const { post, DIVISION_WAGE } = require('./financeEngine');
const divF = c => DIVISION_WAGE[Math.min(4, Math.max(1, c.division)) - 1];
const { releasePlayer } = require('./transferEngine');

const MAX_CONTRACT_YEARS = 5;

function renewalTerms(p, years, club) {
  const extension = Math.max(1, Math.min(4, parseInt(years, 10) || 2));
  const signingBonus = Math.round(p.weeklyWage * (8 + extension * 2) + p.currentAbility * 1500);
  const raiseFactor = 1 + extension * 0.05 + Math.max(0, p.hiddenPotential - p.currentAbility) / 200;
  const newWage = Math.max(Math.round(p.weeklyWage * raiseFactor), Math.round(wageFor(p.currentAbility) * (club ? divF(club) : 1)));
  const newYears = Math.min(MAX_CONTRACT_YEARS, Math.max(p.contractYears || 0, 0) + extension);
  return { extension, signingBonus, newWage, oldWage: p.weeklyWage, newYears };
}

function renewContract(club, p, years) {
  const t = renewalTerms(p, years, club);
  if (club.finance.balance < t.signingBonus) return { ok: false, error: `Signing bonus needs $${Math.round(t.signingBonus / 1000)}K`, terms: t };
  post(club, 'Signing bonus', -t.signingBonus, `${p.name} renewed for ${t.extension} year${t.extension > 1 ? 's' : ''}`);
  p.weeklyWage = t.newWage;
  p.contractYears = t.newYears;
  p.wantsOut = false;
  p.morale = Math.min(100, p.morale + 8);
  return { ok: true, player: p.name, contractYears: p.contractYears, weeklyWage: p.weeklyWage, signingBonus: t.signingBonus, terms: t };
}

function finalYearPlayers(club) {
  return [...club.squad, ...club.youth].filter(p => !p.retired && !p.loan && p.contractYears === 1);
}

// Season end. Returns { left: [...names] } for the manager's club.
function settleContracts(world) {
  const rng = world.rng;
  const managerId = world.manager.clubId;
  const left = [];
  for (const club of world.clubs) {
    const active = club.squad.filter(p => !p.retired);
    const ranked = active.slice().sort((a, b) => b.currentAbility - a.currentAbility);
    const core = new Set(ranked.slice(0, 20).map(p => p.id));
    const avg = active.length ? active.reduce((s, p) => s + p.currentAbility, 0) / active.length : 50;
    for (const p of [...club.squad, ...club.youth]) {
      if (p.retired || p.loan) continue;
      p.contractYears = (p.contractYears || 0) - 1;
      if (p.contractYears > 0) continue;
      const isYouth = club.youth.includes(p);
      if (club.id === managerId && !isYouth) {
        left.push(p.name);
        releasePlayer(world, club, p);
        continue;
      }
      // Academy contracts are renewed by delegation; AI clubs keep their core and young players.
      const keep = isYouth ? p.age < 21 : (core.has(p.id) && p.age < 33) || club.squad.filter(x => !x.retired).length <= 20;
      // An ambitious player who has outgrown a modest club may turn down a new deal and leave on a
      // free — bigger clubs then pick him up in the market (the manager's own players are handled
      // through renewals instead).
      if (keep && !isYouth && p.age <= 29 && p.currentAbility >= avg + 8 && (club.prestige || 50) < 60 && rng.chance(0.4)) {
        releasePlayer(world, club, p);
        continue;
      }
      if (keep) {
        p.contractYears = rng.int(1, 3);
        if (!isYouth) p.weeklyWage = Math.max(Math.round(p.weeklyWage * 0.9), Math.round(wageFor(p.currentAbility) * divF(club) * rng.float(0.9, 1.15)));
      } else {
        releasePlayer(world, club, p);
      }
    }
  }
  return { left };
}

module.exports = { renewalTerms, renewContract, finalYearPlayers, settleContracts, MAX_CONTRACT_YEARS };
