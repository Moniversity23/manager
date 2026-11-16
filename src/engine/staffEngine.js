// src/engine/staffEngine.js — backroom staff. Every club (AI included) has the same six roles, so
// staff quality is a real, symmetric advantage, never a hidden boost.
//   assistant: halftime/selection advice · coach: training gains · fitness: weekly recovery
//   physio: injury healing · scout: scouting reach · youth: academy growth and intake quality

const { clamp } = require('../utils');

const ROLES = ['assistant', 'coach', 'fitness', 'physio', 'scout', 'youth'];
const ROLE_LABEL = { assistant: 'Assistant manager', coach: 'First-team coach', fitness: 'Fitness coach', physio: 'Head physio', scout: 'Chief scout', youth: 'Head of youth' };
const FIRST = ['Alan', 'Bayo', 'Carlos', 'Dele', 'Emre', 'Femi', 'Gus', 'Hiro', 'Ivo', 'Jonas', 'Kwesi', 'Luca', 'Mateo', 'Nnamdi', 'Oscar', 'Pablo', 'Rui', 'Sami', 'Tomas', 'Uche', 'Viktor', 'Wale', 'Yusuf', 'Zoran'];
const LAST = ['Adebayo', 'Berg', 'Costa', 'Dlamini', 'Eze', 'Fontaine', 'Gallo', 'Hayashi', 'Ibe', 'Jensen', 'Kovac', 'Lindqvist', 'Moreno', 'Nakata', 'Owusu', 'Park', 'Quaye', 'Rossi', 'Schultz', 'Tanaka', 'Uzor', 'Vidal', 'Weber', 'Yeboah'];

const staffWage = r => Math.round(150 * Math.pow(1.22, clamp(r, 1, 20) - 1));

function makeStaff(rng, role, rating) {
  const r = clamp(Math.round(rating), 1, 20);
  return { role, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, rating: r, wage: staffWage(r), years: rng.int(1, 3) };
}

// Ratings by division: top flight ~13, bottom ~6, ±2.
function generateClubStaff(rng, club) {
  const base = [13, 10, 8, 6][clamp(club.division, 1, 4) - 1];
  const staff = {};
  for (const role of ROLES) staff[role] = makeStaff(rng, role, base + rng.int(-2, 2));
  return staff;
}

// Effect modifier from a role: rating 10 = neutral; an empty post counts as rating 4.
function staffRating(club, role) { return club.staff && club.staff[role] ? club.staff[role].rating : 4; }
function staffMod(club, role, perPoint) { return 1 + (staffRating(club, role) - 10) * perPoint; }

function weeklyStaffWages(club) {
  if (!club.staff) return 0;
  return ROLES.reduce((s, r) => s + (club.staff[r] ? club.staff[r].wage : 0), 0);
}

// Five candidates per role, generated once per season so browsing never changes the game.
function candidates(world, role) {
  world.staffMarket = world.staffMarket || {};
  const key = `${world.season}:${role}`;
  if (!world.staffMarket[key]) {
    const rep = world.manager.reputation;
    const top = clamp(Math.round(6 + rep / 7), 7, 19);
    world.staffMarket[key] = [top + 1, top - 1, top - 3, top - 5, top - 7].map(r => makeStaff(world.rng, role, Math.max(2, r)));
  }
  return world.staffMarket[key];
}

module.exports = { FIRST, LAST, ROLES, ROLE_LABEL, makeStaff, generateClubStaff, staffRating, staffMod, weeklyStaffWages, candidates, staffWage };
