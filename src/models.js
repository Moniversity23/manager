// src/models.js — Player and Club entities.
// Constructors never touch global state: randomness comes from ctx.rng and ids from
// ctx.nextPlayerId()/ctx.nextClubId(), both owned by the GameWorld and stored in the save.
// Loading uses fromData(), which does NOT run the constructor, so a load never consumes
// random numbers or ids.

const { clamp, POS_ALL, ATTR_KEYS, positionAbility, wageFor } = require('./utils');

const PERSONALITY = ['Professional', 'Ambitious', 'Lazy', 'Leader', 'Temperamental', 'Balanced', 'Determined', 'Model Pro'];

// Names come from the player's nation (src/names.js).
const { poolFor } = require('./names');

const POS_BOOSTS = {
  GK: ['strength', 'defending', 'vision'],
  CB: ['defending', 'strength'],
  LB: ['pace', 'defending', 'passing'],
  RB: ['pace', 'defending', 'passing'],
  CDM: ['defending', 'workRate', 'passing'],
  CM: ['passing', 'vision', 'workRate'],
  CAM: ['vision', 'passing', 'dribbling'],
  LW: ['pace', 'dribbling', 'finishing'],
  RW: ['pace', 'dribbling', 'finishing'],
  ST: ['finishing', 'pace', 'strength'],
  CF: ['finishing', 'vision', 'dribbling'],
};

// Ceilings for freshly generated youth (fixes "99-rated academy players").
const YOUTH_CAPS = { ovr: 55, attr: 75, wonderkidOvr: 60, wonderkidAttr: 82 };

// Fields only some players/clubs have (dressing room, agents, scouting): saved only when set, so
// 14,000 players do not carry empty keys and a save/load round trip stays identical.
const PLAYER_OPTIONAL = ['releaseClause', 'promise', 'playLog', 'unhappy', 'unhappyWeeks', 'talkWeek', 'talksBlockedUntil', 'seasonStartAbility', 'ratings'];
const CLUB_OPTIONAL = ['captainId', 'unbeatenRun', 'sackedSeason', 'managerName'];
function withOptional(obj, out, keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) out[keys[i]] = v;
  }
  return out;
}

function emptySeasonStats() { return { apps: 0, subApps: 0, minutes: 0, goals: 0, assists: 0, yellows: 0, reds: 0 }; }

class Player {
  // ctx: { rng, nextPlayerId, season }
  constructor(ctx, { age, nation, clubId, position = null, wonderkid = false, ability = null }) {
    const rng = ctx.rng;
    this.id = ctx.nextPlayerId();
    this.nation = nation || 'Unknown';
    const pool = poolFor(this.nation);
    this.name = `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
    this.age = age;
    this.clubId = clubId ?? null;
    this.position = position || rng.pick(POS_ALL);
    this.personality = rng.pick(PERSONALITY);
    this.morale = rng.int(55, 80);
    this.fitness = 100;
    this.injuryRisk = rng.int(1, 15);
    this.injury = null;               // { type, weeks }
    this.suspension = 0;              // matches still to serve
    this.yellowAcc = 0;               // yellows towards the next ban (5 = one match)
    this.lastFee = 0;                 // fee paid by the current club
    this.homegrownClubId = null;      // academy that produced him
    this.contractYears = rng.int(1, 4);
    this.wantsOut = false;
    this.listedForSale = false;
    this.loan = null;
    this.retired = false;
    this.region = null;
    this.recentMinutes = 0;           // decaying minutes, feeds development
    this.hiddenPotential = wonderkid ? rng.int(84, 97) : 0;
    this.wonderkid = !!wonderkid;

    const attrs = {
      pace: rng.int(30, 78), finishing: rng.int(25, 75), passing: rng.int(28, 76), dribbling: rng.int(28, 76),
      defending: rng.int(25, 76), strength: rng.int(28, 78), vision: rng.int(28, 76), workRate: rng.int(32, 80),
    };
    for (const k of (POS_BOOSTS[this.position] || [])) attrs[k] = clamp(attrs[k] + rng.int(5, 14), 1, 85);
    this.attributes = attrs;

    if (ability) {
      const target = rng.int(ability[0], ability[1]);
      const scale = target / Math.max(this.overall(), 1);
      for (const k of ATTR_KEYS) this.attributes[k] = clamp(Math.round(this.attributes[k] * scale * rng.float(0.88, 1.12)), 15, 95);
    }
    this.currentAbility = this.overall();
    // Potential is headroom above current ability, wider for the young (wonderkids keep their range).
    if (!wonderkid) {
      const head = age <= 18 ? rng.int(8, 30) : age <= 21 ? rng.int(4, 20) : age <= 24 ? rng.int(1, 10) : rng.int(0, 3);
      this.hiddenPotential = clamp(this.currentAbility + head, 1, 95);
    }
    if (this.hiddenPotential < this.currentAbility) this.hiddenPotential = clamp(this.currentAbility + rng.int(0, 4), 1, 99);
    this.weeklyWage = Math.round(wageFor(this.currentAbility) * rng.float(0.85, 1.2));

    this.history = { clubs: [{ clubId: this.clubId, season: ctx.season }], appearances: 0, subApps: 0, minutes: 0, goals: 0, assists: 0, trophies: 0, caps: 0 };
    this.seasonStats = emptySeasonStats();
  }

  static fromData(d) {
    const p = Object.assign(Object.create(Player.prototype), d);
    p.attributes = { ...d.attributes };
    return p;
  }

  toData() {
    return withOptional(this, {
      id: this.id, name: this.name, age: this.age, nation: this.nation, clubId: this.clubId,
      position: this.position, personality: this.personality, morale: this.morale, fitness: this.fitness,
      injuryRisk: this.injuryRisk, injury: this.injury, suspension: this.suspension || 0, yellowAcc: this.yellowAcc || 0,
      lastFee: this.lastFee || 0, homegrownClubId: this.homegrownClubId ?? null,
      contractYears: this.contractYears, weeklyWage: this.weeklyWage,
      wantsOut: this.wantsOut, listedForSale: this.listedForSale, loan: this.loan, retired: this.retired,
      region: this.region, recentMinutes: this.recentMinutes, hiddenPotential: this.hiddenPotential,
      wonderkid: this.wonderkid, currentAbility: this.currentAbility, attributes: this.attributes,
      history: this.history, seasonStats: this.seasonStats,
    }, PLAYER_OPTIONAL);
  }

  overall() {
    let sum = 0;
    for (const k of ATTR_KEYS) sum += this.attributes[k];
    return Math.round(sum / ATTR_KEYS.length);
  }

  refreshAbility() { this.currentAbility = this.overall(); }
  posAbility(pos) { return positionAbility(this, pos || this.position); }
  isInjured() { return !!(this.injury && this.injury.weeks > 0); }

  hint() {
    const gap = this.hiddenPotential - this.currentAbility;
    return gap > 22 ? 'Explosive upside' : gap > 13 ? 'Strong upside' : gap > 5 ? 'Modest upside' : 'Near peak';
  }

  // Public view for the API/UI. Includes the legacy aliases the UI reads (ovr, fit, attrs …).
  toJSON(value) {
    const attrs = Object.fromEntries(ATTR_KEYS.map(k => [k, Math.round(this.attributes[k])]));
    const ovr = Math.round(this.currentAbility);
    return {
      id: this.id, name: this.name, age: this.age, nation: this.nation, clubId: this.clubId,
      position: this.position, personality: this.personality,
      morale: Math.round(this.morale), fitness: Math.round(this.fitness),
      injury: this.injury, injured: this.isInjured(), suspension: this.suspension || 0, homegrown: this.homegrownClubId != null,
      injuryRisk: this.injuryRisk, contractYears: this.contractYears, weeklyWage: this.weeklyWage,
      wantsOut: this.wantsOut, listedForSale: this.listedForSale, retired: this.retired, loan: this.loan,
      hiddenPotential: this.hiddenPotential, currentAbility: ovr, attributes: attrs,
      history: this.history, seasonStats: this.seasonStats, region: this.region,
      hint: this.hint(), marketValue: value ?? null,
      ovr, pot: this.hiddenPotential, fit: Math.round(this.fitness), mor: Math.round(this.morale),
      pers: this.personality, attrs,
      form: this.ratings && this.ratings.length ? Math.round(this.ratings.reduce((a, b) => a + b, 0) / this.ratings.length * 10) / 10 : null,
      progress: this.seasonStartAbility != null ? ovr - this.seasonStartAbility : null,
      awards: this.history.awards || 0, caps: this.history.caps || 0,
      apps: this.history.appearances, subApps: this.history.subApps || 0,
      goals: this.history.goals, assists: this.history.assists, trophies: this.history.trophies,
    };
  }
}

// Clamp a freshly generated youngster to realistic ceilings.
function applyYouthCaps(p) {
  const attrCap = p.wonderkid ? YOUTH_CAPS.wonderkidAttr : YOUTH_CAPS.attr;
  const ovrCap = p.wonderkid ? YOUTH_CAPS.wonderkidOvr : YOUTH_CAPS.ovr;
  for (const k of ATTR_KEYS) p.attributes[k] = Math.min(p.attributes[k], attrCap);
  let ovr = p.overall();
  if (ovr > ovrCap) {
    const scale = ovrCap / ovr;
    for (const k of ATTR_KEYS) p.attributes[k] = Math.max(10, Math.floor(p.attributes[k] * scale));
    ovr = p.overall();
  }
  p.currentAbility = ovr;
  if (p.hiddenPotential < ovr) p.hiddenPotential = ovr;
  p.weeklyWage = Math.min(p.weeklyWage, wageFor(ovr));
}

class Club {
  // ctx: { rng, nextClubId }
  constructor(ctx, { name, country, continent, division }) {
    const rng = ctx.rng;
    this.id = ctx.nextClubId();
    this.name = name;
    this.country = country;
    this.continent = continent;
    this.division = division;
    this.tactic = rng.pick(['high_press', 'counter', 'possession', 'low_block']);
    this.formation = rng.pick(['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '5-3-2', '4-1-4-1']);
    this.trainingFocus = 'balanced';
    this.trainingIntensity = rng.int(2, 4);
    this.identity = rng.pick(['youth', 'defensive', 'attacking', 'trading', 'balanced']);
    const lv = Math.min(division, 4);
    this.prestige = clamp(18 + (4 - lv) * 12 + rng.int(-5, 8), 5, 88);
    this.fanMood = rng.int(40, 70);
    this.boardTrust = rng.int(40, 68);
    this.chemistry = rng.int(35, 65);
    const divMult = Math.max(0.15, 1 / division);
    this.finance = {
      balance: Math.round((1_000_000 + rng.int(200_000, 1_500_000)) * divMult * (1 + this.prestige / 40)),
      debt: 0,
      sponsorship: Math.round(300_000 * divMult * (1 + this.prestige / 60)),
      transferBudget: 0, wageBudget: 0,
      debtSeasons: 0, administration: false, pendingDeduction: 0,
      period: null,
    };
    this.facilities = {
      training: clamp(rng.int(1, 3) + (4 - lv), 1, 8),
      youth: clamp(rng.int(1, 3) + (4 - lv), 1, 7),
      medical: clamp(rng.int(1, 2) + (4 - lv), 1, 7),
      stadium: Math.round((5000 + rng.int(1000, 8000)) * divMult),
    };
    this.squad = [];
    this.youth = [];
    this.manualXI = null;     // [{ slotKey, playerId }] — manager overrides, any slot
    this.manualBench = null;  // [playerId] — manager-chosen bench
    this.lastXI = null;       // [{ slotKey, playerId }] — last starting XI, keeps the first team stable
    this.ledger = [];         // closed weekly periods
    this.staff = null;        // { role: { name, rating, wage, years } } — set by the world
    this.ticketPrice = 1;     // multiplier on the base ticket price (0.5–2)
    this.objective = null;    // board objective for the season
  }

  static fromData(d, playersById) {
    const c = Object.assign(Object.create(Club.prototype), d);
    c.squad = (d.squad || []).map(id => playersById.get(id)).filter(Boolean);
    c.youth = (d.youth || []).map(id => playersById.get(id)).filter(Boolean);
    c.finance = { ...d.finance };
    c.facilities = { ...d.facilities };
    c.ledger = d.ledger || [];
    return c;
  }

  toData() {
    return withOptional(this, {
      id: this.id, name: this.name, country: this.country, continent: this.continent, division: this.division,
      tactic: this.tactic, formation: this.formation, trainingFocus: this.trainingFocus,
      trainingIntensity: this.trainingIntensity, identity: this.identity, prestige: this.prestige,
      fanMood: this.fanMood, boardTrust: this.boardTrust, chemistry: this.chemistry,
      finance: this.finance, facilities: this.facilities,
      squad: this.squad.map(p => p.id), youth: this.youth.map(p => p.id),
      manualXI: this.manualXI, manualBench: this.manualBench, lastXI: this.lastXI,
      ledger: this.ledger, staff: this.staff, ticketPrice: this.ticketPrice ?? 1, objective: this.objective || null,
      sponsor: this.sponsor || null, badgeBonus: this.badgeBonus || 0,
    }, CLUB_OPTIONAL);
  }

  active() { return this.squad.filter(p => !p.retired); }
}

module.exports = { Player, Club, PERSONALITY, YOUTH_CAPS, applyYouthCaps, emptySeasonStats };
