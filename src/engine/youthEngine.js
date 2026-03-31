const { rng, clamp, POS_ALL } = require('../utils');

const REGIONS = {
  'West Africa':    { boosts: ['pace','strength'],        label: 'Pace & Power'       },
  'East Africa':    { boosts: ['workRate','strength'],    label: 'Stamina & Work Rate' },
  'South America':  { boosts: ['dribbling','vision'],     label: 'Flair & Creativity'  },
  'Eastern Europe': { boosts: ['defending','workRate'],   label: 'Discipline & Grit'   },
  'Western Europe': { boosts: ['passing','vision'],       label: 'Technique & Vision'  },
  'Scandinavia':    { boosts: ['strength','defending'],   label: 'Physicality & Discipline'},
  'Japan/Korea':    { boosts: ['workRate','passing'],     label: 'Work Rate & Precision'},
  'North America':  { boosts: ['pace','strength'],        label: 'Athleticism'         },
  'Caribbean':      { boosts: ['pace','dribbling'],       label: 'Pace & Flair'        },
};

const COUNTRY_REGION = {
  Nigeria: 'West Africa', Ghana: 'West Africa', Senegal: 'West Africa', IvoryCoast: 'West Africa',
  Ethiopia: 'East Africa', Kenya: 'East Africa',
  Brazil: 'South America', Argentina: 'South America', Colombia: 'South America', Uruguay: 'South America',
  England: 'Western Europe', Spain: 'Western Europe', Germany: 'Western Europe', France: 'Western Europe', Italy: 'Western Europe',
  Poland: 'Eastern Europe', Czech: 'Eastern Europe', Croatia: 'Eastern Europe', Serbia: 'Eastern Europe',
  Sweden: 'Scandinavia', Norway: 'Scandinavia', Denmark: 'Scandinavia',
  Japan: 'Japan/Korea', Korea: 'Japan/Korea',
  USA: 'North America', Canada: 'North America',
  Australia: 'North America',
};

function getRegion(country) {
  return COUNTRY_REGION[country] || rng.pick(Object.keys(REGIONS));
}

function applyRegionalBoosts(player, country) {
  const region = REGIONS[getRegion(country)];
  if (!region) return;
  region.boosts.forEach(attr => {
    if (player.attributes[attr] !== undefined) {
      player.attributes[attr] = clamp(player.attributes[attr] + rng.int(4, 12), 20, 99);
    }
  });
  player.region = getRegion(country);
}

function generateYouthPlayers(club, PlayerClass, CFG) {
  const made = [];
  const intakeCount = rng.int(CFG.youthIntake[0], CFG.youthIntake[1]);

  for (let i = 0; i < intakeCount; i++) {
    const youthFac = club.facilities.youth || 1;
    const score = clamp(50 + youthFac * 5 + rng.int(-15, 20), 30, 95);
    const passChance = score >= 70 ? 0.82 : score >= 55 ? 0.60 : 0.38;
    if (!rng.chance(passChance)) continue;

    const pos = rng.pick(POS_ALL);
    const p = new PlayerClass({ age: rng.int(14, 18), nation: club.country, clubId: club.id, position: pos });

    // Academy quality improves potential
    if (rng.chance(0.04 + youthFac * 0.012)) {
      p.hiddenPotential = clamp(p.hiddenPotential + rng.int(8, 18), 62, 99);
    }

    // Regional boosts to attributes
    applyRegionalBoosts(p, club.country);
    p.currentAbility = p.overall();

    club.youth.push(p);
    const region = getRegion(club.country);
    const regionInfo = REGIONS[region] || { label: 'Mixed' };
    made.push({
      p,
      region,
      text: `Youth intake: ${p.name} (${pos}, age ${p.age}) — ${regionInfo.label} talent. Potential: ${p.hiddenPotential >= 82 ? 'Elite' : p.hiddenPotential >= 70 ? 'High' : 'Promising'}.`
    });
  }
  return made;
}

function promoteYouth(club) {
  const ready = club.youth
    .filter(p => !p.retired && (p.currentAbility >= 50 || p.hiddenPotential >= 80 || p.age >= 21))
    .slice(0, 3);
  ready.forEach(p => {
    club.youth = club.youth.filter(x => x.id !== p.id);
    p.contractYears = rng.int(2, 4);
    club.squad.push(p);
    club.fanMood    = clamp(club.fanMood + 2, 0, 100);
    club.boardTrust = clamp(club.boardTrust + 1, 0, 100);
  });
}

function generateWonderkids(clubs, PlayerClass) {
  const n = rng.int(8, 14);
  for (let i = 0; i < n; i++) {
    const club = rng.pick(clubs.filter(c => c.division >= 2));
    if (!club) continue;
    const pos = rng.pick(POS_ALL);
    const p = new PlayerClass({ age: rng.int(15, 17), nation: club.country, clubId: club.id, wonderkid: true, position: pos });
    applyRegionalBoosts(p, club.country);
    p.currentAbility = p.overall();
    club.squad.push(p);
  }
}

module.exports = { generateYouthPlayers, promoteYouth, generateWonderkids, REGIONS, getRegion };