// src/migrations.js — save-schema migrations. Every schema change gets a step here; saves are
// never silently dropped. A save from a newer version is refused with a clear message.

const SAVE_VERSION = 9;
const RENAMES = require('./data/renames.json');
const { RNG } = require('./utils');
const { generateClubStaff } = require('./engine/staffEngine');

// v6 (server built for the old engine) → v7 (Phase 0 engine).
// What changes and why:
//  • RNG seed/state and id counters are added (determinism, no id collisions after load).
//  • Leagues are stored with explicit club ids; old results keyed by club name are mapped to ids.
//  • club.finance.debt was a separate liability next to a positive balance; it is folded into the
//    balance so "debt" now simply means a negative balance, explained by the ledger.
//  • Wages move to the new convex wage curve (the old economy only charged 4 weeks of wages a season).
//  • Retired players that no squad references are dropped from the registry (they were dead weight).
//  • A v6 save had no in-season continental competition; it starts with the next season.
function v6to7(d, { DATA, wageFor, hashString }) {
  const seed = hashString(`${d.season}|${d.manager && d.manager.clubId}|${(d.players || []).length}`);
  const clubs = d.clubs || [];
  const referenced = new Set();
  for (const c of clubs) for (const id of [...(c.squad || []), ...(c.youth || [])]) referenced.add(id);
  const clubOfPlayer = new Map();
  for (const c of clubs) for (const id of [...(c.squad || []), ...(c.youth || [])]) clubOfPlayer.set(id, c.id);

  // Keep every referenced player; unreferenced active players become free agents (never dropped).
  const players = (d.players || []).filter(p => referenced.has(p.id) || !p.retired).map(p => {
    const attrs = { ...p.attributes };
    const keys = ['pace', 'finishing', 'passing', 'dribbling', 'defending', 'strength', 'vision', 'workRate'];
    for (const k of keys) if (typeof attrs[k] !== 'number') attrs[k] = 40;
    const ca = Math.round(keys.reduce((s, k) => s + attrs[k], 0) / keys.length);
    const h = p.history || {};
    return {
      id: p.id, name: p.name, age: p.age, nation: p.nation, clubId: clubOfPlayer.has(p.id) ? clubOfPlayer.get(p.id) : null,
      position: p.position, personality: p.personality, morale: p.morale ?? 60, fitness: p.fitness ?? 100,
      injuryRisk: p.injuryRisk ?? 8, injury: null, contractYears: Math.max(0, p.contractYears ?? 1),
      weeklyWage: wageFor(ca), wantsOut: !!p.wantsOut, listedForSale: !!p.listedForSale, loan: p.loan || null,
      retired: !!p.retired, region: p.region || null, recentMinutes: 0,
      hiddenPotential: Math.max(p.hiddenPotential ?? ca, ca), wonderkid: false, currentAbility: ca, attributes: attrs,
      history: { clubs: h.clubs || [], appearances: h.appearances || 0, subApps: h.subApps || 0, minutes: h.minutes || 0, goals: h.goals || 0, assists: h.assists || 0, trophies: h.trophies || 0, caps: h.caps || 0 },
      seasonStats: { apps: 0, subApps: 0, minutes: 0, goals: 0, assists: 0 },
    };
  });
  const playerIds = new Set(players.map(p => p.id));

  const newClubs = clubs.map(c => {
    const f = c.finance || {};
    const balance = Math.round((f.balance || 0) - (f.debt || 0));
    return {
      id: c.id, name: c.name, country: c.country, continent: c.continent, division: c.division,
      tactic: c.tactic, formation: c.formation, trainingFocus: c.trainingFocus || 'balanced', trainingIntensity: c.trainingIntensity || 3,
      identity: c.identity || 'balanced', prestige: c.prestige ?? 30, fanMood: c.fanMood ?? 50, boardTrust: c.boardTrust ?? 50, chemistry: c.chemistry ?? 50,
      finance: { balance, debt: Math.max(0, -balance), sponsorship: f.sponsorship || 100_000, transferBudget: Math.max(0, balance), wageBudget: Math.max(0, balance), debtSeasons: 0, administration: false, pendingDeduction: 0, period: null },
      facilities: { training: c.facilities?.training || 1, youth: c.facilities?.youth || 1, medical: c.facilities?.medical || 1, stadium: c.facilities?.stadium || 2000 },
      squad: (c.squad || []).filter(id => playerIds.has(id)),
      youth: (c.youth || []).filter(id => playerIds.has(id)),
      manualXI: Array.isArray(c._manualXI) ? c._manualXI.filter(s => s && s.playerId && s.slotKey).map(s => ({ slotKey: s.slotKey, playerId: s.playerId })) : null,
      manualBench: null, lastXI: null, ledger: [],
    };
  });
  for (const c of newClubs) if (c.manualXI && !c.manualXI.length) c.manualXI = null;

  const pyramids = [];
  const leagues = [];
  for (const n of DATA.nations) {
    const leagueIds = [];
    n.leagues.forEach((name, i) => {
      const level = i + 1;
      const id = `${n.country}-${level}`;
      const clubIds = newClubs.filter(c => c.country === n.country && c.division === level).map(c => c.id);
      const st = (d.leagueStates || []).find(s => s.country === n.country && s.level === level) || {};
      const byName = new Map(clubIds.map(cid => [newClubs.find(c => c.id === cid).name, cid]));
      const results = (st.results || []).map(r => ({
        comp: 'league', h: byName.get(r.home), a: byName.get(r.away), hg: r.homeGoals, ag: r.awayGoals,
        hx: r.homeXg ?? null, ax: r.awayXg ?? null, hs: r.homeShots ?? null, as: r.awayShots ?? null, pos: r.possession ?? 50,
      })).filter(r => r.h != null && r.a != null);
      const table = (st.table || []).filter(r => clubIds.includes(r.clubId)).map(r => ({
        clubId: r.clubId, p: (r.wins || 0) + (r.draws || 0) + (r.losses || 0), w: r.wins || 0, d: r.draws || 0, l: r.losses || 0,
        gf: r.gf || 0, ga: r.ga || 0, pts: r.points || 0, ded: 0,
      }));
      for (const cid of clubIds) if (!table.some(r => r.clubId === cid)) table.push({ clubId: cid, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, ded: 0 });
      const schedule = (st.schedule || []).map(wk => wk.filter(([h, a]) => clubIds.includes(h) && clubIds.includes(a)));
      leagues.push({ id, continent: n.continent, country: n.country, name, level, clubIds, table, schedule, weekIdx: st.weekIdx || 0, results });
      leagueIds.push(id);
    });
    pyramids.push({ country: n.country, continent: n.continent, leagueIds });
  }

  const qualifiers = {};
  for (const pyr of pyramids) {
    const top = leagues.find(l => l.id === pyr.leagueIds[0]);
    qualifiers[pyr.country] = top.table.slice().sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || a.clubId - b.clubId).map(r => r.clubId);
  }

  const maxPid = players.reduce((m, p) => Math.max(m, p.id), 0);
  const maxCid = newClubs.reduce((m, c) => Math.max(m, c.id), 0);
  const inSeason = !!d.seasonInProgress && (d.currentWeek || 0) < (d.totalWeeks || 0) && leagues.every(l => l.schedule.length);

  return {
    _v: 7, seed, rngState: seed, ids: { pid: maxPid + 1, cid: maxCid + 1 },
    season: d.season, completedSeasons: d.completedSeasons || 0,
    currentWeek: inSeason ? d.currentWeek : 0, totalWeeks: inSeason ? d.totalWeeks : 0,
    manager: { name: 'You', reputation: 25, trophies: 0, sacks: 0, ...(d.manager || {}), wealth: 0, ownedClubId: null, ownedSource: null },
    econ: d.econ || 1,
    history: d.history || { leagueWinners: [], continentalWinners: [], topScorers: [], sackings: [] },
    managerHistory: d.managerHistory || [],
    inbox: [{ id: 1, season: d.season, week: d.currentWeek || 0, type: 'system', text: 'Save upgraded to the new engine (v7). Debt was folded into your balance and wages were re-based; see Finances.' }],
    inboxSeq: 1, pendingBids: [], liveMatch: null, weekState: null, lastMatch: null,
    qualifiers, continental: [], pyramids,
    clubs: newClubs, players, leagues,
    _needsSeasonStart: !inSeason,
  };
}

// v7 → v8 (feature-complete build):
//  • Real-world club, league and competition names are replaced by fictional ones (data/renames.json),
//    including in history. Custom club names the player chose are untouched.
//  • New systems get their fields: staff for every club (deterministic from the save seed), cards and
//    bans, transfer fee paid, sponsorship, ticket price, board objective, coaching licence, cups,
//    achievements and records. The current season gets play-offs (2 extra weeks); the national cup
//    starts with the next season.
function v7to8(d, { DATA }) {
  const rn = (country, name) => (RENAMES.clubs[country] && RENAMES.clubs[country][name]) || name;
  const clubCountry = new Map(d.clubs.map(c => [c.name, c.country]));
  const rnAny = name => (clubCountry.has(name) ? rn(clubCountry.get(name), name) : name);
  const rng = new RNG((d.seed ^ 0x5eed) >>> 0);
  for (const c of d.clubs) {
    c.name = rn(c.country, c.name);
    c.staff = generateClubStaff(rng, c);
    c.ticketPrice = 1; c.objective = null; c.sponsor = null; c.badgeBonus = 0;
  }
  for (const p of d.players) {
    p.suspension = 0; p.yellowAcc = 0; p.lastFee = p.lastFee || 0; p.homegrownClubId = p.homegrownClubId ?? null;
    p.seasonStats = { yellows: 0, reds: 0, ...p.seasonStats };
  }
  for (const lg of d.leagues) {
    const nation = DATA.nations.find(n => n.country === lg.country);
    if (nation) lg.name = nation.leagues[lg.level - 1];
    lg.playoff = null;
  }
  for (const comp of d.continental || []) if (RENAMES.competitions[comp.id]) comp.name = RENAMES.competitions[comp.id];
  const h = d.history || {};
  for (const w of h.leagueWinners || []) w.club = rnAny(w.club);
  for (const w of h.continentalWinners || []) { w.club = rnAny(w.club); if (RENAMES.competitions[w.comp]) w.comp = RENAMES.competitions[w.comp]; }
  for (const m of d.managerHistory || []) m.club = rnAny(m.club);
  if (d.totalWeeks && d.currentWeek < d.totalWeeks + 2) d.totalWeeks = Math.max(...d.leagues.map(l => l.schedule.length)) + 2;
  d.manager = { badge: 0, course: null, status: 'employed', ...d.manager };
  d.cups = []; d.achievements = {}; d.records = {}; d.jobOffers = []; d.staffMarket = {}; d.sponsorOffers = null; d.flags = {};
  d.inbox = (d.inbox || []).concat([{ id: (d.inboxSeq || 0) + 1, season: d.season, week: d.currentWeek, type: 'system', text: 'Game updated: fictional club names, cups, play-offs, cards, staff, board objectives, sponsors and the 2D match view. The national cup starts next season.' }]);
  d.inboxSeq = (d.inboxSeq || 0) + 1;
  d._v = 8;
  return d;
}

// v8 → v9: scouting knowledge, agents and negotiations, dressing room,
// international football, the newspaper, challenges and delegation. All new state starts empty;
// the national teams and this season's challenges are created on load (no RNG is used for either).
function v8to9(d) {
  d.knowledge = {}; d.scouting = { assignments: [], reports: [] }; d.negotiations = {};
  d.news = []; d.newsSeq = 0; d.challenges = null; d.intl = null;
  d.manager = { delegate: { contracts: false, bids: false }, ...d.manager };
  d.inbox = (d.inbox || []).concat([{ id: (d.inboxSeq || 0) + 1, season: d.season, week: d.currentWeek, type: 'system', text: 'Game updated: scouting reports, agents and contract talks, the dressing room, international football, the newspaper, challenges, the 3D match view and sound.' }]);
  d.inboxSeq = (d.inboxSeq || 0) + 1;
  d._v = 9;
  return d;
}

const STEPS = { 6: v6to7, 7: v7to8, 8: v8to9 };

function migrate(raw, deps) {
  let d = raw;
  let v = d._v || 6;
  if (v > SAVE_VERSION) throw new Error(`This save was made by a newer version of The Gaffer (save v${v}, this build reads up to v${SAVE_VERSION}). Update the game to load it.`);
  while (v < SAVE_VERSION) {
    const step = STEPS[v];
    if (!step) throw new Error(`No migration from save v${v}`);
    d = step(d, deps);
    v = d._v;
  }
  return d;
}

module.exports = { migrate, SAVE_VERSION };
