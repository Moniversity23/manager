// src/engine/youthEngine.js — intake, promotion, wonderkids.
//
// Root causes fixed:
//  • Youth and wonderkids were never added to world.players, so fromSave dropped them on every reload.
//    Every generated player now goes through world.registerPlayer().
//  • Fresh youth could be generated with near-elite attributes. Intake now applies YOUTH_CAPS
//    (16-year-old overall ≤ 55, single attribute ≤ 75, wonderkids ≤ 82).

const { clamp, POS_ALL } = require('../utils');
const { Player, applyYouthCaps } = require('../models');
const { staffRating } = require('./staffEngine');

const REGIONS = {
  'West Africa':    { boosts: ['pace', 'strength'],      label: 'Pace & Power' },
  'East Africa':    { boosts: ['workRate', 'strength'],  label: 'Stamina & Work Rate' },
  'South America':  { boosts: ['dribbling', 'vision'],   label: 'Flair & Creativity' },
  'Eastern Europe': { boosts: ['defending', 'workRate'], label: 'Discipline & Grit' },
  'Western Europe': { boosts: ['passing', 'vision'],     label: 'Technique & Vision' },
  'Scandinavia':    { boosts: ['strength', 'defending'], label: 'Physicality & Discipline' },
  'Japan/Korea':    { boosts: ['workRate', 'passing'],   label: 'Work Rate & Precision' },
  'North America':  { boosts: ['pace', 'strength'],      label: 'Athleticism' },
  'Caribbean':      { boosts: ['pace', 'dribbling'],     label: 'Pace & Flair' },
};

const COUNTRY_REGION = {
  Nigeria: 'West Africa', Ghana: 'West Africa', Senegal: 'West Africa', IvoryCoast: 'West Africa',
  Ethiopia: 'East Africa', Kenya: 'East Africa',
  Brazil: 'South America', Argentina: 'South America', Colombia: 'South America', Uruguay: 'South America',
  England: 'Western Europe', Spain: 'Western Europe', Germany: 'Western Europe', France: 'Western Europe', Italy: 'Western Europe',
  Poland: 'Eastern Europe', Czech: 'Eastern Europe', Croatia: 'Eastern Europe', Serbia: 'Eastern Europe',
  Sweden: 'Scandinavia', Norway: 'Scandinavia', Denmark: 'Scandinavia',
  Japan: 'Japan/Korea', Korea: 'Japan/Korea',
  USA: 'North America', Canada: 'North America', Australia: 'North America',
};

function getRegion(country) { return COUNTRY_REGION[country] || 'Western Europe'; }

function applyRegionalBoosts(rng, p, country) {
  const region = getRegion(country);
  for (const attr of REGIONS[region].boosts) p.attributes[attr] = clamp(p.attributes[attr] + rng.int(4, 12), 1, 99);
  p.region = region;
}

function makeYouth(world, club, { wonderkid = false } = {}) {
  const rng = world.rng;
  const p = new Player(world.ctx(), {
    age: rng.int(15, 16), nation: club.country, clubId: club.id, position: rng.pick(POS_ALL), wonderkid,
    ability: wonderkid ? [44, 58] : [26, 46],
  });
  applyRegionalBoosts(rng, p, club.country);
  const yf = club.facilities.youth || 1;
  if (!wonderkid) {
    // Better academies and bigger clubs produce higher ceilings.
    // Better academies, bigger clubs and a better head of youth produce higher ceilings.
    p.hiddenPotential = clamp(p.hiddenPotential + Math.round(yf * 1.5 + club.prestige / 8 + (staffRating(club, 'youth') - 10) * 0.5), 1, 92);
    if (rng.chance(0.04 + yf * 0.012)) p.hiddenPotential = clamp(p.hiddenPotential + rng.int(6, 14), 55, 92);
  }
  p.refreshAbility();
  applyYouthCaps(p);
  p.weeklyWage = Math.max(150, Math.round(p.weeklyWage * 0.3)); // academy contract
  p.contractYears = rng.int(2, 3);
  p.homegrownClubId = club.id;
  p.lastFee = 0;
  world.registerPlayer(p);
  return p;
}

function intake(world, club, cfg) {
  const rng = world.rng;
  const made = [];
  const n = rng.int(cfg.youthIntake[0], cfg.youthIntake[1]);
  const yf = club.facilities.youth || 1;
  for (let i = 0; i < n; i++) {
    const score = clamp(50 + yf * 5 + rng.int(-15, 20), 30, 95);
    const pass = score >= 70 ? 0.82 : score >= 55 ? 0.6 : 0.38;
    if (!rng.chance(pass)) continue;
    const p = makeYouth(world, club);
    club.youth.push(p);
    made.push(p);
  }
  return made;
}

// About one wonderkid per nation per season, placed in a lower-division academy.
function generateWonderkids(world) {
  const rng = world.rng;
  const made = [];
  const nations = [...new Set(world.clubs.map(c => c.country))];
  for (const country of nations) {
    if (!rng.chance(0.9)) continue;
    const club = rng.pick(world.clubs.filter(c => c.country === country && c.division >= 2));
    if (!club) continue;
    const p = makeYouth(world, club, { wonderkid: true });
    club.youth.push(p);
    made.push(p);
  }
  return made;
}

// AI clubs promote ready youngsters. Over-age academy players (21+) are never left to rot:
// they move up to the senior squad (the manager is told) or, if the squad is full, are released.
function promoteYouth(world, club, isManagerClub) {
  const promoted = [];
  const ready = club.youth.filter(p => !p.retired && (p.age >= 21 || (!isManagerClub && (p.currentAbility >= 50 || p.hiddenPotential >= 80) && p.age >= 17)));
  for (const p of ready.slice(0, isManagerClub ? ready.length : 3)) {
    club.youth = club.youth.filter(x => x.id !== p.id);
    club.squad.push(p);
    p.contractYears = Math.max(p.contractYears, 2);
    promoted.push(p);
  }
  return promoted;
}

module.exports = { intake, generateWonderkids, promoteYouth, makeYouth, REGIONS, getRegion, applyRegionalBoosts };
