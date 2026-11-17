// src/index.js — GameWorld: builds the world, advances time in a fixed order, snapshots, saves.
//
// Weekly tick order (one call = one matchweek):
//   beginWeek():  1 calendar events → 2 training/recovery for every squad → manager's match first half
//   finishWeek(): manager's second half → 3 every other fixture (league + continental) →
//                 4 post-match updates → 5 AI market and bids → 6 finance postings + ledger close →
//                 7 news → season end when the last round is played.
// stepWeek() = beginWeek() + finishWeek({}) so a headless run takes exactly the same path.
// The engine never uses Math.random; all randomness comes from this.rng, whose state is saved.

const DATA = require('./data/world.json');
const { RNG, hashString, clamp, buildSlotMap, positionAbility, wageFor, TACTICS, FORMATIONS, TRAINING_FOCUS, FORMATION_SLOTS, POS_ALL } = require('./utils');
const { Player, Club, applyYouthCaps } = require('./models');
const { pickXI, pickBench, isAvailable, countAvailable } = require('./engine/selection');
const ME = require('./engine/matchEngine');
const DEV = require('./engine/developmentEngine');
const FIN = require('./engine/financeEngine');
const TR = require('./engine/transferEngine');
const CON = require('./engine/contractEngine');
const YOUTH = require('./engine/youthEngine');
const { League, sortRows, leagueZone, zoneLabel, promoteAndRelegate, assertWorldInvariants } = require('./engine/seasonEngine');
const COMP = require('./engine/competitionEngine');
const CUP = require('./engine/cupEngine');
const BOARD = require('./engine/boardEngine');
const AW = require('./engine/awardsEngine');
const STAFF = require('./engine/staffEngine');
const SCOUT = require('./engine/scoutingEngine');
const NEG = require('./engine/negotiationEngine');
const DR = require('./engine/dressingRoomEngine');
const INTL = require('./engine/internationalEngine');
const NEWS = require('./engine/newsEngine');
const CH = require('./engine/challengeEngine');
const REGIONAL = require('./engine/regionalEngine');
const RENAMES = require('./data/renames.json');
const { migrate, SAVE_VERSION } = require('./migrations');

// Old (real-world) club names may never be generated again for new regional clubs.
const BANNED_NAMES = new Set(Object.values(RENAMES.clubs).flatMap(m => Object.keys(m)));

const CFG = {
  startSeason: 2026,
  leagueSize: DATA.leagueSize,
  youthIntake: [1, 3],
  windows: [[0, 3], [13, 16]],   // window is open while currentWeek (rounds played) is in these ranges
  inboxKeep: 120,
};

const SQUAD_SIZE = 20;

class GameWorld {
  constructor(opts = {}) {
    this.cfg = CFG;
    this.data = DATA;
    this.seed = (opts.seed ?? 20260101) >>> 0;
    this.rng = new RNG(this.seed);
    this.ids = { pid: 1, cid: 1 };
    this.season = CFG.startSeason;
    this.clubs = [];
    this.leagues = [];
    this.pyramids = [];
    this.players = new Map();
    this.history = { leagueWinners: [], continentalWinners: [], topScorers: [], sackings: [] };
    this.managerHistory = [];
    this.manager = { name: opts.managerName || 'You', reputation: 25, clubId: null, trophies: 0, sacks: 0, wealth: 0, ownedClubId: null, ownedSource: null, badge: 0, course: null, status: 'employed' };
    this.econ = 1;
    this.completedSeasons = 0;
    this.currentWeek = 0;
    this.totalWeeks = 0;
    this.inbox = [];
    this.pendingBids = [];
    this.continental = [];
    this.qualifiers = {};
    this.liveMatch = null;
    this.weekState = null;
    this.lastMatch = null;
    this.cups = [];
    this.achievements = {};
    this.records = {};
    this.jobOffers = [];
    this.staffMarket = {};
    this.sponsorOffers = null;
    this.flags = {};
    this.knowledge = {};
    this.scouting = { assignments: [], reports: [] };
    this.negotiations = {};
    this.news = [];
    this.newsSeq = 0;
    this.challenges = null;
    this.intl = null;
    this._inboxSeq = 0;
    if (!opts._fromSave) {
      this._build(opts);
      INTL.init(this);
      this._startSeason();
    }
  }

  // ── infrastructure ──────────────────────────────────────────────
  ctx() { return { rng: this.rng, nextPlayerId: () => this.ids.pid++, nextClubId: () => this.ids.cid++, season: this.season }; }
  matchCtx() { return { rng: this.rng, getPlayer: id => this.players.get(id), getClub: id => this.clubById(id) }; }
  registerPlayer(p) { this.players.set(p.id, p); return p; }
  clubById(id) { return this._clubMap.get(id); }
  leagueById(id) { return this._leagueMap.get(id); }
  leagueOf(clubId) { return this.leagues.find(l => l.clubIds.includes(clubId)); }
  club() { return this.clubById(this.manager.clubId); }
  league() { return this.leagueOf(this.manager.clubId); }
  _index() {
    this._clubMap = new Map(this.clubs.map(c => [c.id, c]));
    this._leagueMap = new Map(this.leagues.map(l => [l.id, l]));
  }
  isWindowOpen(week = this.currentWeek) { return CFG.windows.some(([a, b]) => week >= a && week <= b); }
  notify(type, text, extra = {}) {
    const item = { id: ++this._inboxSeq, season: this.season, week: this.currentWeek, type, text, ...extra };
    this.inbox.push(item);
    if (this.inbox.length > CFG.inboxKeep) this.inbox.splice(0, this.inbox.length - CFG.inboxKeep);
    if (this.weekState) this.weekState.events.push({ type, text });
    return item;
  }

  static availableCountries() { return DATA.nations.map(n => n.country).sort(); }

  // Setup lists only clubs in each nation's LOWEST division — the career always starts there.
  static setupClubs() {
    const out = {};
    for (const n of DATA.nations) {
      const names = (n.clubs[n.leagues.length - 1] || []).slice(0, DATA.leagueSize);
      while (names.length < DATA.leagueSize) names.push(`${n.country} Club ${names.length + 1}`);
      out[n.country] = { league: n.leagues[n.leagues.length - 1], clubs: [...names].sort() };
    }
    return out;
  }

  // ── world build ─────────────────────────────────────────────────
  _build(opts) {
    for (const n of DATA.nations) {
      const leagueIds = [];
      n.leagues.forEach((lname, div) => {
        const names = (n.clubs[div] || []).slice(0, CFG.leagueSize);
        while (names.length < CFG.leagueSize) names.push(`${n.country} Club ${names.length + 1}`);
        const ids = names.map(name => {
          const c = new Club(this.ctx(), { name, country: n.country, continent: n.continent, division: div + 1 });
          this.clubs.push(c);
          this._seedSquad(c, div + 1);
          return c.id;
        });
        const lg = new League({ id: `${n.country}-${div + 1}`, continent: n.continent, country: n.country, name: lname, level: div + 1, clubIds: ids });
        this.leagues.push(lg);
        leagueIds.push(lg.id);
      });
      this.pyramids.push({ country: n.country, continent: n.continent, leagueIds });
    }
    this._index();
    for (const c of this.clubs) c.staff = STAFF.generateClubStaff(this.rng, c);
    for (const pyr of this.pyramids) {
      const top = this.leagueById(pyr.leagueIds[0]);
      this.qualifiers[pyr.country] = top.clubIds.slice().sort((a, b) => this.clubById(b).prestige - this.clubById(a).prestige || a - b);
    }
    this._configureManager(opts);
  }

  _seedSquad(club, division) {
    const baseLow = Math.max(28, 62 - division * 8);
    const baseHigh = Math.max(40, 80 - division * 8);
    const add = (opts) => { const p = this.registerPlayer(new Player(this.ctx(), { nation: club.country, clubId: club.id, ...opts })); return p; };
    club.squad.push(add({ age: this.rng.int(20, 34), position: 'GK', ability: [baseLow, baseHigh] }));
    const outfield = ['CB', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CM', 'CAM', 'LW', 'RW', 'ST', 'CB', 'CM', 'ST', 'LW', 'RB', 'CDM', 'GK', 'ST'];
    for (let i = 0; i < SQUAD_SIZE - 1; i++) club.squad.push(add({ age: this.rng.int(17, 34), position: outfield[i] || this.rng.pick(POS_ALL), ability: [baseLow, baseHigh] }));
    const nYouth = this.rng.int(2, 4);
    for (let i = 0; i < nYouth; i++) {
      const y = add({ age: this.rng.int(15, 18), position: this.rng.pick(POS_ALL), ability: [Math.max(22, baseLow - 15), Math.max(35, baseLow)] });
      if (y.age <= 17) applyYouthCaps(y);
      y.weeklyWage = Math.max(150, Math.round(y.weeklyWage * 0.3));
      club.youth.push(y);
    }
  }

  _configureManager(opts) {
    const country = opts.startCountry || 'Nigeria';
    const pyr = this.pyramids.find(p => p.country === country);
    if (!pyr) throw new Error(`Unknown country: ${country}`);
    const bottom = this.leagueById(pyr.leagueIds[pyr.leagueIds.length - 1]);
    const candidates = bottom.clubIds.map(id => this.clubById(id)).sort((a, b) => a.prestige - b.prestige || a.id - b.id);
    let selected;
    if (opts.mode === 'existing' && opts.startClubName) {
      selected = candidates.find(c => c.name === opts.startClubName);
      if (!selected) throw new Error(`${opts.startClubName} is not in the lowest division of ${country}. Pick a club from ${bottom.name}.`);
    } else {
      selected = candidates[0];
    }
    if (opts.mode === 'create' && opts.customClubName) {
      for (const p of [...selected.squad, ...selected.youth]) this.players.delete(p.id);
      selected.squad = [];
      selected.youth = [];
      selected.name = String(opts.customClubName).trim().slice(0, 30);
      selected.identity = this.rng.pick(['youth', 'balanced', 'trading']);
      selected.chemistry = 38;
      const poss = ['GK', 'CB', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CM', 'LW', 'RW', 'ST', 'CB', 'CM', 'LW', 'ST', 'RB', 'CDM', 'RW', 'ST', 'GK'];
      for (const pos of poss) selected.squad.push(this.registerPlayer(new Player(this.ctx(), { age: this.rng.int(17, 30), nation: selected.country, clubId: selected.id, position: pos, ability: [28, 46] })));
      for (let i = 0; i < 3; i++) {
        const y = YOUTH.makeYouth(this, selected);
        selected.youth.push(y);
      }
    }
    // Every career starts poor and underdeveloped: little money, level 1–2 facilities, ~3,000 seats.
    selected.prestige = Math.min(selected.prestige, 8 + this.rng.int(0, 8));
    selected.fanMood = 45;
    selected.boardTrust = 50;
    selected.finance.balance = this.rng.int(80_000, 350_000);
    selected.finance.sponsorship = this.rng.int(60_000, 120_000);
    selected.facilities = { training: this.rng.int(1, 2), youth: this.rng.int(1, 2), medical: 1, stadium: this.rng.int(2500, 3500) };
    FIN.syncBudgets(selected);
    this.manager.clubId = selected.id;
    this.manager.joinedSeason = this.season;
    this.manager.delegate = { contracts: false, bids: false };
    // Career identity and a shareable challenge code (same seed + start club = same world).
    const countryIdx = GameWorld.availableCountries().indexOf(country);
    const setupList = GameWorld.setupClubs()[country].clubs;
    const clubIdx = opts.mode === 'create' ? -1 : setupList.indexOf(selected.name);
    this.manager.careerId = `${this.seed}:${country}:${selected.id}`;
    this.manager.challengeCode = CH.encodeCode(this.seed, countryIdx, clubIdx >= 0 ? clubIdx : null);
    this.manager.startClub = selected.name;
  }

  static decodeChallenge(code) {
    const d = CH.decodeCode(code);
    if (!d) return null;
    const country = GameWorld.availableCountries()[d.countryIdx];
    if (!country) return null;
    const clubName = d.clubIdx == null ? null : GameWorld.setupClubs()[country].clubs[d.clubIdx];
    if (d.clubIdx != null && !clubName) return null;
    return { seed: d.seed, country, clubName };
  }

  // ── season lifecycle ────────────────────────────────────────────
  _startSeason() {
    this.currentWeek = 0;
    for (const p of this.players.values()) DEV.resetCondition(p);
    const deductions = {};
    for (const c of this.clubs) {
      if (c.finance.pendingDeduction) { deductions[c.id] = c.finance.pendingDeduction; c.finance.pendingDeduction = 0; }
    }
    for (const lg of this.leagues) lg.startSeason(deductions);
    this.totalWeeks = this.regularWeeks + 2; // 30 rounds + play-off semi-finals + play-off final
    for (const c of this.clubs) FIN.openPeriod(c, this.season, 1, this._detailed(c));
    this.continental = COMP.createContinentalSeason(this);
    this.cups = CUP.createCups(this);
    this.pendingBids = [];
    this.staffMarket = {};
    const me = this.club();
    me.badgeBonus = (this.manager.badge || 0) * 0.02;
    BOARD.setObjectives(this, me, this.league());
    this.jobOffers = (this.jobOffers || []).filter(o => o.kind === 'sacked');
    this.notify('season', `Season ${this.season}/${this.season + 1} begins in ${this.league().name}. Every player is fully fit and injury-free.`);
    if (deductions[me.id]) this.notify('board', `Administration: ${deductions[me.id]}-point deduction applied this season.`);
    const finalYear = CON.finalYearPlayers(me);
    if (finalYear.length) {
      this.notify('contract', `${finalYear.length} player${finalYear.length > 1 ? 's are' : ' is'} in the final contract year: ${finalYear.slice(0, 4).map(p => p.name).join(', ')}${finalYear.length > 4 ? ` +${finalYear.length - 4} more` : ''}. Renew them or they leave at season end.`, { playerIds: finalYear.map(p => p.id) });
    }
    const myComp = this.continental.find(c => c.entrants.includes(me.id));
    if (myComp) this.notify('continental', `You are in the ${myComp.name} group stage.`);
    this.notify('board', `🎯 Board objective: ${me.objective.text} (your squad ranks ${me.objective.strengthRank} of ${this.league().clubIds.length}).`);
    CH.startSeason(this);
    this._setNextChallenge();
    const myCup = this.cups.find(c => c.country === me.country);
    if (myCup) {
      const tie = myCup.rounds[0].ties.find(t => t.h === me.id || t.a === me.id);
      this.notify('cup', tie ? `🎟 ${myCup.name} Round 1 draw: ${this.clubById(tie.h).name} vs ${this.clubById(tie.a).name} (week ${myCup.rounds[0].week}).` : `🎟 ${myCup.name}: you have a bye to Round 2.`);
    }
    me.finance.sponsorAdvance = 0;
    if (me.sponsor && me.sponsor.years > 0) {
      const upfront = this._sponsorUpfront(me);
      this.notify('finance', `🤝 ${me.sponsor.name} paid this season's up-front sponsorship: $${Math.round(upfront / 1000)}K into your balance.`);
    }
    this._sponsorOffers();
    for (const p of [...me.squad, ...me.youth]) p.seasonStartAbility = Math.round(p.currentAbility);
    this.flags.level = CH.level(CH.score(this)).level;
  }

  _detailed(club) { return club.id === this.manager.clubId || club.id === this.manager.ownedClubId; }

  // The coming week's challenge is known before the week starts (shown on the dashboard).
  _setNextChallenge() {
    const week = this.currentWeek + 1;
    if (week > this.totalWeeks) return;
    const me = this.club();
    const mf = this._buildQueue(week).find(f => f.mine);
    if (!mf) { CH.setWeekly(this, week, null); return; }
    const lg = this.league();
    const oppId = mf.h === me.id ? mf.a : mf.h;
    CH.setWeekly(this, week, { away: !mf.neutral && mf.a === me.id, oppAbove: lg.clubIds.includes(oppId) && lg.positionOf(oppId) < lg.positionOf(me.id) });
  }

  // Floats are rounded at every week boundary (and at halftime) so the in-memory state is exactly
  // what a save stores: a save/load cycle never changes the simulation, and saves stay small.
  _quantize() {
    const q2 = v => Math.round(v * 100) / 100;
    for (const p of this.players.values()) {
      const a = p.attributes;
      for (const k in a) a[k] = q2(a[k]);
      p.morale = q2(p.morale);
      p.fitness = q2(p.fitness);
      p.recentMinutes = Math.round(p.recentMinutes || 0);
    }
  }

  // ── the week ────────────────────────────────────────────────────
  // beginWeek(): calendar + training, then builds the week's fixture queue in a fixed order
  // (league round or play-offs, cup ties, continental fixtures). advanceWeek() plays the queue; in
  // interactive mode each of the manager's matches pauses at half-time, in headless mode the same
  // code path runs straight through with no decisions, so both give identical results.
  get regularWeeks() { return Math.max(...this.leagues.map(l => l.schedule.length)); }

  beginWeek() {
    if (this.manager.status === 'sacked') throw new Error('You have been sacked. Accept one of your job offers to continue.');
    if (this.weekState) return { halftime: this.liveMatch ? this.halftimeView() : null };
    if (this.currentWeek >= this.totalWeeks) throw new Error('Season already complete');
    const week = this.currentWeek + 1;
    this.weekState = { week, events: [], reports: [], queue: [], done: 0 };
    const me = this.club();

    // 1. Calendar
    if (this.isWindowOpen(week - 1) && !this.isWindowOpen(week)) this.notify('window', 'The transfer window has closed.');
    if (!this.isWindowOpen(week - 1) && this.isWindowOpen(week)) this.notify('window', 'The transfer window is open.');
    if (this.isWindowOpen(week - 1) && !this.isWindowOpen(week + 1) && this.isWindowOpen(week)) this.notify('window', '⏰ Deadline day: the window shuts after this week. Late bids are flying in.');
    if (week === this.regularWeeks + 1) {
      for (const lg of this.leagues) {
        const po = lg.startPlayoff();
        if (po && lg.clubIds.includes(me.id)) {
          const tie = po.semis.find(t => t.h === me.id || t.a === me.id);
          this.notify('season', tie ? `Play-offs! Semi-final vs ${this.clubById(tie.h === me.id ? tie.a : tie.h).name}. Win twice and you go up.` : 'The play-offs begin this week.');
        }
      }
    }

    // 2. Training and recovery for every squad
    for (const c of this.clubs) {
      const evs = c.id === me.id ? [] : null;
      DEV.trainWeek(c, this.rng, evs);
      if (evs) for (const e of evs) {
        const p = this.players.get(e.playerId);
        if (e.type === 'knock') this.notify('injury', `🏥 ${p.name} picked up a training knock (${e.weeks} wk${e.weeks > 1 ? 's' : ''}).`);
        else if (e.type === 'recovered') this.notify('injury', `✅ ${p.name} is back in training.`);
      }
    }
    this.weekState.queue = this._buildQueue(week);
    this.weekState.upsets = [];
    this._quantize();
    return { halftime: null };
  }

  _buildQueue(week) {
    const q = [];
    for (const lg of this.leagues) {
      if (!lg.regularOver()) for (const [h, a] of lg.currentRound()) q.push({ kind: 'league', ref: lg.id, h, a });
      else for (const t of lg.playoffFixtures(week)) q.push({ kind: 'playoff', ref: lg.id, h: t.h, a: t.a, neutral: !!t.neutral, knockout: true, round: t.round });
    }
    for (const fx of CUP.fixturesForWeek(this, week)) q.push({ kind: 'cup', ref: fx.cup.id, h: fx.h, a: fx.a, neutral: !!fx.neutral, knockout: true, round: fx.round });
    for (const fx of COMP.fixturesForWeek(this, week)) q.push({ kind: fx.kind === 'group' ? 'cgroup' : 'cko', ref: fx.comp.id, group: fx.group ? fx.group.name : null, h: fx.h, a: fx.a, neutral: !!fx.neutral, knockout: !!fx.knockout });
    const me = this.manager.clubId;
    for (const f of q) f.mine = f.h === me || f.a === me;
    return q;
  }

  _fixtureMeta(f) {
    if (f.kind === 'league') return { comp: 'league', compName: this.leagueById(f.ref).name };
    if (f.kind === 'playoff') return { comp: 'playoff', compName: `${this.leagueById(f.ref).name} ${f.round}` };
    if (f.kind === 'cup') { const cup = this.cups.find(c => c.id === f.ref); return { comp: 'cup', compName: `${cup.name} · ${CUP.ROUND_NAMES[f.round]}` }; }
    const comp = this.continental.find(c => c.id === f.ref);
    const tie = f.kind === 'cko' ? comp.knockout.find(t => t.h === f.h && t.a === f.a && !t.result) : null;
    return { comp: comp.id, compName: `${comp.name}${f.group ? ` · Group ${f.group}` : tie ? ` · ${tie.round}` : ''}` };
  }

  _recordFixture(f, r, m) {
    const home = this.clubById(f.h), away = this.clubById(f.a);
    const attendance = f.neutral ? null : FIN.gateReceipts(home, away, this);
    if (f.kind === 'league') this.leagueById(f.ref).record(r);
    else if (f.kind === 'playoff') {
      const lg = this.leagueById(f.ref);
      const tie = [...lg.playoff.semis, lg.playoff.final].find(t => t && t.h === f.h && t.a === f.a && !t.result);
      lg.recordPlayoff(tie, r);
    } else if (f.kind === 'cup') {
      const cup = this.cups.find(c => c.id === f.ref);
      const tie = cup.rounds[cup.round].ties.find(t => t.h === f.h && t.a === f.a && !t.result);
      CUP.recordCup(this, { cup, tie, round: cup.round }, r);
      if (r.winner && this.weekState) {
        const w = this.clubById(r.winner), l = this.clubById(r.winner === f.h ? f.a : f.h);
        if (w.division >= l.division + 2) this.weekState.upsets.push({ cup: cup.name, winner: w.name, loser: l.name, winnerId: w.id, loserId: l.id, winnerDiv: w.division, loserDiv: l.division, score: `${r.hg}–${r.ag}${r.pens ? ` (${r.pens.home}–${r.pens.away} pens)` : ''}` });
      }
      if (r.winner === this.manager.clubId) {
        const opp = this.clubById(r.winner === f.h ? f.a : f.h);
        if (opp.division <= this.club().division - 2) AW.unlock(this, 'giant_killer');
      }
    } else {
      const comp = this.continental.find(c => c.id === f.ref);
      if (f.kind === 'cgroup') COMP.recordContinental(this, { comp, kind: 'group', group: comp.groups.find(g => g.name === f.group) }, r);
      else COMP.recordContinental(this, { comp, kind: 'ko', tie: comp.knockout.find(t => t.h === f.h && t.a === f.a && !t.result) }, r);
    }
    for (const id of [f.h, f.a]) {
      if (id === this.manager.clubId || id === this.manager.ownedClubId) AW.recordMatch(this, id, r, id === f.h ? attendance : null, m.compName);
    }
  }

  // Plays the queued fixtures. Returns { halftime } when paused, or { out } when the week is done.
  advanceWeek(decisions = {}, interactive = false) {
    if (!this.weekState) this.beginWeek();
    const ws = this.weekState;
    const mctx = this.matchCtx();
    const me = this.manager.clubId;
    if (this.liveMatch) {
      const { match: m, fixture } = this.liveMatch;
      const key = m.interactiveSide, oppKey = key === 'home' ? 'away' : 'home';
      const talk = decisions.talk ? DR.halftimeTalk(m[key], m[key].goals, m[oppKey].goals, decisions.talk) : null;
      const applied = ME.applyHalftime(m, key, decisions, mctx);
      applied.talk = talk;
      ME.playSecondHalf(m, mctx);
      const r = ME.finalizeMatch(m, mctx);
      this._recordFixture(fixture, r, m);
      ws.reports.push(this._matchReport(m, r, applied.subs || applied.tactic || applied.formation || talk ? applied : null));
      this.liveMatch = null;
      ws.done++;
    }
    while (ws.done < ws.queue.length) {
      const f = ws.queue[ws.done];
      const home = this.clubById(f.h), away = this.clubById(f.a);
      this._ensureMatchSquad(home); this._ensureMatchSquad(away);
      const meta = this._fixtureMeta(f);
      const opts = { id: `${f.kind}-${this.season}-${ws.week}-${f.h}-${f.a}`, comp: meta.comp, compName: meta.compName, week: ws.week, home, away,
        neutral: !!f.neutral, knockout: !!f.knockout, recordShots: !!f.mine, interactiveSide: f.mine ? (f.h === me ? 'home' : 'away') : null };
      if (f.mine) {
        const m = ME.createMatch(mctx, opts);
        this._reportSelection(m, opts.interactiveSide);
        ME.playFirstHalf(m, mctx);
        m.home.xg = Math.round(m.home.xg * 1e4) / 1e4;
        m.away.xg = Math.round(m.away.xg * 1e4) / 1e4;
        this._quantize();
        if (interactive) { this.liveMatch = { match: m, fixture: f }; return { halftime: this.halftimeView() }; }
        ME.playSecondHalf(m, mctx);
        const r = ME.finalizeMatch(m, mctx);
        this._recordFixture(f, r, m);
        ws.reports.push(this._matchReport(m, r, null));
      } else {
        const { match, result } = ME.playMatch(mctx, opts);
        this._recordFixture(f, result, match);
      }
      ws.done++;
    }
    return { out: this._closeWeek() };
  }

  // Compatibility helpers: a full week with no input.
  finishWeek(decisions = {}) { return this.advanceWeek(decisions, false).out; }
  stepWeek(decisions = {}) { this.beginWeek(); return this.advanceWeek(decisions, false).out; }

  stepSeason(decisions = {}) {
    this.applyDecisions(decisions);
    let out;
    do { out = this.stepWeek({}); } while (!out.seasonComplete && this.manager.status !== 'sacked');
    return out.endSummary || null;
  }

  _closeWeek() {
    const ws = this.weekState;
    const week = ws.week;
    const me = this.club();
    for (const lg of this.leagues) lg.advance();

    for (const comp of COMP.advanceContinental(this, week)) {
      const w = this.clubById(comp.winner);
      w.prestige = clamp(w.prestige + 5, 1, 99);
      for (const p of w.squad) p.history.trophies++;
      this.history.continentalWinners.push({ season: this.season, continent: comp.continent, comp: comp.name, club: w.name, clubId: w.id });
      if (w.id === me.id) { this.manager.trophies++; this.manager.reputation = clamp(this.manager.reputation + 8, 1, 99); this.notify('trophy', `🏆 ${comp.name} champions!`); AW.unlock(this, 'continental'); }
      else this.notify('news', `${w.name} won the ${comp.name}.`);
    }
    const cupNews = CUP.advanceCups(this);
    for (const cup of cupNews.draws) {
      const tie = cup.rounds[cup.round].ties.find(t => t.h === me.id || t.a === me.id);
      if (tie) this.notify('cup', `🎟 ${cup.name} draw — ${cup.rounds[cup.round].name}: ${this.clubById(tie.h).name} vs ${this.clubById(tie.a).name} (week ${cup.rounds[cup.round].week}).`);
    }
    for (const cup of cupNews.finished) {
      const w = this.clubById(cup.winner);
      w.prestige = clamp(w.prestige + 3, 1, 99);
      for (const p of w.squad) p.history.trophies++;
      this.history.cupWinners = this.history.cupWinners || [];
      this.history.cupWinners.push({ season: this.season, cup: cup.name, club: w.name, clubId: w.id, runnerUp: this.clubById(cup.runnerUp).name });
      if (w.id === me.id) { this.manager.trophies++; this.manager.reputation = clamp(this.manager.reputation + 5, 1, 99); this.notify('trophy', `🏆 ${cup.name} winners!`); AW.unlock(this, 'cup'); }
      else if (cup.country === me.country) this.notify('news', `${w.name} won the ${cup.name}.`);
    }

    // Board confidence
    const verdict = BOARD.weeklyConfidence(this, me, this.league());
    if (verdict === 'ultimatum') this.notify('board', '⚠️ Board ultimatum: results must improve quickly or you will be dismissed.');
    if (verdict === 'sacked') this._sack('The board has lost confidence in you.');
    const lgNow = this.league();
    if (week === 20 && lgNow.positionOf(me.id) === lgNow.clubIds.length) this.flags.bottomAtW20 = this.season;

    // AI market and bids while the window is open
    if (this.isWindowOpen(week - 1)) {
      TR.aiMarketRound(this, 0.25);
      for (const b of TR.generateIncomingBids(this, week)) {
        if (b.clause) { this.notify('bid', `🔓 ${this.clubById(b.clubId).name} triggered ${b.playerName}'s release clause ($${Math.round(b.fee / 1000)}K). He has gone.`); continue; }
        if (this.manager.delegate && this.manager.delegate.bids && this._autoBid(b)) continue;
        const p = this.players.get(b.playerId);
        this.notify('bid', `💰 ${this.clubById(b.clubId).name} bid $${Math.round(b.fee / 1000)}K for ${p.name}${b.unsolicited ? ' (not listed)' : ''}.`, { bidId: b.id });
      }
    } else if (this.pendingBids.length) this.pendingBids = [];

    // Sponsor: if no deal is signed by the end of week 2, the board signs the middle offer.
    if (week === 2 && this.sponsorOffers && this.sponsorOffers.length) this.acceptSponsor(1, true);
    // Coaching course
    const course = this.manager.course;
    if (course && --course.weeksLeft <= 0) {
      this.manager.badge = course.level;
      this.manager.course = null;
      me.badgeBonus = this.manager.badge * 0.02;
      this.notify('career', `🎓 You earned the ${BOARD.BADGES[this.manager.badge].name}. Training gains +${this.manager.badge * 2}%.`);
      if (this.manager.badge >= 4) AW.unlock(this, 'pro_licence');
    }

    // Scouting reports
    for (const rep of SCOUT.weekly(this)) this.notify('scout', `🔭 Scout report: ${rep.name} (${rep.position}, ${rep.age}) — ability ${rep.ovr}, potential ${rep.pot}. Verdict: ${rep.verdict}.`, { playerId: rep.playerId });
    // Dressing room
    for (const e of DR.weekly(this, me, ws.reports)) this.notify(e.type, e.text, { playerId: e.playerId });
    // Form: each of your players keeps his last five match ratings.
    for (const rep of ws.reports) if (rep.myKey && rep.ratings) for (const x of rep.ratings[rep.myKey]) {
      const p = this.players.get(x.playerId);
      if (p && p.clubId === me.id) p.ratings = [...(p.ratings || []), x.rating].slice(-5);
    }
    // Challenges and match XP (for the rewards screen after the match)
    const myReport = ws.reports.find(r => r.myKey);
    // XP for every match you played this week (league and cup), in the order they were played.
    const score0 = this.flags.lastScore ?? CH.score(this);
    const mine = ws.reports.filter(r => r.myKey && r.result);
    let mx = null;
    for (const rep of mine) {
      const x = CH.matchXp(this, rep);
      if (!x) continue;
      const tag = mine.length > 1 ? `${rep.compName}: ` : '';
      mx = { ...x, parts: [...(mx ? mx.parts : []), ...x.parts.map(([l, n]) => [tag + l, n])] };
    }
    const wkc = CH.settleWeekly(this, myReport);
    if (wkc && wkc.status === 'done') this.notify('challenge', `✅ Weekly challenge complete: ${wkc.text} (+${wkc.pts} pts, $${Math.round(wkc.cash / 1000)}K).`);
    const seasonDone = CH.weeklySeason(this, ws.reports);
    for (const c of seasonDone) this.notify('challenge', `🏁 Season challenge complete: ${c.text} (+${c.pts} pts, $${Math.round(c.cash / 1000)}K).`);
    let rewards = null;
    if (mx) {
      const parts = [...mx.parts];
      if (wkc) parts.push(wkc.status === 'done' ? [`✅ Challenge: ${wkc.text}`, wkc.pts] : [`❌ Challenge missed: ${wkc.text}`, 0]);
      for (const c of seasonDone) parts.push([`🏁 ${c.text}`, c.pts]);
      rewards = { parts, streak: mx.streak, unbeaten: mx.unbeaten, best: mx.best, cash: (wkc && wkc.status === 'done' ? wkc.cash : 0) + seasonDone.reduce((t, c) => t + (c.cash || 0), 0), score0 };
    }
    // International break
    const intl = INTL.weekly(this, week);
    if (intl) {
      NEWS.international(this, intl.played);
      if (intl.callups.length) this.notify('international', `🌍 International duty: ${intl.callups.map(c => `${c.name} (${c.country})`).join(', ')}.`);
      const job = this.intl.job;
      if (job) for (const g of intl.played.filter(x => x.h === job.country || x.a === job.country)) this.notify('international', `🌍 ${g.comp}: ${g.h} ${g.hg}–${g.ag} ${g.a}${g.pens ? ` (${g.pens.home}–${g.pens.away} pens)` : ''}.`);
      if (job && intl.champion === job.country) { this.manager.trophies++; this.manager.reputation = clamp(this.manager.reputation + 6, 1, 99); this.notify('trophy', `🏆 ${job.country} win the Nations League under you!`); }
    }
    // AI boards react to results; a board that loses faith sacks its manager.
    this._aiBoards(week);
    // The assistant renews key contracts when delegated.
    if (this.manager.delegate && this.manager.delegate.contracts && [8, 18, 28].includes(week)) this._autoRenew();
    // Newspaper
    if (myReport) NEWS.myMatch(this, myReport);
    NEWS.weekly(this, week, ws.upsets);

    // Finance: weekly postings for every club, then close the period
    const loanedOut = [...this.players.values()].filter(p => p.loan && !p.retired);
    for (const c of this.clubs) {
      const salary = FIN.weeklyPostings(c, { econ: this.econ, isManagerClub: c.id === me.id, loanedOut });
      if (salary) this.manager.wealth += salary;
      FIN.closePeriod(c);
    }
    if (me.finance.balance >= 10_000_000) AW.unlock(this, 'millionaire');

    this._weeklyNews();
    const lvl = CH.level(CH.score(this));
    if (lvl.level > (this.flags.level || 1)) this.notify('career', `⭐ Level up! You are now a level ${lvl.level} ${lvl.title}.`);
    this.flags.level = lvl.level;
    this.currentWeek = week;
    const reports = ws.reports;
    if (reports.length) this.lastMatch = reports[reports.length - 1];
    const out = { seasonComplete: false, week, totalWeeks: this.totalWeeks, events: ws.events, matchReport: reports[reports.length - 1] || null, reports };
    if (rewards) {
      const s1 = CH.score(this);
      const known = rewards.parts.reduce((t, [, n]) => t + n, 0), other = s1 - rewards.score0 - known;
      if (other) rewards.parts.push([other > 0 ? 'Reputation' : 'Reputation lost', other]);
      out.rewards = { ...rewards, xp: s1 - rewards.score0, before: CH.level(rewards.score0), after: lvl };
      delete out.rewards.score0;
    }
    this.flags.lastScore = CH.score(this);
    if (this.currentWeek >= this.totalWeeks) {
      out.endSummary = this._endSeason();
      out.seasonComplete = true;
    } else {
      for (const c of this.clubs) FIN.openPeriod(c, this.season, this.currentWeek + 1, this._detailed(c));
      this._setNextChallenge();
    }
    this.weekState = null;
    this._quantize();
    return out;
  }

  // ── career: sacking, jobs, badges ─────────────────────────────
  _sack(reason) {
    const club = this.club();
    this.manager.status = 'sacked';
    this.manager.sacks = (this.manager.sacks || 0) + 1;
    this.manager.reputation = clamp(this.manager.reputation - 8, 1, 99);
    this.history.sackings.push({ season: this.season, week: this.currentWeek, club: club.name });
    let offers = BOARD.jobOffers(this, 'sacked');
    if (!offers.length) offers = [this._fallbackOffer()];
    this.jobOffers = offers;
    this.notify('career', `❌ Sacked by ${club.name}. ${reason} ${offers.length} club${offers.length > 1 ? 's have' : ' has'} offered you a job.`);
  }

  _fallbackOffer() {
    const cur = this.manager.clubId;
    const weakest = this.clubs.filter(c => c.id !== cur && c.id !== this.manager.ownedClubId && c.division === 4).sort((a, b) => a.prestige - b.prestige || a.id - b.id)[0];
    return { clubId: weakest.id, kind: 'sacked', season: this.season, week: this.currentWeek };
  }

  acceptJob(clubId) {
    const offer = (this.jobOffers || []).find(o => o.clubId === clubId);
    if (!offer) return { ok: false, error: 'That offer is no longer open' };
    if (this.weekState) return { ok: false, error: 'Finish the current match week first' };
    const old = this.club();
    const c = this.clubById(clubId);
    old.manualXI = null; old.manualBench = null; old.badgeBonus = 0;
    this.manager.clubId = c.id;
    this.manager.joinedSeason = this.season + (this.currentWeek >= this.totalWeeks - 2 ? 1 : 0);
    this.manager.status = 'employed';
    this.jobOffers = [];
    this.pendingBids = [];
    this.sponsorOffers = null;
    this.negotiations = {};
    c.boardTrust = 55;
    for (const p of [...c.squad, ...c.youth]) p.seasonStartAbility = Math.round(p.currentAbility);
    c.badgeBonus = (this.manager.badge || 0) * 0.02;
    BOARD.setObjectives(this, c, this.leagueOf(c.id));
    if (c.finance.period) { c.finance.period.detailed = true; c.finance.period.entries = c.finance.period.entries || []; }
    this.history.jobs = this.history.jobs || [];
    this.history.jobs.push({ season: this.season, week: this.currentWeek, from: old.name, to: c.name, kind: offer.kind });
    this.notify('career', `✍️ You are the new manager of ${c.name} (${c.country}, division ${c.division}). Objective: ${c.objective.text}`);
    if (c.division === 1) AW.unlock(this, 'top_flight');
    return { ok: true, club: c.name };
  }

  declineJobs() {
    if (this.manager.status === 'sacked') return { ok: false, error: 'You need a job — accept one of the offers.' };
    this.jobOffers = [];
    return { ok: true };
  }

  applyForJob(clubId) {
    const v = BOARD.vacancies(this).find(x => x.clubId === clubId);
    if (!v) return { ok: false, error: 'That club is not looking for a manager' };
    if ((this.manager.badge || 0) < v.needsBadge) return { ok: false, error: `This job needs the ${BOARD.BADGES[v.needsBadge].name}` };
    if (v.chance < 50) return { ok: false, error: `${this.clubById(clubId).name} chose another candidate (your reputation is too low for them).` };
    this.jobOffers = (this.jobOffers || []).filter(o => o.clubId !== clubId).concat([{ clubId, kind: 'application', season: this.season, week: this.currentWeek }]);
    return { ok: true, club: this.clubById(clubId).name };
  }

  startCourse() {
    const level = (this.manager.badge || 0) + 1;
    if (this.manager.course) return { ok: false, error: 'You are already on a course' };
    if (level > 4) return { ok: false, error: 'You already hold the Pro Licence' };
    const b = BOARD.BADGES[level];
    if (this.manager.wealth < b.cost) return { ok: false, error: `The ${b.name} costs $${Math.round(b.cost / 1000)}K of your own money` };
    this.manager.wealth -= b.cost;
    this.manager.course = { level, weeksLeft: b.weeks };
    this.notify('career', `📚 You started the ${b.name} course (${b.weeks} weeks).`);
    return { ok: true, course: b.name };
  }

  // ── staff, sponsor, tickets, editor ───────────────────────────
  staffCandidates(role) {
    if (!STAFF.ROLES.includes(role)) return { ok: false, error: 'Unknown role' };
    return { ok: true, role, candidates: STAFF.candidates(this, role) };
  }

  hireStaff(role, index) {
    if (!STAFF.ROLES.includes(role)) return { ok: false, error: 'Unknown role' };
    const list = STAFF.candidates(this, role);
    const cand = list[index];
    if (!cand) return { ok: false, error: 'Candidate not found' };
    const club = this.club();
    const fee = cand.wage * 4;
    if (club.finance.balance < fee) return { ok: false, error: `Signing fee $${Math.round(fee / 1000)}K needed` };
    const old = club.staff && club.staff[role];
    if (old) FIN.post(club, 'Staff compensation', -old.wage * 4, `${old.name} (${STAFF.ROLE_LABEL[role]}) released`);
    FIN.post(club, 'Staff signing fee', -fee, `${cand.name} (${STAFF.ROLE_LABEL[role]})`);
    club.staff = club.staff || {};
    club.staff[role] = { ...cand };
    list.splice(index, 1);
    return { ok: true, name: cand.name, role: STAFF.ROLE_LABEL[role], rating: cand.rating };
  }

  fireStaff(role) {
    const club = this.club();
    const s = club.staff && club.staff[role];
    if (!s) return { ok: false, error: 'Nobody in that role' };
    FIN.post(club, 'Staff compensation', -s.wage * 4, `${s.name} (${STAFF.ROLE_LABEL[role]}) released`);
    club.staff[role] = null;
    return { ok: true, name: s.name };
  }

  acceptSponsor(index, auto = false) {
    const offer = (this.sponsorOffers || [])[index];
    if (!offer) return { ok: false, error: 'Offer not available' };
    const club = this.club();
    club.sponsor = { ...offer };
    club.finance.sponsorship = offer.perSeason;
    this.sponsorOffers = null;
    const upfront = this._sponsorUpfront(club);
    this.notify('finance', `${auto ? 'The board signed' : 'You signed'} ${offer.name} as shirt sponsor: $${Math.round(offer.perSeason / 1000)}K a season for ${offer.years} season${offer.years > 1 ? 's' : ''}. $${Math.round(upfront / 1000)}K was paid into your balance now; the rest arrives weekly.`);
    return { ok: true, sponsor: offer.name, upfront, balance: Math.round(club.finance.balance) };
  }

  // 30% of the season fee lands in the balance straight away (at signing, and at the start of each
  // later season of the deal); weekly instalments cover the other 70%.
  _sponsorUpfront(club) {
    const upfront = Math.round((club.finance.sponsorship || 0) * 0.3);
    club.finance.sponsorAdvance = upfront;
    if (upfront > 0) FIN.post(club, 'Sponsorship', upfront, `${club.sponsor.name}: up-front payment (30% of the season fee)`);
    return upfront;
  }

  _sponsorOffers() {
    const club = this.club();
    if (club.sponsor && club.sponsor.years > 0) { this.sponsorOffers = null; return; }
    const base = Math.max(40_000, club.finance.sponsorship || 60_000) * (1 + club.prestige / 200);
    const brands = ['Apex Logistics', 'Northwind Air', 'Bluefin Bank', 'Kora Telecom', 'Sunrise Foods', 'Vela Energy', 'Ironleaf Tools', 'Marlow Motors', 'Okapi Mobile', 'Harbourline Shipping', 'Tidewater Insurance', 'Brightpath Fintech'];
    const names = this.rng.shuffle(brands).slice(0, 3);
    this.sponsorOffers = [[1, 1.15, 0, 0], [2, 1.05, 0.2, 0.1], [3, 0.95, 0.35, 0.2]].map(([years, f, bp, bt], i) => {
      const perSeason = Math.round(base * f * this.rng.float(0.95, 1.05) / 1000) * 1000;
      return { name: names[i], years, perSeason, bonus: bp ? { promotion: Math.round(perSeason * bp / 1000) * 1000, trophy: Math.round(perSeason * bt / 1000) * 1000 } : null };
    });
    this.notify('finance', `🤝 Three sponsors want your shirt: ${this.sponsorOffers.map(o => `${o.name} ($${Math.round(o.perSeason / 1000)}K × ${o.years})`).join(', ')}. Choose in Finances before week 2.`);
  }

  setTicketPrice(mult) {
    const m = clamp(Math.round((Number(mult) || 1) * 20) / 20, 0.5, 2);
    this.club().ticketPrice = m;
    return { ok: true, ticketPrice: m };
  }

  rename(kind, id, name) {
    const clean = String(name || '').replace(/[<>]/g, '').trim().slice(0, 30);
    if (clean.length < 2) return { ok: false, error: 'Name must be at least 2 characters' };
    const target = kind === 'club' ? this.clubById(Number(id)) : kind === 'player' ? this.players.get(Number(id)) : null;
    if (!target) return { ok: false, error: 'Not found' };
    target.name = clean;
    return { ok: true, name: clean };
  }

  // A match never kicks off short: the assistant fills gaps from the academy, then free agents,
  // then an emergency signing. Each step is reported to the manager.
  _ensureMatchSquad(club) {
    let { total, keepers } = countAvailable(club);
    const isMe = club.id === this.manager.clubId;
    let guard = 0;
    while ((total < 11 || keepers < 1) && guard++ < 15) {
      const needGK = keepers < 1;
      const youth = club.youth.filter(p => isAvailable(p) && (!needGK || p.position === 'GK')).sort((a, b) => b.currentAbility - a.currentAbility)[0];
      if (youth) {
        club.youth = club.youth.filter(p => p.id !== youth.id);
        club.squad.push(youth);
        if (isMe) this.notify('squad', `Assistant: ${youth.name} called up from the academy to make up the numbers.`);
      } else {
        let fa = null;
        for (const p of this.players.values()) {
          if (p.retired || p.clubId != null || !isAvailable(p) || (needGK && p.position !== 'GK')) continue;
          if (!fa || p.currentAbility > fa.currentAbility) fa = p;
        }
        if (fa) {
          TR.executeTransfer(this, fa, null, club, 0, 'free');
          fa.contractYears = 1;
          if (isMe) this.notify('squad', `Assistant: emergency signing of free agent ${fa.name}.`);
        } else {
          const ab = Math.max(25, 50 - club.division * 6);
          const p = this.registerPlayer(new Player(this.ctx(), { age: this.rng.int(24, 32), nation: club.country, clubId: club.id, position: needGK ? 'GK' : this.rng.pick(POS_ALL), ability: [ab - 5, ab + 3] }));
          p.contractYears = 1;
          club.squad.push(p);
          if (isMe) this.notify('squad', `Assistant: emergency signing ${p.name} (${p.position}) on a one-year deal.`);
        }
      }
      ({ total, keepers } = countAvailable(club));
    }
  }

  _reportSelection(m, key) {
    for (const ch of m[key].selectionChanges || []) {
      const out = this.players.get(ch.outId);
      const inn = ch.inId ? this.players.get(ch.inId) : null;
      if (out && ['injured', 'unavailable', 'rested (condition)'].includes(ch.reason)) {
        this.notify('lineup', `Lineup: ${out.name} ${ch.reason === 'rested (condition)' ? 'rested for condition' : 'is ' + ch.reason}${inn ? `, ${inn.name} starts` : ''}.`);
      }
    }
  }

  _weeklyNews() {
    const rng = this.rng;
    const c = this.club();
    const active = c.squad.filter(p => !p.retired);
    if (rng.chance(0.1) && active.length) {
      const p = rng.pick(active);
      p.morale = clamp(p.morale + rng.int(5, 12), 0, 100);
      this.notify('morale', `💪 ${p.name} is in great spirits this week.`);
    }
    if (rng.chance(0.06)) {
      const star = active.slice().sort((a, b) => b.currentAbility - a.currentAbility)[0];
      if (star && star.currentAbility > 45) {
        star.wantsOut = rng.chance(0.3);
        this.notify('contract', `📋 ${star.name} wants a contract review. ${star.wantsOut ? 'He has asked to leave.' : 'He is looking for a wage rise.'}`);
      }
    }
    if (rng.chance(0.05)) {
      const y = c.youth.find(p => !p.retired && p.hiddenPotential >= 78);
      if (y) this.notify('youth', `⭐ Academy staff rave about ${y.name} (${y.age}). ${y.hint()}.`);
    }
  }

  _endSeason() {
    const me = this.club();
    const myLeague = this.league();
    for (const c of this.clubs) FIN.openPeriod(c, this.season, 'end', this._detailed(c));
    const finalTables = new Map(this.leagues.map(l => [l.id, l.sorted()]));
    const myTable = finalTables.get(myLeague.id);
    const myIdx = myTable.findIndex(r => r.clubId === me.id);
    const myZone = leagueZone(myLeague.level, myIdx, myTable.length, myLeague.level === Math.max(...this.leagues.filter(x => x.country === myLeague.country).map(x => x.level)));

    // Prize money, moods and prestige from the final tables
    for (const lg of this.leagues) {
      const rows = finalTables.get(lg.id);
      rows.forEach((row, i) => {
        const c = this.clubById(row.clubId);
        const pos = i + 1, size = rows.length;
        FIN.prizeMoney(c, pos, size, this);
        const topHalf = pos <= Math.ceil(size / 2);
        c.fanMood = clamp(c.fanMood + (pos <= 3 ? 8 : topHalf ? 2 : -6), 0, 100);
        c.prestige = clamp(c.prestige + (pos === 1 ? 4 : pos <= 3 ? 2 : topHalf ? 0 : -2), 1, 99);
        c.boardTrust = clamp(c.boardTrust + (topHalf ? 5 : -8) + (c.finance.balance < 0 ? -6 : 0), 0, 100);
        c.finance.sponsorship = Math.round(c.finance.sponsorship * (1 + (pos <= 3 ? 0.05 : pos > size - 3 ? -0.03 : 0.01)));
      });
    }

    // History — written once per season (root cause of the old double write: _record and _endSeason
    // both updated reputation; now only _recordSeason does).
    const summary = this._recordSeason(finalTables, myLeague, myIdx, myZone);
    const myRow = finalTables.get(myLeague.id)[myIdx];
    if (myRow && myRow.l === 0) AW.unlock(this, 'unbeaten');
    if (myIdx === 0) AW.unlock(this, 'title');
    const myAwards = AW.seasonAwards(this, finalTables);
    if (myAwards) { summary.awards = myAwards; this.notify('awards', `🏅 ${myLeague.name} awards — Player of the season: ${myAwards.playerOfSeason.name} (${myAwards.playerOfSeason.club}); Golden Boot: ${myAwards.goldenBoot.name} (${myAwards.goldenBoot.goals}).`); }

    const golden = AW.worldAwards(this, finalTables, this.history.continentalWinners.filter(x => x.season === this.season).map(x => x.clubId));
    if (golden) {
      summary.goldenBall = golden.winner;
      this.notify('awards', `🏆 Golden Ball ${this.season}: ${golden.winner.name} (${golden.winner.club}) — ${golden.winner.goals} goals, ${golden.winner.assists} assists. Golden Boot: ${golden.goldenBoot.name} (${golden.goldenBoot.goals}).`);
      NEWS.story(this, 'awards', `${golden.winner.name} wins the Golden Ball`, `${golden.winner.name} of ${golden.winner.club} is the world's player of the year, ahead of ${golden.top.slice(1, 3).map(x => x.name).join(' and ')}.`, [golden.winner.clubId]);
      if (golden.winner.clubId === me.id) this.notify('trophy', `🌟 Your player ${golden.winner.name} won the Golden Ball!`);
    }

    // Next season's continental places come from this season's top-division tables
    for (const pyr of this.pyramids) this.qualifiers[pyr.country] = finalTables.get(pyr.leagueIds[0]).map(r => r.clubId);

    const moves = promoteAndRelegate(this, finalTables);
    const myMove = moves.find(m => m.clubId === me.id);
    if (myMove) this.notify('season', myMove.type === 'promoted' ? `🎉 Promoted to division ${myMove.to}${myMove.via === 'play-offs' ? ' through the play-offs' : ''}!` : `Relegated to division ${myMove.to}.`);
    summary.promotion = !!(myMove && myMove.type === 'promoted');
    summary.relegation = !!(myMove && myMove.type === 'relegated');
    if (summary.promotion) { summary.outcome = myMove.via === 'play-offs' ? 'Promoted via the play-offs' : 'Promoted'; AW.unlock(this, 'promotion'); if (myMove.to === 1) AW.unlock(this, 'top_flight'); }
    if (!summary.relegation && this.flags.bottomAtW20 === this.season) AW.unlock(this, 'survivor');
    // Board verdict on the season.
    const seasonTrophies = (this.history.cupWinners || []).filter(w => w.season === this.season && w.clubId === me.id).length + this.history.continentalWinners.filter(w => w.season === this.season && w.clubId === me.id).length + (myIdx === 0 ? 1 : 0);
    // Shirt sponsor performance bonuses
    if (me.sponsor && me.sponsor.bonus) {
      const b = me.sponsor.bonus;
      let pay = 0;
      const why = [];
      if (summary.promotion && b.promotion) { pay += b.promotion; why.push('promotion'); }
      if (seasonTrophies && b.trophy) { pay += b.trophy * seasonTrophies; why.push(`${seasonTrophies} troph${seasonTrophies > 1 ? 'ies' : 'y'}`); }
      if (pay) { FIN.post(me, 'Sponsor bonus', pay, `${me.sponsor.name}: ${why.join(' + ')}`); this.notify('finance', `🤝 ${me.sponsor.name} paid a $${Math.round(pay / 1000)}K bonus for ${why.join(' and ')}.`); summary.sponsorBonus = pay; }
    }
    for (const c of CH.endSeason(this, myIdx + 1, myTable.length)) this.notify('challenge', `🏁 Season challenge complete: ${c.text} (+${c.pts} pts).`);
    summary.score = CH.score(this);
    // Champions and promotions in the paper
    for (const pyr of this.pyramids) {
      const top = finalTables.get(pyr.leagueIds[0]);
      const champ = this.clubById(top[0].clubId);
      NEWS.story(this, 'title', `${champ.name} are champions of ${this.leagueById(pyr.leagueIds[0]).name}`, `${champ.name} won the ${pyr.country} title with ${top[0].pts} points.`, [champ.id]);
    }
    // International: World Nations Cup (even seasons), national-team job verdicts and offers
    const intlEnd = INTL.seasonEnd(this);
    if (intlEnd.wnc) {
      NEWS.story(this, 'international', `${intlEnd.wnc.winner} win the World Nations Cup`, `${intlEnd.wnc.winner} beat ${intlEnd.wnc.runnerUp} in the final.`, [], 'world');
      this.notify('international', `🌍 ${intlEnd.wnc.winner} won the World Nations Cup (final vs ${intlEnd.wnc.runnerUp}).`);
    }
    for (const t of intlEnd.trophies) { this.manager.trophies++; this.manager.reputation = clamp(this.manager.reputation + (t === 'World Nations Cup' ? 10 : 0), 1, 99); this.notify('trophy', `🏆 Your national team won the ${t}!`); }
    if (intlEnd.jobEnded) this.notify('international', `🌍 ${intlEnd.jobEnded}`);
    for (const o of intlEnd.offers) this.notify('international', `🌍 ${o.country} (ranked ${o.rank}) want you as their national team manager — alongside your club job. See International.`);
    const verdict = BOARD.seasonReview(this, me, myIdx + 1, { promoted: summary.promotion, relegated: summary.relegation, trophies: seasonTrophies });
    summary.board = me.boardTrust;
    if (verdict === 'sacked') this._sack('The board was unhappy with the season.');
    else if ((summary.promotion || myIdx < 3) && this.manager.reputation > me.prestige) {
      const offers = BOARD.jobOffers(this, 'promotion');
      if (offers.length) { this.jobOffers = offers; this.notify('career', `📨 ${offers.length} bigger club${offers.length > 1 ? 's want' : ' wants'} you as manager: ${offers.map(o => this.clubById(o.clubId).name).join(', ')}. See Career.`); }
    }
    // Staff contracts run down; AI clubs replace departing staff, yours extend for a year.
    for (const c of this.clubs) {
      for (const role of STAFF.ROLES) {
        const st = c.staff && c.staff[role];
        if (!st) continue;
        st.years -= 1;
        if (st.years > 0) continue;
        if (c.id === me.id) { st.years = 1; this.notify('staff', `${st.name} (${STAFF.ROLE_LABEL[role]}) agreed a one-year extension.`); }
        else c.staff[role] = STAFF.makeStaff(this.rng, role, [13, 10, 8, 6][clamp(c.division, 1, 4) - 1] + this.rng.int(-2, 2));
      }
      if (c.sponsor) c.sponsor.years -= 1;
    }

    // Loans end. Your own players come home with a report on how they did.
    for (const p of this.players.values()) {
      if (p.loan && p.loan.parentClubId === this.manager.clubId && p.clubId !== this.manager.clubId && !p.retired) this.notify('squad', `↩️ ${p.name} returns from his loan at ${this.clubById(p.clubId)?.name || 'his club'}: ${this._loanLine(p)}.`, { playerId: p.id });
    }
    for (const p of this.players.values()) {
      if (!p.loan) continue;
      const parent = this.clubById(p.loan.parentClubId);
      const cur = this.clubById(p.clubId);
      if (cur) { cur.squad = cur.squad.filter(x => x.id !== p.id); cur.youth = cur.youth.filter(x => x.id !== p.id); }
      if (parent) { parent.squad.push(p); p.clubId = parent.id; }
      else p.clubId = null;
      p.loan = null;
    }

    // Contracts: renewals by AI, departures of unrenewed players
    const { left } = CON.settleContracts(this);
    if (left.length) this.notify('contract', `${left.length} player${left.length > 1 ? 's' : ''} left on expired contracts: ${left.slice(0, 5).join(', ')}${left.length > 5 ? '…' : ''}.`);

    // Ageing and retirement (no growth here)
    for (const p of this.players.values()) DEV.seasonAgeing(p, this.rng);
    for (const c of this.clubs) {
      const gone = c.squad.filter(p => p.retired);
      if (c.id === me.id && gone.length) this.notify('squad', `Retired: ${gone.map(p => p.name).join(', ')}.`);
      c.squad = c.squad.filter(p => !p.retired);
      c.youth = c.youth.filter(p => !p.retired);
    }

    // Academy
    for (const c of this.clubs) {
      const isMe = c.id === me.id;
      const made = YOUTH.intake(this, c, CFG);
      const promoted = YOUTH.promoteYouth(this, c, isMe);
      if (isMe) {
        if (made.length) this.notify('youth', `🎓 Youth intake: ${made.map(p => `${p.name} (${p.position}, ${p.age})`).join(', ')}.`);
        if (promoted.length) this.notify('youth', `Over-age academy players moved to the first-team squad: ${promoted.map(p => p.name).join(', ')}.`);
      }
    }
    YOUTH.generateWonderkids(this);
    // AI clubs keep academies and squads to a sensible size; the released players become free agents.
    for (const c of this.clubs) {
      if (c.id === me.id) continue;
      if (c.youth.length > 6) for (const p of c.youth.slice().sort((a, b) => a.hiddenPotential - b.hiddenPotential).slice(0, c.youth.length - 6)) TR.releasePlayer(this, c, p);
      if (c.squad.length > 26) for (const p of c.squad.slice().sort((a, b) => a.currentAbility - b.currentAbility).slice(0, c.squad.length - 26)) TR.releasePlayer(this, c, p);
    }

    // Debt rule — same for AI clubs and the manager
    for (const c of this.clubs) {
      const stage = FIN.debtReview(c);
      const isMe = c.id === me.id;
      if (stage === 'warning' && isMe) this.notify('board', '⚠️ Board warning: the club finished the season in debt. Two more seasons in debt and players will be sold.');
      if (stage === 'final' && isMe) this.notify('board', '⛔ Final warning: second season in debt. Transfer spending is frozen until the balance is positive.');
      if (stage === 'forced') {
        const sales = TR.forcedSales(this, c);
        if (isMe && sales.length) this.notify('board', `The board forced sales to clear debt: ${sales.map(s => `${s.player} → ${s.buyer} ($${Math.round(s.fee / 1000)}K)`).join(', ')}.`);
        if (c.finance.balance < 0 && !c.finance.administration) {
          c.finance.administration = true;
          c.finance.pendingDeduction = 10;
          if (isMe) this.notify('board', '🚨 The club entered administration: 10-point deduction next season and a transfer embargo.');
        }
      }
    }

    // Re-election: the bottom two of each lowest division drop into regional football and two new
    // regional champions take their places (your clubs always survive the vote).
    const regional = REGIONAL.reElection(this, finalTables, BANNED_NAMES);
    for (const r of regional) {
      if (!r.out.length) continue;
      NEWS.story(this, 'club', `${r.out.join(' and ')} drop out of ${r.league}`, `Re-election in ${r.country}: ${r.in.join(' and ')} come up from regional football.${r.spared ? ` ${r.spared} survived the vote.` : ''}`, [], r.country === me.country ? 'nation' : 'world');
      if (r.country === me.country) this.notify('news', `🗳 Re-election: ${r.out.join(' and ')} drop out of ${r.league}; ${r.in.join(' and ')} join.`);
      if (r.spared === me.name) this.notify('board', '⚖️ The club finished in the re-election places. It survived the vote — with a fine.');
    }
    this.jobOffers = (this.jobOffers || []).filter(o => this.clubById(o.clubId));
    if (this.manager.status === 'sacked' && !this.jobOffers.length) this.jobOffers = [this._fallbackOffer()];

    // AI investment and the summer transfer market
    for (const c of this.clubs) if (c.id !== me.id) FIN.aiInvest(c, this.rng);
    TR.aiMarketRound(this, 1);
    TR.enforceFreeAgentCap(this);
    for (const [id, p] of this.players) if (p.retired) this.players.delete(id);
    SCOUT.prune(this);
    for (const id of Object.keys(this.negotiations)) if (!this.players.has(Number(id))) delete this.negotiations[id];
    for (const c of this.clubs) this._ensureMatchSquad(c);

    for (const c of this.clubs) FIN.closePeriod(c);
    assertWorldInvariants(this);

    this._economy();
    this.completedSeasons++;
    this.season++;
    summary.nextLeague = this.league().name;
    summary.nextDivision = this.club().division;
    this._startSeason();
    return summary;
  }

  _recordSeason(finalTables, myLeague, myIdx, myZone) {
    const me = this.club();
    for (const lg of this.leagues) {
      const rows = finalTables.get(lg.id);
      const w = this.clubById(rows[0].clubId);
      this.history.leagueWinners.push({ season: this.season, league: `${lg.country} ${lg.name}`, club: w.name, clubId: w.id });
      for (const p of w.squad) p.history.trophies++;
      let top = null;
      for (const r of rows) for (const p of this.clubById(r.clubId).squad) if (!top || p.seasonStats.goals > top.seasonStats.goals) top = p;
      if (top && top.seasonStats.goals > 0) this.history.topScorers.push({ season: this.season, league: `${lg.country} ${lg.name}`, player: top.name, goals: top.seasonStats.goals });
    }
    const size = finalTables.get(myLeague.id).length;
    const pos = myIdx + 1;
    let rep = pos === 1 ? 8 : pos <= 3 ? 4 : pos <= Math.ceil(size / 2) ? 0 : -3;
    if (pos === 1) this.manager.trophies++;
    this.manager.reputation = clamp(this.manager.reputation + rep, 1, 99);
    const row = finalTables.get(myLeague.id)[myIdx] || { pts: 0, gf: 0, ga: 0 };
    const myComp = this.continental.find(c => c.entrants.includes(me.id));
    const summary = {
      season: this.season, seasonLabel: `${this.season}/${this.season + 1}`,
      club: me.name, country: me.country, division: me.division, league: myLeague.name,
      position: pos, points: row.pts, gd: row.gf - row.ga,
      finances: Math.round(me.finance.balance), debt: Math.round(Math.max(0, -me.finance.balance)),
      fans: me.fanMood, board: me.boardTrust, reputation: this.manager.reputation,
      continentalChampion: !!(myComp && myComp.winner === me.id), continental: myComp ? myComp.name : null,
      trophies: this.manager.trophies, outcome: zoneLabel(myZone) || 'Season complete',
      promotion: myZone === 'promotion', relegation: myZone === 'relegation',
      continentalQualification: myLeague.level === 1 && pos <= 4,
    };
    this.managerHistory.push(summary);
    return summary;
  }

  _economy() {
    const r = this.rng.next();
    this.econ = r < 0.12 ? 1.1 : r < 0.25 ? 0.92 : 1;
  }

  // ── manager actions ─────────────────────────────────────────────
  applyDecisions(d = {}) {
    const c = this.club();
    if (d.tactic && TACTICS.includes(d.tactic)) c.tactic = d.tactic;
    if (d.formation && FORMATIONS.includes(d.formation) && d.formation !== c.formation) {
      c.formation = d.formation;
      const keys = new Set(buildSlotMap(c.formation).map(s => s.slotKey));
      if (c.manualXI) c.manualXI = c.manualXI.filter(m => keys.has(m.slotKey));
      if (c.manualXI && !c.manualXI.length) c.manualXI = null;
      c.lastXI = null;
    }
    if (d.trainingFocus && TRAINING_FOCUS.includes(d.trainingFocus)) c.trainingFocus = d.trainingFocus;
    if (d.trainingIntensity !== undefined && d.trainingIntensity !== null) c.trainingIntensity = clamp(parseInt(d.trainingIntensity, 10) || 3, 1, 5);
    return { ok: true };
  }

  setManualLineup(slots = [], bench = null) {
    const c = this.club();
    const valid = new Set(buildSlotMap(c.formation).map(s => s.slotKey));
    const ids = new Set(c.squad.filter(p => !p.retired).map(p => p.id));
    const used = new Set();
    const manual = [];
    for (const s of slots) {
      const pid = parseInt(s.playerId, 10);
      if (!valid.has(s.slotKey) || !ids.has(pid) || used.has(pid)) continue;
      used.add(pid);
      manual.push({ slotKey: s.slotKey, playerId: pid });
    }
    c.manualXI = manual.length ? manual : null;
    if (Array.isArray(bench)) {
      const b = [...new Set(bench.map(x => parseInt(x, 10)))].filter(id => ids.has(id) && !used.has(id)).slice(0, 7);
      c.manualBench = b.length ? b : null;
    }
    return { ok: true, manualCount: manual.length };
  }

  clearManualLineup() {
    const c = this.club();
    c.manualXI = null;
    c.manualBench = null;
    return { ok: true };
  }

  renew(playerId, years) {
    const c = this.club();
    const p = [...c.squad, ...c.youth].find(x => x.id === playerId && !x.retired);
    if (!p) return { ok: false, error: 'Player not found' };
    return CON.renewContract(c, p, years);
  }

  renewalTerms(playerId, years) {
    const c = this.club();
    const p = [...c.squad, ...c.youth].find(x => x.id === playerId && !x.retired);
    if (!p) return { ok: false, error: 'Player not found' };
    return { ok: true, terms: CON.renewalTerms(p, years) };
  }

  _windowGuard() {
    if (!this.isWindowOpen()) return { ok: false, error: `Transfer window closed. ${this.transferWindow().label}` };
    if (FIN.spendingFrozen(this.club())) return { ok: false, error: 'The board has frozen transfer spending until the club is out of debt.' };
    return null;
  }

  // terms (optional): personal terms for the player's agent { wage, bonus, agentFee, years, role,
  // releaseClause }. Without terms the player signs on standard terms (no agent involved).
  buyPlayer(playerId, fromClubId, fee, terms = null) {
    const me = this.club();
    const p = this.players.get(playerId);
    if (!p || p.retired) return { ok: false, error: 'Player not found' };
    if (terms && (p.talksBlockedUntil || 0) > this._absWeek()) return { ok: false, error: `${p.name}'s agent will not talk to you for a few weeks` };
    if (!fromClubId || p.clubId == null) {
      if (p.clubId != null) return { ok: false, error: 'Player is not a free agent' };
      if (FIN.spendingFrozen(me)) return { ok: false, error: 'The board has frozen spending until the club is out of debt.' };
      if (terms) return this._talks(p, 'sign', terms, 0, () => { TR.executeTransfer(this, p, null, me, 0, 'free'); return { from: 'Free agent' }; });
      const cost = Math.round(p.weeklyWage * 10 + p.currentAbility * 2000);
      if (me.finance.balance < cost) return { ok: false, error: `Signing bonus needs $${Math.round(cost / 1000)}K` };
      FIN.post(me, 'Signing bonus', -cost, `${p.name} (free agent)`);
      TR.executeTransfer(this, p, null, me, 0, 'free');
      return { ok: true, player: p.name, signingCost: cost };
    }
    const guard = this._windowGuard();
    if (guard) return guard;
    const from = this.clubById(fromClubId);
    if (!from || !from.squad.includes(p)) return { ok: false, error: 'Player not in that squad' };
    if (from.id === me.id) return { ok: false, error: 'He is already yours' };
    const profile = this._offerProfile(p, from, me);
    fee = Math.round(fee || 0);
    if (fee > me.finance.balance) return { ok: false, error: 'Insufficient balance' };
    const sign = () => {
      if (!terms) { const res = TR.executeTransfer(this, p, from, me, fee, 'transfer'); return { ...res, acceptedFee: fee, action: 'accepted', profile }; }
      return this._talks(p, 'sign', terms, fee, () => ({ ...TR.executeTransfer(this, p, from, me, fee, 'transfer'), acceptedFee: fee, profile }));
    };
    if (fee >= profile.askFee || fee >= profile.minFee * 1.08) return sign();
    if (fee < profile.minFee) return { ok: false, error: 'Bid rejected', action: 'rejected', minFee: profile.minFee, askFee: profile.askFee, profile };
    const counterFee = Math.min(profile.maxAffordable, Math.max(profile.minFee, Math.round((profile.askFee + fee) / 2 / 1000) * 1000));
    if (counterFee <= fee) return sign();
    return { ok: false, error: 'Counter offer received', action: 'counter', counterFee, askFee: profile.askFee, minFee: profile.minFee, profile };
  }

  // ── agents and personal terms ───────────────────────────────────
  _absWeek() { return this.season * 100 + this.currentWeek; }
  _negState(p, kind) {
    const n = this.negotiations[p.id];
    if (n && n.kind === kind && n.season === this.season) return n;
    return { kind, season: this.season, round: 0, demand: NEG.demands(this, p, kind, this.club()) };
  }

  negotiationTerms(playerId) {
    const me = this.club();
    const p = this.players.get(playerId);
    if (!p || p.retired) return { ok: false, error: 'Player not found' };
    const own = me.squad.includes(p) || me.youth.includes(p);
    const kind = own ? 'renew' : 'sign';
    const st = this._negState(p, kind);
    const from = !own && p.clubId != null ? this.clubById(p.clubId) : null;
    return { ok: true, kind, player: p.name, playerId: p.id, demand: st.demand, round: st.round, patience: st.demand.agent.patience,
      blocked: (p.talksBlockedUntil || 0) > this._absWeek(), roles: NEG.ROLES.map(r => ({ id: r, label: NEG.ROLE_LABEL[r] })),
      currentWage: p.weeklyWage, contractYears: p.contractYears, fromClubId: from ? from.id : null, fromClub: from ? from.name : null,
      askFee: from ? this._offerProfile(p, from, me).askFee : 0, wageHeadroom: this._budgetView(me, this.league()).wageHeadroom };
  }

  negotiate(playerId, body = {}) {
    const me = this.club();
    const p = this.players.get(playerId);
    if (!p || p.retired) return { ok: false, error: 'Player not found' };
    if ((p.talksBlockedUntil || 0) > this._absWeek()) return { ok: false, error: `${p.name}'s agent will not talk to you for a few weeks` };
    const own = me.squad.includes(p) || me.youth.includes(p);
    if (!own) return this.buyPlayer(playerId, p.clubId, body.fee || 0, body);
    if (p.loan) return { ok: false, error: 'He is on loan here' };
    return this._talks(p, 'renew', body, 0, () => ({}));
  }

  _talks(p, kind, body, fee, onAccept) {
    const me = this.club();
    const st = this._negState(p, kind);
    const offer = NEG.cleanOffer(body, st.demand);
    const res = NEG.respond(offer, st);
    if (res.result === 'accept') {
      if (me.finance.balance < offer.bonus + offer.agentFee + fee) return { ok: false, error: `You need $${Math.round((offer.bonus + offer.agentFee + fee) / 1000)}K for the fee, bonus and agent` };
      delete this.negotiations[p.id];
      const out = onAccept(offer) || {};
      if (out.ok === false) return out;
      this._applyTerms(me, p, offer, kind);
      return { ...out, ok: true, action: 'accepted', player: p.name, terms: offer };
    }
    if (res.result === 'counter') {
      this.negotiations[p.id] = { ...st, round: st.round + 1, demand: res.demand };
      return { ok: false, action: 'counter', error: `${st.demand.agent.name}: "We can meet you part of the way."`, demand: res.demand, round: st.round + 1, patience: st.demand.agent.patience };
    }
    delete this.negotiations[p.id];
    p.talksBlockedUntil = this._absWeek() + 4;
    if (kind === 'renew') p.morale = clamp(p.morale - 5, 10, 100);
    return { ok: false, action: 'walked', error: `${st.demand.agent.name} walked out. ${p.name} will not talk to you for four weeks.` };
  }

  _applyTerms(club, p, o, kind) {
    if (o.bonus) FIN.post(club, 'Signing bonus', -o.bonus, `${p.name} (${kind === 'renew' ? 'new contract' : 'signing'})`);
    if (o.agentFee) FIN.post(club, 'Agent fees', -o.agentFee, `${NEG.agentOf(p).name} for ${p.name}`);
    p.weeklyWage = o.wage;
    p.contractYears = Math.min(5, Math.max(kind === 'renew' ? p.contractYears : 0, o.years));
    p.releaseClause = o.releaseClause || null;
    const expected = NEG.expectedRole(p, club);
    p.promise = NEG.ROLES.indexOf(o.role) < NEG.ROLES.indexOf(expected) ? { role: o.role, season: this.season, week: this.currentWeek, broken: false } : null;
    p.playLog = [];
    if (kind === 'renew') { p.wantsOut = false; p.unhappyWeeks = 0; p.morale = clamp(p.morale + 6, 10, 100); }
  }

  // Delegation: the assistant renews key players in their final year on the agent's terms.
  _autoRenew() {
    const me = this.club();
    const key = new Set(me.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility).slice(0, 16).map(p => p.id));
    const done = [];
    for (const p of CON.finalYearPlayers(me)) {
      if (!key.has(p.id) || p.loan) continue;
      const d = NEG.demands(this, p, 'renew', me);
      if (me.finance.balance < (d.bonus + d.agentFee) * 2) continue;
      this._applyTerms(me, p, { wage: d.wage, bonus: d.bonus, agentFee: d.agentFee, years: d.years, role: d.role, releaseClause: 0 }, 'renew');
      done.push(p.name);
    }
    if (done.length) this.notify('contract', `🤝 Your assistant renewed ${done.join(', ')} on their agents' terms.`);
  }

  // Delegation: key players are not for sale; listed players go when the price is right.
  _autoBid(b) {
    const me = this.club();
    const p = this.players.get(b.playerId);
    const buyer = this.clubById(b.clubId).name;
    const top = new Set(me.squad.filter(x => !x.retired).sort((a, c) => c.currentAbility - a.currentAbility).slice(0, 11).map(x => x.id));
    if (top.has(p.id) && b.fee < b.value * 1.5) {
      this.pendingBids = this.pendingBids.filter(x => x.id !== b.id);
      this.notify('bid', `🛡 Your assistant turned down ${buyer}'s $${Math.round(b.fee / 1000)}K bid for ${p.name} (key player).`);
      return true;
    }
    if (p.listedForSale && b.fee >= b.value) {
      const r = TR.acceptBid(this, b.id);
      if (r.ok) { this.notify('bid', `💰 Your assistant sold ${p.name} to ${r.to} for $${Math.round(r.fee / 1000)}K.`); return true; }
    }
    return false;
  }

  setDelegate(d = {}) {
    const cur = this.manager.delegate || { contracts: false, bids: false };
    delete cur.press;
    for (const k of ['contracts', 'bids']) if (typeof d[k] === 'boolean') cur[k] = d[k];
    this.manager.delegate = cur;
    return { ok: true, delegate: cur };
  }

  // ── scouting ────────────────────────────────────────────────────
  scoutPlayer(playerId) { return SCOUT.assign(this, this.players.get(playerId)); }
  cancelScouting(playerId) { return SCOUT.cancel(this, playerId); }

  playerDetail(id) {
    const p = this.players.get(id);
    if (!p) return { ok: false, status: 404, error: 'Player not found' };
    const me = this.club();
    const own = me.squad.includes(p) || me.youth.includes(p);
    const club = p.clubId != null ? this.clubById(p.clubId) : null;
    const row = SCOUT.fogRow(this, p, this._playerRow(p, { club: club ? club.name : 'Free agent', fromClub: club ? club.name : 'Free Agent', fromClubId: club ? club.id : null }), me);
    const agent = NEG.agentOf(p);
    const sc = (this.scouting.assignments || []).find(a => a.playerId === p.id);
    return { ok: true, player: row, own, agent: { name: agent.name, style: agent.style }, scouting: sc ? { weeksLeft: SCOUT.weeksToReport(this, p, me) } : null,
      blocked: (p.talksBlockedUntil || 0) > this._absWeek(), caps: p.history.caps || 0, intlGoals: p.history.intlGoals || 0,
      askFee: club && !own ? this._offerProfile(p, club, me).askFee : null, releaseClause: p.releaseClause || null, promise: p.promise || null };
  }

  // ── dressing room ───────────────────────────────────────────────
  playerTalk(playerId, kind) {
    const me = this.club();
    const p = me.squad.find(x => x.id === playerId && !x.retired);
    if (!p) return { ok: false, error: 'Player not in your squad' };
    return DR.talk(this, me, p, kind);
  }
  teamTalk(kind) { return DR.teamTalk(this, this.club(), kind); }

  // ── international ───────────────────────────────────────────────
  acceptNationalJob(country) {
    const r = INTL.acceptJob(this, country);
    if (r.ok) { this.notify('international', `🌍 You are the new manager of ${country}. Pick your squad in International (or let the federation pick the best 23).`); NEWS.story(this, 'international', `${country} appoint ${this.manager.name === 'You' ? `the ${this.club().name} manager` : this.manager.name}`, `${country} have a new national team manager, who keeps the club job too.`, [], 'world'); }
    return r;
  }
  leaveNationalJob() { return INTL.leaveJob(this); }
  setNationalSquad(ids) { return INTL.setSquad(this, ids); }

  // ── news, leaderboard ───────────────────────────────────────────
  newsFeed(filter) { return NEWS.feed(this, filter); }
  onTransfer(p, from, to, fee) { NEWS.transfer(this, p, from, to, fee); }
  leaderboardEntry() {
    const c = this.club();
    return { careerId: this.manager.careerId || `${this.seed}:${c.country}`, code: this.manager.challengeCode || null, manager: this.manager.name, club: c.name,
      country: c.country, division: c.division, season: `${this.season}/${this.season + 1}`, seasons: this.completedSeasons, trophies: this.manager.trophies,
      reputation: this.manager.reputation, score: CH.score(this), seed: this.seed };
  }

  // AI boards react to results; a board that loses faith sacks its manager (news + Job Centre vacancy).
  _aiBoards(week) {
    const skip = new Set([this.manager.clubId, this.manager.ownedClubId]);
    for (const lg of this.leagues) {
      for (const r of lg.results.slice(-8)) {
        if (r.week !== week) continue;
        for (const [id, gf, ga] of [[r.h, r.hg, r.ag], [r.a, r.ag, r.hg]]) {
          if (skip.has(id)) continue;
          const c = this.clubById(id);
          c.boardTrust = clamp(Math.round((c.boardTrust + (gf > ga ? 0.8 : gf < ga ? -1.1 : 0)) * 10) / 10, 0, 100);
          if (week >= 6 && c.boardTrust < 22 && c.sackedSeason !== this.season) {
            const old = c.managerName || this._aiManagerName(c, 0);
            c.sackedSeason = this.season;
            c.boardTrust = 50;
            c.managerName = this._aiManagerName(c, 1);
            NEWS.sacking(this, c, old);
          }
        }
      }
    }
  }
  _aiManagerName(c, n) { const h = hashString(`mgr:${c.id}:${this.season}:${n}`); return `${STAFF.FIRST[h % STAFF.FIRST.length]} ${STAFF.LAST[(h >>> 8) % STAFF.LAST.length]}`; }

  // Season budget: projected income (TV, shirt sponsor, merchandise, gates, prize money) and costs
  // for the rest of the season; the board's transfer and wage budgets come from it.
  _budgetView(c, lg) {
    const d = clamp(c.division, 1, 4) - 1, econ = this.econ || 1, W = FIN.WEEKS;
    const weeksLeft = Math.max(0, this.totalWeeks - this.currentWeek);
    const homeLeft = lg.schedule.slice(lg.weekIdx).reduce((n, round) => n + round.filter(([h]) => h === c.id).length, 0);
    const homeTotal = lg.schedule.reduce((n, round) => n + round.filter(([h]) => h === c.id).length, 0);
    const gate = FIN.gateEstimate(c, { econ });
    const merchSeason = c.prestige * 12_000 * econ * clamp(c.fanMood / 60, 0.5, 1.5);
    const pos = Math.max(1, lg.positionOf(c.id));
    const season = {
      tv: FIN.TV_PER_SEASON[d] * econ, sponsor: (c.finance.sponsorship || 0) * econ, merchandise: merchSeason, gates: gate * homeTotal,
      prize: (lg.clubIds.length - pos + 1) * FIN.PRIZE_PER_PLACE[d] * econ,
    };
    const frac = weeksLeft / W;
    const income = { tv: season.tv * frac, sponsor: Math.max(0, (c.finance.sponsorship || 0) - (c.finance.sponsorAdvance || 0)) * econ * frac, merchandise: merchSeason * frac, gates: gate * homeLeft, prize: season.prize };
    const wages = FIN.weeklyWageBill(c), staff = STAFF.weeklyStaffWages(c);
    const fixedWeek = staff + FIN.BACKROOM_PER_SEASON[d] / W + FIN.upkeepPerSeason(c) / W + FIN.MANAGER_SALARY_WEEK[d];
    const costs = { wages: wages * weeksLeft, staff: staff * weeksLeft, backroom: FIN.BACKROOM_PER_SEASON[d] * frac, upkeep: FIN.upkeepPerSeason(c) * frac, salary: FIN.MANAGER_SALARY_WEEK[d] * weeksLeft };
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const r = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    const balance = c.finance.balance;
    const projected = balance + sum(income) - sum(costs);
    const frozen = FIN.spendingFrozen(c);
    const transferBudget = frozen ? 0 : Math.max(0, Math.round(Math.min(balance, projected) * 0.85 / 1000) * 1000);
    const weeklyIncome = (season.tv + season.sponsor + merchSeason + season.gates) / W;
    const wageBudget = Math.round(Math.max(wages, (weeklyIncome - fixedWeek) * 0.9) / 10) * 10;
    const seasonTotal = sum(season);
    return {
      weeksLeft, homeLeft, balance: Math.round(balance), projected: Math.round(projected), income: r(income), costs: r(costs), season: r(season),
      seasonIncome: Math.round(seasonTotal), transferBudget, wageBudget, wages, wageHeadroom: Math.max(0, wageBudget - wages), frozen,
      sponsor: c.sponsor ? { name: c.sponsor.name, perSeason: c.sponsor.perSeason, yearsLeft: c.sponsor.years, bonus: c.sponsor.bonus || null, share: seasonTotal ? Math.round(season.sponsor / seasonTotal * 100) : 0 }
        : { name: null, perSeason: Math.round(c.finance.sponsorship || 0), yearsLeft: 0, bonus: null, share: seasonTotal ? Math.round(season.sponsor / seasonTotal * 100) : 0 },
    };
  }

  // One-click decisions for the dashboard action centre.
  _decisions(c, budget) {
    const out = [];
    if (this.manager.status === 'sacked') out.push({ type: 'sacked', text: 'You were sacked — choose your next club' });
    if (this.liveMatch) out.push({ type: 'halftime', text: 'Your match is paused at half-time' });
    for (const b of this.pendingBids) out.push({ type: 'bid', id: b.id, text: `${this.clubById(b.clubId)?.name} bid $${Math.round(b.fee / 1000)}K for ${this.players.get(b.playerId)?.name}` });
    const key = new Set(c.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility).slice(0, 16).map(p => p.id));
    for (const p of CON.finalYearPlayers(c).filter(x => key.has(x.id)).slice(0, 4)) {
      const d = NEG.demands(this, p, 'renew', c);
      out.push({ type: 'contract', playerId: p.id, text: `${p.name} (${p.currentAbility}) is in his final year`, wage: d.wage, cost: d.bonus + d.agentFee, blocked: (p.talksBlockedUntil || 0) > this._absWeek() });
    }
    for (const p of c.squad.filter(x => !x.retired && (x.wantsOut || x.morale < 38)).sort((a, b) => a.morale - b.morale).slice(0, 3)) {
      out.push({ type: 'unhappy', playerId: p.id, text: `${p.name} is ${p.wantsOut ? 'asking to leave' : 'unhappy'}${p.unhappy ? ` (${p.unhappy[0]})` : ''}`, wantsOut: !!p.wantsOut, talked: p.talkWeek === `${this.season}-${this.currentWeek}` });
    }
    if (this.sponsorOffers && this.sponsorOffers.length) out.push({ type: 'sponsor', text: 'Choose your shirt sponsor' });
    if ((this.jobOffers || []).length && this.manager.status !== 'sacked') out.push({ type: 'job', text: `${this.jobOffers.length} job offer${this.jobOffers.length > 1 ? 's' : ''}` });
    if (this.intl && this.intl.offers.length) out.push({ type: 'national', country: this.intl.offers[0].country, text: `${this.intl.offers[0].country} offer you their national team` });
    for (const r of (this.scouting.reports || []).filter(x => x.season === this.season && x.week >= this.currentWeek - 1).slice(0, 2)) out.push({ type: 'scout', playerId: r.playerId, text: `Scout report: ${r.name} — ${r.verdict}` });
    for (const role of STAFF.ROLES) if (!c.staff || !c.staff[role]) out.push({ type: 'staff', role, text: `No ${STAFF.ROLE_LABEL[role].toLowerCase()}` });
    const bad = (c.manualXI || []).map(m => this.players.get(m.playerId)).filter(p => p && !isAvailable(p));
    if (bad.length) out.push({ type: 'lineup', text: `${bad.map(p => p.name).join(', ')} ${bad.length > 1 ? 'are' : 'is'} in your XI but unavailable` });
    if (budget.wages > budget.wageBudget * 1.1) out.push({ type: 'wages', text: `Wage bill $${Math.round(budget.wages / 1000)}K/wk is over the $${Math.round(budget.wageBudget / 1000)}K budget` });
    return out;
  }

  _offerProfile(p, seller, buyer) {
    const base = TR.playerValue(p, this.econ);
    const contract = p.contractYears <= 0 ? 0.72 : p.contractYears === 1 ? 0.86 : p.contractYears >= 4 ? 1.12 : 1;
    const urgency = p.wantsOut ? 0.88 : seller.finance.balance < 0 ? 0.9 : 1;
    const need = TR.posNeed(seller, p.position) >= 2 ? 1.08 : 0.98;
    const askFee = Math.round(base * contract * need * (buyer.prestige > seller.prestige ? 1.04 : 1));
    const minFee = Math.round(base * urgency * Math.max(0.76, contract * 0.9));
    return { baseValue: base, askFee, minFee, maxAffordable: Math.max(0, Math.round(buyer.finance.balance * 0.92)),
      loanFee: Math.round(Math.max(20_000, base * (p.age <= 21 ? 0.05 : 0.08))), wageContribution: Math.round(p.weeklyWage * (p.currentAbility >= 70 ? 0.65 : 0.45)) };
  }

  loanIn(playerId, fromClubId, loanFee, wageContribution) {
    const guard = this._windowGuard();
    if (guard) return guard;
    const me = this.club();
    const from = this.clubById(fromClubId);
    const p = this.players.get(playerId);
    if (!from || !p || !from.squad.includes(p)) return { ok: false, error: 'Player not in that squad' };
    if (p.loan) return { ok: false, error: 'Player already out on loan' };
    const profile = this._offerProfile(p, from, me);
    const fee = Math.max(profile.loanFee, Math.round(loanFee || 0));
    const wage = Math.min(p.weeklyWage, Math.max(profile.wageContribution, Math.round(wageContribution || 0)));
    if (me.finance.balance < fee) return { ok: false, error: 'Insufficient balance' };
    FIN.post(me, 'Loan fees', -fee, `${p.name} on loan from ${from.name}`);
    FIN.post(from, 'Loan fees', fee, `${p.name} loaned to ${me.name}`);
    from.squad = from.squad.filter(x => x.id !== p.id);
    me.squad.push(p);
    p.clubId = me.id;
    p.loan = { parentClubId: from.id, fee, wageContribution: wage, startSeason: this.season, endSeason: this.season + 1 };
    return { ok: true, player: p.name, loanFee: fee, wageContribution: wage, action: 'loaned' };
  }

  // ── loaning your own players out ──────────────────────────────────
  // Interested clubs are sides no stronger than yours where he would get games. The terms depend
  // only on the player and the club (no RNG), so the list is stable while you think it over:
  // a loan fee (paid by richer clubs for better players) and the share of his wages they cover.
  _loanRole(p, club) {
    const mine = positionAbility(p, p.position);
    const rivals = club.squad.filter(x => !x.retired && x.id !== p.id && x.position === p.position && positionAbility(x, p.position) >= mine).length;
    const need = { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 1, CM: 2, CAM: 1, LW: 1, RW: 1, ST: 2, CF: 1 }[p.position] || 1;
    return rivals < need ? 'starter' : rivals < need + 2 ? 'rotation' : 'backup';
  }

  loanOutOptions(playerId) {
    const me = this.club();
    const p = [...me.squad, ...me.youth].find(x => x.id === playerId && !x.retired);
    if (!p) return { ok: false, error: 'He is not in your squad' };
    if (p.loan) return { ok: false, error: 'He is on loan here from another club' };
    if (p.age < 17) return { ok: false, error: 'Players must be 17 or older to go out on loan' };
    if (p.isInjured()) return { ok: false, error: 'Clubs will not take an injured player on loan' };
    const avg = c => { const a = c.squad.filter(x => !x.retired); return a.length ? a.reduce((t, x) => t + x.currentAbility, 0) / a.length : 40; };
    const myAvg = avg(me), base = TR.playerValue(p, this.econ);
    const roleRank = { starter: 0, rotation: 1, backup: 2 };
    const cands = [];
    for (const c of this.clubs) {
      if (c.id === me.id || c.squad.length >= 32) continue;
      const ca = avg(c);
      if (ca > myAvg + 1 || p.currentAbility < ca - 7) continue;           // stronger clubs do not borrow; weak loans are not wanted
      const role = this._loanRole(p, c);
      if (role === 'backup') continue;
      const h = hashString(`loan:${p.id}:${c.id}:${this.season}`);
      const div = clamp(c.division, 1, 4);
      const share = clamp(0.4 + (4 - div) * 0.12 + (role === 'starter' ? 0.1 : 0) + (h % 11) / 100, 0.35, 1);
      const fee = c.finance.balance > 300_000 ? Math.round(base * (0.015 + (4 - div) * 0.012 + (h % 7) / 1000) / 1000) * 1000 : 0;
      const lg = this.leagueOf(c.id);
      cands.push({ clubId: c.id, club: c.name, country: c.country, league: lg ? lg.name : '', division: c.division, role,
        fee, wageShare: Math.round(share * 100), wagePaid: Math.round(p.weeklyWage * share), clubRating: Math.round(ca),
        sameCountry: c.country === me.country, score: roleRank[role] * 10 + Math.abs(ca - p.currentAbility) / 4 + (c.country === me.country ? 0 : 3) - share * 4 + (h % 5) / 10 });
    }
    cands.sort((a, b) => a.score - b.score);
    const offers = cands.slice(0, 8).map(({ score, ...o }) => o);
    return { ok: true, playerId: p.id, name: p.name, weeklyWage: p.weeklyWage, ovr: p.currentAbility, offers,
      windowOpen: this.isWindowOpen(), squadSize: me.squad.filter(x => !x.retired).length };
  }

  loanOut(playerId, toClubId) {
    const guard = this._windowGuard();
    if (guard) return guard;
    const me = this.club();
    const opts = this.loanOutOptions(playerId);
    if (!opts.ok) return opts;
    const o = opts.offers.find(x => x.clubId === Number(toClubId));
    if (!o) return { ok: false, error: 'That club is no longer interested' };
    const p = this.players.get(playerId), to = this.clubById(o.clubId);
    const youth = me.youth.includes(p);
    if (!youth && me.squad.filter(x => !x.retired && !x.isInjured()).length <= 16) return { ok: false, error: 'You need at least 16 fit players left in the first-team squad' };
    if (p.position === 'GK' && !youth && me.squad.filter(x => !x.retired && x.position === 'GK').length <= 2) return { ok: false, error: 'Keep at least two goalkeepers' };
    me.squad = me.squad.filter(x => x.id !== p.id);
    me.youth = me.youth.filter(x => x.id !== p.id);
    to.squad.push(p);
    p.clubId = to.id;
    p.listedForSale = false;
    if (me.captainId === p.id) me.captainId = null;
    if (me.manualXI) { me.manualXI = me.manualXI.filter(m => m.playerId !== p.id); if (!me.manualXI.length) me.manualXI = null; }
    if (me.manualBench) { me.manualBench = me.manualBench.filter(id => id !== p.id); if (!me.manualBench.length) me.manualBench = null; }
    this.pendingBids = (this.pendingBids || []).filter(b => b.playerId !== p.id);
    p.loan = { parentClubId: me.id, fee: o.fee, wageContribution: o.wagePaid, startSeason: this.season, endSeason: this.season + 1, role: o.role,
      start: { apps: p.seasonStats.apps, subApps: p.seasonStats.subApps || 0, goals: p.seasonStats.goals, assists: p.seasonStats.assists, ovr: p.currentAbility, week: this.currentWeek } };
    if (o.fee) { FIN.post(me, 'Loan fees', o.fee, `${p.name} loaned to ${to.name}`); FIN.post(to, 'Loan fees', -o.fee, `${p.name} on loan from ${me.name}`); }
    this.notify('squad', `🔁 ${p.name} joins ${to.name} on loan until the end of the season (${o.role === 'starter' ? 'expected to start' : 'squad rotation'}). They cover ${o.wageShare}% of his wages${o.fee ? ` and paid a $${Math.round(o.fee / 1000)}K fee` : ''}.`, { playerId: p.id });
    return { ok: true, action: 'loaned_out', player: p.name, club: to.name, fee: o.fee, wageShare: o.wageShare };
  }

  recallLoan(playerId) {
    if (!this.isWindowOpen()) return { ok: false, error: `Loans can only be ended while the window is open. ${this.transferWindow().label}` };
    const me = this.club();
    const p = this.players.get(playerId);
    if (!p || !p.loan || p.loan.parentClubId !== me.id || p.clubId === me.id) return { ok: false, error: 'He is not out on loan from your club' };
    const at = this.clubById(p.clubId);
    if (at) at.squad = at.squad.filter(x => x.id !== p.id);
    const line = this._loanLine(p);
    me.squad.push(p); p.clubId = me.id; p.loan = null;
    this.notify('squad', `↩️ ${p.name} is back from ${at ? at.name : 'his loan'}: ${line}.`, { playerId: p.id });
    return { ok: true, action: 'recalled', player: p.name };
  }

  _loanStats(p) {
    const st = p.loan.start || { apps: 0, subApps: 0, goals: 0, assists: 0, ovr: p.currentAbility };
    const ss = p.seasonStats, same = p.loan.startSeason === this.season;
    return { apps: ss.apps + (ss.subApps || 0) - (same ? st.apps + st.subApps : 0), goals: ss.goals - (same ? st.goals : 0), assists: ss.assists - (same ? st.assists : 0), ovrFrom: st.ovr, ovr: p.currentAbility };
  }
  _loanLine(p) {
    const s = this._loanStats(p);
    return `${s.apps} game${s.apps === 1 ? '' : 's'}, ${s.goals} goal${s.goals === 1 ? '' : 's'}, ${s.assists} assist${s.assists === 1 ? '' : 's'}, ability ${s.ovrFrom}${s.ovr !== s.ovrFrom ? ` → ${s.ovr}` : ' (unchanged)'}`;
  }
  _loanedOutView() {
    const me = this.club();
    const out = [];
    for (const p of this.players.values()) {
      if (!p.loan || p.loan.parentClubId !== me.id || p.clubId === me.id || p.retired) continue;
      const c = this.clubById(p.clubId), lg = c ? this.leagueOf(c.id) : null;
      out.push({ ...this._playerRow(p), loanClub: c ? c.name : '?', loanClubId: p.clubId, loanLeague: lg ? lg.name : '', loanRole: p.loan.role || null,
        loanFee: p.loan.fee || 0, wagePaid: p.loan.wageContribution || 0, loanStats: this._loanStats(p) });
    }
    return out.sort((a, b) => b.ovr - a.ovr);
  }

  // Mutual termination: the player is paid half of the wages left on his contract.
  releaseTerms(p) {
    const weeksLeftThisSeason = Math.max(0, this.totalWeeks - this.currentWeek);
    const weeks = p.contractYears > 0 ? weeksLeftThisSeason + FIN.WEEKS * (p.contractYears - 1) : 0;
    return { weeksLeft: weeks, payout: Math.round(p.weeklyWage * weeks * 0.5) };
  }

  releasePlayer(playerId, dryRun = false) {
    const me = this.club();
    const p = [...me.squad, ...me.youth].find(x => x.id === playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    if (p.loan) return { ok: false, error: 'Loan players return to their club at season end' };
    const terms = this.releaseTerms(p);
    if (dryRun) return { ok: true, player: p.name, ...terms };
    if (me.finance.balance < terms.payout) return { ok: false, error: `The payout of ${Math.round(terms.payout / 1000)}K is more than the club has` };
    if (terms.payout) FIN.post(me, 'Contract termination', -terms.payout, `${p.name} released (half of ${terms.weeksLeft} weeks' wages)`);
    TR.releasePlayer(this, me, p);
    return { ok: true, player: p.name, payout: terms.payout };
  }

  sellPlayer(playerId) {
    const guard = this.isWindowOpen() ? null : { ok: false, error: `Transfer window closed. ${this.transferWindow().label}` };
    if (guard) return guard;
    const me = this.club();
    const p = [...me.squad, ...me.youth].find(x => x.id === playerId);
    if (!p) return { ok: false, error: 'Player not found' };
    if (p.loan) return { ok: false, error: 'He is on loan here' };
    if (me.youth.includes(p) && p.age < 20) return { ok: false, error: 'Academy players can be sold from age 20' };
    return TR.sellToHighestBidder(this, me, p);
  }

  toggleListed(playerId) {
    const me = this.club();
    const p = [...me.squad, ...me.youth].find(x => x.id === playerId);
    if (!p) return { ok: false, error: 'Not found' };
    if (me.youth.includes(p) && p.age < 20) return { ok: false, error: 'Academy players can be listed from age 20' };
    p.listedForSale = !p.listedForSale;
    return { ok: true, listed: p.listedForSale, player: p.name };
  }

  acceptBid(bidId) {
    if (!this.isWindowOpen()) return { ok: false, error: 'Transfer window closed' };
    return TR.acceptBid(this, bidId);
  }
  rejectBid(bidId) { return TR.rejectBid(this, bidId); }
  counterBid(bidId, fee) {
    if (!this.isWindowOpen()) return { ok: false, error: 'Transfer window closed' };
    return TR.counterBid(this, bidId, fee);
  }

  promoteYouthPlayer(playerId) {
    const me = this.club();
    const p = me.youth.find(x => x.id === playerId);
    if (!p) return { ok: false, error: 'Player not in youth' };
    me.youth = me.youth.filter(x => x.id !== p.id);
    me.squad.push(p);
    return { ok: true, player: p.name };
  }

  upgradeFacility(type, clubId = this.manager.clubId) {
    const c = this.clubById(clubId);
    return FIN.upgradeFacility(c, type);
  }

  scoutRegion(region) {
    const me = this.club();
    const cost = 50_000;
    if (me.finance.balance < cost) return { ok: false, error: 'Need $50K for scouting' };
    FIN.post(me, 'Scouting', -cost, `Scouting trip: ${region}`);
    const countries = [...new Set(this.clubs.filter(c => YOUTH.getRegion(c.country) === region).map(c => c.country))];
    const found = [];
    for (const cl of this.clubs) {
      if (!countries.includes(cl.country) || cl.id === me.id) continue;
      for (const p of cl.squad) if (!p.retired && p.age <= 21 && p.currentAbility > 40) found.push({ id: p.id, name: p.name, age: p.age, ovr: p.currentAbility, pot: p.hiddenPotential, club: cl.name, clubId: cl.id, nation: p.nation, pers: p.personality, hint: p.hint(), position: p.position, marketValue: TR.playerValue(p, this.econ) });
    }
    found.sort((a, b) => b.pot - a.pot || a.id - b.id);
    const top = found.slice(0, 8);
    SCOUT.reveal(this, top.map(x => x.id), 70);
    const fogged = top.map(x => { const p = this.players.get(x.id); const f = SCOUT.fogRow(this, p, { ...x }, me); return { ...f, ovr: f.ovr, pot: f.pot }; });
    return { ok: true, players: fogged, region, countries };
  }

  // ── second club ────────────────────────────────────────────────
  clubValuation(c) {
    const base = [8_000_000, 3_000_000, 1_200_000, 500_000][clamp(c.division, 1, 4) - 1];
    const v = base * (0.6 + c.prestige / 100) + (c.facilities.training + c.facilities.youth + c.facilities.medical) * 100_000 + (c.facilities.stadium || 0) * 40 + c.finance.balance;
    return Math.max(100_000, Math.round(v / 1000) * 1000);
  }

  secondClubOptions() {
    const me = this.club();
    const myLeague = this.league();
    return this.clubs.filter(c => c.id !== me.id && !myLeague.clubIds.includes(c.id))
      .map(c => ({ id: c.id, name: c.name, country: c.country, division: c.division, prestige: c.prestige, balance: Math.round(c.finance.balance), price: this.clubValuation(c) }))
      .sort((a, b) => a.price - b.price).slice(0, 60);
  }

  buySecondClub(clubId, source = 'club') {
    if (this.manager.ownedClubId) return { ok: false, error: 'You already own a second club. Sell it first.' };
    const me = this.club();
    const c = this.clubById(clubId);
    if (!c || c.id === me.id) return { ok: false, error: 'Club not available' };
    if (this.league().clubIds.includes(c.id)) return { ok: false, error: 'You cannot own a club in your own league' };
    const price = this.clubValuation(c);
    if (source === 'personal') {
      if (this.manager.wealth < price) return { ok: false, error: `Personal wealth $${Math.round(this.manager.wealth / 1000)}K < price $${Math.round(price / 1000)}K` };
      this.manager.wealth -= price;
    } else {
      if (me.finance.balance < price) return { ok: false, error: `Club balance too low (price $${Math.round(price / 1000)}K)` };
      FIN.post(me, 'Club ownership', -price, `Bought ${c.name}`);
    }
    this.manager.ownedClubId = c.id;
    this.manager.ownedSource = source;
    if (!c.finance.period) FIN.openPeriod(c, this.season, this.currentWeek + 1, true);
    else { c.finance.period.detailed = true; c.finance.period.entries = c.finance.period.entries || []; }
    this.notify('owner', `You now own ${c.name} (${c.country}, division ${c.division}).`);
    AW.unlock(this, 'owner');
    return { ok: true, club: c.name, price };
  }

  moveMoneySecondClub(amount) {
    const owned = this.clubById(this.manager.ownedClubId);
    if (!owned) return { ok: false, error: 'You do not own a second club' };
    const me = this.club();
    const amt = Math.round(Number(amount) || 0);
    if (!amt) return { ok: false, error: 'Enter an amount' };
    const [from, to] = amt > 0 ? [me, owned] : [owned, me];
    const abs = Math.abs(amt);
    if (from.finance.balance < abs) return { ok: false, error: `${from.name} does not have $${Math.round(abs / 1000)}K` };
    FIN.post(from, 'Owner transfer', -abs, `To ${to.name}`);
    FIN.post(to, 'Owner transfer', abs, `From ${from.name}`);
    return { ok: true, moved: amt };
  }

  sellSecondClub() {
    const owned = this.clubById(this.manager.ownedClubId);
    if (!owned) return { ok: false, error: 'You do not own a second club' };
    const value = this.clubValuation(owned);
    if (this.manager.ownedSource === 'personal') this.manager.wealth += value;
    else FIN.post(this.club(), 'Club ownership', value, `Sold ${owned.name}`);
    this.manager.ownedClubId = null;
    this.manager.ownedSource = null;
    this.notify('owner', `You sold ${owned.name} for $${Math.round(value / 1000)}K.`);
    return { ok: true, club: owned.name, value };
  }

  // ── views ───────────────────────────────────────────────────────
  transferWindow() {
    const w = this.currentWeek;
    const open = CFG.windows.find(([a, b]) => w >= a && w <= b);
    if (open) {
      const left = open[1] - w + 1;
      return { open: true, weeksLeft: left, label: `WINDOW OPEN · ${left} week${left > 1 ? 's' : ''} left` };
    }
    const next = CFG.windows.find(([a]) => a > w);
    return { open: false, opensWeek: next ? next[0] + 1 : null, label: next ? `Closed · opens week ${next[0] + 1}` : 'Closed · opens pre-season' };
  }

  _playerRow(p, extra = {}) {
    return { ...p.toJSON(TR.playerValue(p, this.econ)), ...extra };
  }

  _xiView(club) {
    const { xi, changes } = pickXI(club);
    const bench = pickBench(club, xi.map(s => s.playerId));
    const v = id => this.players.get(id);
    const row = (s) => {
      const p = s.playerId != null ? v(s.playerId) : null;
      return { slot: s.slot, slotKey: s.slotKey, source: s.source, playerId: p ? p.id : null, playerName: p ? p.name : null, playerOvr: p ? p.currentAbility : null, playerPos: p ? p.position : null, slotRating: p ? positionAbility(p, s.slot) : null, fit: p ? Math.round(p.fitness) : null };
    };
    return {
      currentXI: xi.map(row),
      bench: bench.map(id => { const p = v(id); return { playerId: id, playerName: p.name, playerOvr: p.currentAbility, playerPos: p.position, fit: Math.round(p.fitness) }; }),
      changes: changes.map(ch => ({ ...ch, outName: ch.outId ? v(ch.outId)?.name : null, inName: ch.inId ? v(ch.inId)?.name : null })),
    };
  }

  _matchReport(m, r, applied) {
    const me = this.manager.clubId;
    const name = id => this.players.get(id)?.name || '?';
    const myKey = m.home.clubId === me ? 'home' : m.away.clubId === me ? 'away' : null;
    const events = m.events.slice().sort((a, b) => a.min - b.min).map(e => {
      const club = this.clubById(m[e.side].clubId).name;
      let text = '';
      if (e.type === 'goal') text = `⚽ ${name(e.playerId)}${e.assistId ? ` (assist ${name(e.assistId)})` : ''}`;
      else if (e.type === 'sub') text = `🔁 ${name(e.onId)} on for ${name(e.offId)} — ${e.reason}`;
      else if (e.type === 'injury') text = `🏥 ${name(e.playerId)} injured (${e.injury}, ${e.weeks} wk${e.weeks > 1 ? 's' : ''})`;
      else if (e.type === 'shot') text = `🎯 ${name(e.playerId)} — ${e.outcome === 'saved' ? 'saved' : 'off target'} (xG ${e.xg})`;
      else if (e.type === 'yellow') text = `🟨 ${name(e.playerId)} booked`;
      else if (e.type === 'red') text = `🟥 ${name(e.playerId)} sent off (${e.reason})`;
      return { min: e.min, type: e.type, side: e.side, club, text, playerId: e.playerId ?? e.onId, offId: e.offId, assistId: e.assistId ?? null, xg: e.xg, outcome: e.outcome };
    });
    const ratings = this._ratings(m, r);
    let result = null;
    if (myKey) {
      const my = myKey === 'home' ? r.hg : r.ag, op = myKey === 'home' ? r.ag : r.hg;
      result = r.winner === me ? 'W' : r.winner && r.winner !== me ? 'L' : my > op ? 'W' : my < op ? 'L' : 'D';
    }
    return {
      comp: m.comp, compName: m.compName, week: m.week, season: this.season,
      home: this.clubById(r.h).name, away: this.clubById(r.a).name, homeId: r.h, awayId: r.a,
      hg: r.hg, ag: r.ag, pens: r.pens, hx: r.hx, ax: r.ax, hs: r.hs, as: r.as, pos: r.pos,
      homeGoals: r.hg, awayGoals: r.ag, ourClub: this.club().name, result, myKey, events,
      halftime: applied ? { subs: applied.subs, tactic: applied.tactic, formation: applied.formation, talk: applied.talk || null } : null,
      lineups: this._lineups(m), ratings, motm: ratings.motm,
    };
  }

  // Player ratings (out of 10) for a finished match, from what each player did: goals, assists,
  // cards, the result, clean sheets for defenders and keepers, plus a small fixed variation per
  // player and match (hash, not the RNG). The best rating is the man of the match.
  _ratings(m, r) {
    const out = { home: [], away: [], motm: null };
    const count = (type, id) => m.events.filter(e => e.type === type && e.playerId === id).length;
    for (const key of ['home', 'away']) {
      const side = m[key], opp = m[key === 'home' ? 'away' : 'home'];
      const won = r.winner ? r.winner === side.clubId : side.goals > opp.goals;
      const lost = r.winner ? r.winner !== side.clubId : side.goals < opp.goals;
      const ids = Object.keys(side.apps).map(Number);
      const avg = ids.reduce((s, id) => s + this.players.get(id).currentAbility, 0) / Math.max(1, ids.length);
      for (const id of ids) {
        const p = this.players.get(id), a = side.apps[id];
        const goals = count('goal', id), assists = m.events.filter(e => e.type === 'goal' && e.assistId === id).length;
        const def = ['GK', 'CB', 'LB', 'RB', 'CDM'].includes(p.position);
        let v = 6.2 + goals * 1.1 + assists * 0.7 - count('yellow', id) * 0.3 - count('red', id) * 1.5 + (won ? 0.5 : lost ? -0.4 : 0)
          + (def ? (opp.goals === 0 ? 0.7 : -0.2 * opp.goals) : 0) + (p.currentAbility - avg) * 0.02 + ((hashString(`${m.id}:${id}`) % 100) / 100 - 0.5) * 0.8;
        const mins = Math.max(0, (a.minOut ?? m.minute) - a.minIn);
        if (mins < 30) v = 6 + (v - 6) * 0.5;
        out[key].push({ playerId: id, name: p.name, position: p.position, rating: Math.round(clamp(v, 3.5, 10) * 10) / 10, goals, assists, sub: !a.start });
      }
      out[key].sort((x, y) => y.rating - x.rating || x.playerId - y.playerId);
    }
    const best = [...out.home.map(x => ({ ...x, side: 'home' })), ...out.away.map(x => ({ ...x, side: 'away' }))].sort((x, y) => y.rating - x.rating || x.playerId - y.playerId)[0];
    if (best) out.motm = { playerId: best.playerId, name: best.name, rating: best.rating, side: best.side };
    return out;
  }

  // Starting XIs and club colours for the 2D match view.
  _lineups(m) {
    const side = key => m[key].startXI.map(s => { const p = this.players.get(s.playerId); return { slotKey: s.slotKey, slot: s.slotKey.split('-')[0], playerId: s.playerId, name: p ? p.name : '?' }; });
    const hue = id => (id * 137) % 360;
    const h = hue(m.home.clubId), a = hue(m.away.clubId);
    return { home: side('home'), away: side('away'), homeHue: h, awayHue: Math.abs(h - a) < 50 ? (a + 150) % 360 : a };
  }

  halftimeView() {
    if (!this.liveMatch) return null;
    const m = this.liveMatch.match;
    const key = m.interactiveSide;
    const side = m[key];
    const p = id => this.players.get(id);
    const name = id => p(id)?.name || '?';
    return {
      comp: m.comp, compName: m.compName, week: m.week, myKey: key,
      home: { name: this.clubById(m.home.clubId).name, goals: m.home.goals, xg: Math.round(m.home.xg * 100) / 100, shots: m.home.shots },
      away: { name: this.clubById(m.away.clubId).name, goals: m.away.goals, xg: Math.round(m.away.xg * 100) / 100, shots: m.away.shots },
      events: m.events.slice().sort((a, b) => a.min - b.min).map(e => ({ min: e.min, side: e.side, type: e.type,
        playerId: e.playerId ?? e.onId, offId: e.offId, xg: e.xg, outcome: e.outcome,
        text: e.type === 'goal' ? `⚽ ${name(e.playerId)}` : e.type === 'injury' ? `🏥 ${name(e.playerId)} injured` : e.type === 'shot' ? `🎯 ${name(e.playerId)} — ${e.outcome === 'saved' ? 'saved' : 'off target'}` : e.type === 'yellow' ? `🟨 ${name(e.playerId)} booked` : e.type === 'red' ? `🟥 ${name(e.playerId)} sent off` : `🔁 ${name(e.onId)} on for ${name(e.offId)}` })),
      lineups: this._lineups(m),
      tactic: side.tactic, formation: side.formation, subsUsed: side.subsUsed, maxSubs: ME.MAX_SUBS,
      onPitch: side.onPitch.map(s => ({ slot: s.slot, slotKey: s.slotKey, playerId: s.playerId, name: name(s.playerId), position: p(s.playerId).position, fit: Math.round(p(s.playerId).fitness), ovr: p(s.playerId).currentAbility, rating: positionAbility(p(s.playerId), s.slot) })),
      bench: side.bench.filter(id => !side.apps[id]).map(id => ({ playerId: id, name: name(id), position: p(id).position, fit: Math.round(p(id).fitness), ovr: p(id).currentAbility, injured: p(id).isInjured() })),
      tactics: TACTICS, formations: FORMATIONS,
    };
  }

  _continentalView() {
    const me = this.manager.clubId;
    const nm = id => this.clubById(id)?.name || '?';
    return (this.continental || []).map(comp => ({
      id: comp.id, name: comp.name, continent: comp.continent, stage: comp.stage, mine: comp.entrants.includes(me),
      winner: comp.winner ? nm(comp.winner) : null,
      groups: comp.groups.map(g => ({ name: g.name, rows: sortRows(g.table).map((r, i) => ({ pos: i + 1, clubId: r.clubId, club: nm(r.clubId), isMe: r.clubId === me, p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, gd: r.gf - r.ga, pts: r.pts })) })),
      knockout: comp.knockout.map(t => ({ round: t.round, week: t.week, home: nm(t.h), away: nm(t.a), score: t.result ? `${t.result.hg}–${t.result.ag}${t.result.pens ? ` (${t.result.pens.home}–${t.result.pens.away} pens)` : ''}` : null, winner: t.winner ? nm(t.winner) : null })),
      nextWeek: comp.stage === 'groups' ? COMP.GROUP_WEEKS.find(w => w > this.currentWeek) : comp.stage === 'semis' ? COMP.SEMI_WEEK : comp.stage === 'final' ? COMP.FINAL_WEEK : null,
    }));
  }

  _clubSummary(c) {
    if (!c) return null;
    const lg = this.leagueOf(c.id);
    return { id: c.id, name: c.name, country: c.country, division: c.division, league: lg?.name, position: lg ? lg.positionOf(c.id) : null,
      balance: Math.round(c.finance.balance), prestige: c.prestige, facilities: c.facilities, squadSize: c.squad.length,
      value: this.clubValuation(c), ledger: c.ledger.slice(-6), facilityCosts: this._facilityCosts(c) };
  }

  _facilityCosts(c) {
    return Object.fromEntries(['training', 'youth', 'medical', 'stadium'].map(k => [k, FIN.facilityUpgradeCost(c, k)]));
  }

  // Views for cups, play-offs, board/career, staff, awards, records, achievements and sponsorship.
  _careerViews(c, lg) {
    const nm = id => this.clubById(id)?.name || '?';
    const score = r => r ? `${r.hg}–${r.ag}${r.pens ? ` (${r.pens.home}–${r.pens.away} pens)` : ''}` : null;
    const cupView = cup => cup && {
      id: cup.id, name: cup.name, country: cup.country, winner: cup.winner ? nm(cup.winner) : null, runnerUp: cup.runnerUp ? nm(cup.runnerUp) : null,
      alive: !cup.winner && (cup.rounds[cup.round].ties.some(t => (t.h === c.id || t.a === c.id) && t.winner !== (t.h === c.id ? t.a : t.h)) || (cup.round === 0 && cup.byes.includes(c.id))),
      rounds: cup.rounds.map(r => ({ name: r.name, week: r.week, ties: r.ties.filter(t => r.ties.length <= 16 || t.h === c.id || t.a === c.id).map(t => ({ home: nm(t.h), away: nm(t.a), homeDiv: this.clubById(t.h).division, awayDiv: this.clubById(t.a).division, score: score(t.result), winner: t.winner ? nm(t.winner) : null, mine: t.h === c.id || t.a === c.id })) })),
    };
    const myCup = this.cups.find(x => x.country === c.country);
    const po = lg.playoff;
    const tie = t => t && { round: t.round, week: t.week, home: nm(t.h), away: nm(t.a), score: score(t.result), winner: t.winner ? nm(t.winner) : null, mine: t.h === c.id || t.a === c.id };
    const roleView = STAFF.ROLES.map(role => ({ role, label: STAFF.ROLE_LABEL[role], staff: c.staff && c.staff[role] ? { ...c.staff[role] } : null }));
    const myRecords = (this.records || {})[c.id] || {};
    const awardsHistory = (this.history.awards || []).filter(a => a.leagueId && this.leagueById(a.leagueId)?.country === c.country).slice(-8).reverse();
    return {
      cup: cupView(myCup),
      otherCups: this.cups.filter(x => x !== myCup).map(x => ({ name: x.name, round: x.rounds[x.round]?.name, winner: x.winner ? nm(x.winner) : null })),
      playoff: po ? { semis: po.semis.map(tie), final: tie(po.final), winner: po.winner ? nm(po.winner) : null } : null,
      board: {
        objective: c.objective, confidence: Math.round(c.boardTrust), status: this.manager.status,
        jobOffers: (this.jobOffers || []).map(o => { const x = this.clubById(o.clubId); return { ...o, club: x.name, country: x.country, division: x.division, prestige: x.prestige, balance: Math.round(x.finance.balance) }; }),
        vacancies: BOARD.vacancies(this).map(v => { const x = this.clubById(v.clubId); return { ...v, club: x.name, country: x.country, division: x.division, prestige: x.prestige, needsBadgeName: BOARD.BADGES[v.needsBadge].name }; }),
        badge: this.manager.badge || 0, badgeName: BOARD.BADGES[this.manager.badge || 0].name, course: this.manager.course,
        nextBadge: (this.manager.badge || 0) < 4 ? { ...BOARD.BADGES[(this.manager.badge || 0) + 1], level: (this.manager.badge || 0) + 1 } : null,
        sackings: this.history.sackings || [], jobs: this.history.jobs || [],
      },
      staff: { roles: roleView, weeklyWages: STAFF.weeklyStaffWages(c) },
      achievements: Object.entries(AW.ACHIEVEMENTS).map(([id, a]) => ({ id, ...a, unlocked: (this.achievements || {})[id] || null })),
      records: myRecords,
      awards: awardsHistory,
      cupWinners: (this.history.cupWinners || []).filter(w => w.cup === myCup?.name).slice(-10).reverse(),
      sponsor: c.sponsor || null, sponsorOffers: this.sponsorOffers || null,
      ticketPrice: c.ticketPrice || 1, baseTicket: Math.round(FIN.TICKET_PRICE[clamp(c.division, 1, 4) - 1] * (1 + c.prestige / 150) * (this.econ || 1)),
      stadium: c.facilities.stadium,
      lastAttendance: (c.ledger.slice().reverse().flatMap(l => l.entries || []).find(e => e.cat === 'Gate receipts') || {}).note || null,
    };
  }

  snapshot() {
    const c = this.club();
    const lg = this.league();
    const sq = c.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility);
    const sorted = lg.sorted();
    const isBottom = lg.level === Math.max(...this.leagues.filter(x => x.country === lg.country).map(x => x.level));
    const myIdx = sorted.findIndex(r => r.clubId === c.id);
    const table = sorted.map((r, i) => ({
      pos: i + 1, club: this.clubById(r.clubId).name, clubId: r.clubId, isMe: r.clubId === c.id,
      pts: r.pts, gd: r.gf - r.ga, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, played: r.p, ded: r.ded,
      zone: leagueZone(lg.level, i, sorted.length, isBottom), zoneLabel: zoneLabel(leagueZone(lg.level, i, sorted.length, isBottom)),
    }));

    // Market: listed, unhappy, expiring and free agents, ranked by what your scouts estimate (the
    // fogged ability), then only the top 120 get full rows. Pure — no randomness here.
    const cands = [];
    for (const cl of this.clubs) {
      if (cl.id === c.id) continue;
      for (const p of cl.squad) {
        if (p.retired || p.loan) continue;
        if (!(p.listedForSale || p.wantsOut || p.contractYears <= 1)) continue;
        cands.push({ p, cl, est: SCOUT.estimate(this, p, c) });
      }
    }
    for (const p of this.players.values()) if (!p.retired && p.clubId == null) cands.push({ p, cl: null, est: SCOUT.estimate(this, p, c) });
    cands.sort((a, b) => b.est - a.est || a.p.id - b.p.id);
    const avgCache = new Map();
    const marketRow = (p, cl, extra = {}) => {
      if (cl && !avgCache.has(cl.id)) avgCache.set(cl.id, TR.squadAverage(cl));
      return SCOUT.fogRow(this, p, this._playerRow(p, { fromClub: cl ? cl.name : 'Free Agent', fromClubId: cl ? cl.id : null, loanAvailable: !!cl && (p.age <= 23 || p.currentAbility <= avgCache.get(cl.id) - 4), ...extra }), c);
    };
    const market = cands.slice(0, 120).map(x => marketRow(x.p, x.cl));
    // Players you are scouting or have reports on are always listed.
    const listed = new Set(market.map(x => x.id));
    for (const id of [...(this.scouting.assignments || []).map(a => a.playerId), ...(this.scouting.reports || []).map(r => r.playerId)]) {
      const p = this.players.get(id);
      if (!p || p.retired || listed.has(id) || p.clubId === c.id) continue;
      listed.add(id);
      market.push(marketRow(p, p.clubId != null ? this.clubById(p.clubId) : null, { shortlisted: true }));
    }
    market.sort((a, b) => b.currentAbility - a.currentAbility || a.id - b.id);

    const topScorers = [];
    for (const cl of this.clubs) for (const p of cl.squad) if (!p.retired && p.seasonStats.goals > 0) topScorers.push({ id: p.id, name: p.name, goals: p.seasonStats.goals, assists: p.seasonStats.assists, club: cl.name, ovr: cl.id === c.id ? p.currentAbility : SCOUT.estimate(this, p, c), position: p.position });
    topScorers.sort((a, b) => b.goals - a.goals || b.assists - a.assists);

    const xiView = this._xiView(c);
    // Next match from the same queue the week will play (league, play-off, cup or continental).
    let nextFixture = null;
    const upcoming = this.weekState ? this.weekState.queue.slice(this.weekState.done) : this.currentWeek < this.totalWeeks ? this._buildQueue(this.currentWeek + 1) : [];
    const mineNext = upcoming.filter(f => f.mine);
    if (mineNext.length) {
      const f = mineNext[0];
      nextFixture = { home: this.clubById(f.h).name, away: this.clubById(f.a).name, venue: f.neutral ? 'N' : f.h === c.id ? 'H' : 'A', opponent: this.clubById(f.h === c.id ? f.a : f.h).name, comp: this._fixtureMeta(f).compName, count: mineNext.length };
    }
    const recentResults = lg.results.filter(r => r.h === c.id || r.a === c.id).slice(-5).map(r => {
      const home = r.h === c.id, gf = home ? r.hg : r.ag, ga = home ? r.ag : r.hg;
      return { opponent: this.clubById(home ? r.a : r.h).name, venue: home ? 'H' : 'A', gf, ga, result: gf > ga ? 'W' : gf < ga ? 'L' : 'D', shotsFor: home ? r.hs : r.as, shotsAgainst: home ? r.as : r.hs, xgFor: home ? r.hx : r.ax, xgAgainst: home ? r.ax : r.hx };
    });
    const zone = myIdx >= 0 ? leagueZone(lg.level, myIdx, sorted.length, isBottom) : '';
    const finalYear = CON.finalYearPlayers(c);
    const per = c.finance.period;
    const debtSeasons = c.finance.debtSeasons || 0;
    const window = this.transferWindow();
    const next = this.manager.status === 'sacked' ? 'Choose a new job' : this.liveMatch ? 'Resume second half' : this.currentWeek >= this.totalWeeks ? 'Season complete' : nextFixture ? `Play ${nextFixture.venue === 'A' ? 'at' : 'vs'} ${nextFixture.opponent}` : `Continue to week ${this.currentWeek + 1}`;

    let boardObjective = 'Stabilise the club and build foundations.';
    if (c.division === 1) boardObjective = c.prestige >= 65 ? 'Challenge for continental qualification.' : 'Stay clear of relegation.';
    else if (c.division === 2) boardObjective = c.prestige >= 55 ? 'Push for promotion this season.' : 'Reach the top half.';
    else boardObjective = c.facilities.youth >= 3 ? 'Develop academy talent and chase promotion.' : 'Avoid relegation while building a stronger squad.';

    const budget = this._budgetView(c, lg);
    const legacyXI = rows => rows.map(s => ({ slot: s.slot, slotKey: s.slotKey, playerId: s.playerId, playerName: s.playerName, playerOvr: s.playerOvr, playerPos: s.playerPos }));
    const manualXI = c.manualXI ? c.manualXI.map(m => { const p = this.players.get(m.playerId); const slot = m.slotKey.split('-')[0]; return { slot, slotKey: m.slotKey, playerId: m.playerId, playerName: p?.name, playerOvr: p?.currentAbility, playerPos: p?.position }; }) : null;

    return {
      ok: true, hasCareer: true,
      tactics: TACTICS, formations: FORMATIONS, trainingFocuses: TRAINING_FOCUS,
      season: this.season, seasonLabel: `${this.season}/${this.season + 1}`,
      club: c.name, clubId: c.id, country: c.country, division: c.division,
      leagueName: lg.name, week: this.currentWeek, totalWeeks: this.totalWeeks,
      position: myIdx + 1, points: sorted[myIdx]?.pts ?? 0, gd: (sorted[myIdx]?.gf ?? 0) - (sorted[myIdx]?.ga ?? 0),
      reputation: this.manager.reputation, fans: c.fanMood, board: c.boardTrust,
      finances: Math.round(c.finance.balance), debt: Math.round(Math.max(0, -c.finance.balance)),
      transferBudget: budget.transferBudget, wageBudget: budget.wageBudget, budget,
      tactic: c.tactic, formation: c.formation, trainingFocus: c.trainingFocus, trainingIntensity: c.trainingIntensity,
      chemistry: c.chemistry, prestige: c.prestige, trophies: this.manager.trophies, completedSeasons: this.completedSeasons,
      facilities: c.facilities, facilityCosts: this._facilityCosts(c), facilityMax: FIN.FACILITY_MAX,
      table, market, topScorers: topScorers.slice(0, 25),
      allLeagues: this.leagues.map(l => ({ id: l.id, name: l.name, country: l.country, level: l.level, clubs: l.clubIds.map(id => { const x = this.clubById(id); return { id: x.id, name: x.name, prestige: x.prestige, division: x.division }; }) })),
      squad: sq.map(p => this._playerRow(p)),
      loanedOut: this._loanedOutView(),
      youth: c.youth.filter(p => !p.retired).map(p => this._playerRow(p)),
      expiringContracts: finalYear.map(p => ({ id: p.id, name: p.name, age: p.age, ovr: p.currentAbility, contractYears: p.contractYears, weeklyWage: p.weeklyWage })),
      contractAlerts: finalYear.length,
      manualXI, manualLineupSet: !!(c.manualXI && c.manualXI.length), manualBench: c.manualBench || [],
      currentXI: xiView.currentXI, autoXI: legacyXI(xiView.currentXI), bench: xiView.bench, selectionChanges: xiView.changes,
      formationSlots: buildSlotMap(c.formation), formationShapes: FORMATION_SLOTS,
      boardObjective, seasonStatus: zone ? zoneLabel(zone) : 'Mid-table fight', currentZone: zone,
      recentResults, nextFixture, continueLabel: next,
      transferWindow: window,
      pendingBids: this.pendingBids.map(b => { const p = this.players.get(b.playerId); return { ...b, playerName: p?.name, ovr: p?.currentAbility, position: p?.position, age: p?.age, club: this.clubById(b.clubId)?.name, premium: b.value ? Math.round((b.fee / b.value - 1) * 100) : 0 }; }),
      ledger: {
        current: per ? { week: per.week, opening: per.opening, items: per.items, entries: per.entries || [] } : null,
        weeks: c.ledger.slice(-12).map(l => ({ season: l.season, week: l.week, opening: l.opening, income: l.income, costs: l.costs, closing: l.closing, items: l.items, entries: l.entries })),
        weeklyWages: FIN.weeklyWageBill(c),
      },
      debtStatus: { seasons: debtSeasons, frozen: FIN.spendingFrozen(c), administration: !!c.finance.administration, stage: debtSeasons >= 3 ? 'forced' : debtSeasons === 2 ? 'final' : debtSeasons === 1 ? 'warning' : 'ok' },
      inbox: this.inbox.slice(-40).reverse(),
      continental: this._continentalView(),
      liveMatch: this.liveMatch ? this.halftimeView() : null,
      lastMatch: this.lastMatch,
      manager: { name: this.manager.name, wealth: Math.round(this.manager.wealth), ownedClubId: this.manager.ownedClubId, reputation: this.manager.reputation, badge: this.manager.badge || 0, status: this.manager.status || 'employed', sacks: this.manager.sacks || 0, nationalTeam: this.intl && this.intl.job ? this.intl.job.country : null },
      ownedClub: this._clubSummary(this.clubById(this.manager.ownedClubId)),
      ...this._careerViews(c, lg),
      decisions: this._decisions(c, budget),
      dressingRoom: DR.view(this, c),
      scouting: {
        slots: SCOUT.slots(c), fee: SCOUT.SCOUT_FEE[clamp(c.division, 1, 4) - 1], reports: (this.scouting.reports || []).slice(0, 15),
        assignments: (this.scouting.assignments || []).map(a => { const p = this.players.get(a.playerId); return p ? { playerId: p.id, name: p.name, position: p.position, age: p.age, club: p.clubId != null ? this.clubById(p.clubId)?.name : 'Free agent', known: SCOUT.knowledge(this, p, c), weeksLeft: SCOUT.weeksToReport(this, p, c) } : null; }).filter(Boolean),
      },
      international: INTL.view(this),
      news: NEWS.feed(this, 'all').slice(0, 30),
      challenges: { ...CH.ensure(this), score: CH.score(this), level: CH.level(CH.score(this)), code: this.manager.challengeCode || null },
      awardsRace: AW.race(this), goldenBall: (this.history.goldenBall || []).slice(-10).reverse(),
      delegate: this.manager.delegate || { contracts: false, bids: false },
    };
  }

  historySnapshot(limit = 10) {
    const n = clamp(parseInt(limit, 10) || 10, 1, 40);
    return {
      managerSeasons: this.managerHistory.slice(-n).reverse(),
      leagueWinners: this.history.leagueWinners.slice(-n * 4).reverse(),
      continentalWinners: this.history.continentalWinners.slice(-n).reverse(),
      topScorers: this.history.topScorers.slice(-n * 4).reverse(),
      hallOfFame: {
        status: this.manager.reputation >= 90 ? 'Legendary' : this.manager.reputation >= 75 ? 'Elite' : this.manager.reputation >= 55 ? 'Respected' : 'Developing',
        reputation: this.manager.reputation, trophies: this.manager.trophies, sacks: this.manager.sacks,
      },
    };
  }

  clubDetail(clubId) {
    const club = this.clubById(clubId);
    if (!club) return null;
    return {
      id: club.id, name: club.name, country: club.country, division: club.division, prestige: club.prestige,
      finance: { balance: Math.round(club.finance.balance), transferBudget: Math.round(Math.max(0, club.finance.balance)) }, facilities: club.facilities,
      squad: club.squad.filter(p => !p.retired).sort((a, b) => b.currentAbility - a.currentAbility).map(p => SCOUT.fogRow(this, p, this._playerRow(p, { fromClub: club.name, fromClubId: club.id }), this.club())),
    };
  }

  leagueTable(country, name) {
    const lg = this.leagues.find(l => l.country === country && l.name === name);
    if (!lg) return [];
    return lg.sorted().map((r, i) => ({ pos: i + 1, club: this.clubById(r.clubId).name, clubId: r.clubId, pts: r.pts, gd: r.gf - r.ga, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, played: r.p }));
  }

  // ── save / load ────────────────────────────────────────────────
  toSave() {
    return {
      _v: SAVE_VERSION,
      seed: this.seed, rngState: this.rng.getState(), ids: { ...this.ids },
      season: this.season, completedSeasons: this.completedSeasons, currentWeek: this.currentWeek, totalWeeks: this.totalWeeks,
      manager: this.manager, econ: this.econ, history: this.history, managerHistory: this.managerHistory,
      inbox: this.inbox, inboxSeq: this._inboxSeq, pendingBids: this.pendingBids, liveMatch: this.liveMatch, weekState: this.weekState,
      lastMatch: this.lastMatch, qualifiers: this.qualifiers, continental: this.continental, pyramids: this.pyramids,
      cups: this.cups, achievements: this.achievements, records: this.records, jobOffers: this.jobOffers, staffMarket: this.staffMarket,
      sponsorOffers: this.sponsorOffers, flags: this.flags,
      knowledge: this.knowledge, scouting: this.scouting, negotiations: this.negotiations, news: this.news, newsSeq: this.newsSeq,
      challenges: this.challenges, intl: this.intl,
      clubs: this.clubs.map(c => c.toData()),
      players: [...this.players.values()].map(p => p.toData()),
      leagues: this.leagues.map(l => l.toData()),
    };
  }

  static fromSave(raw) {
    if (!raw) return null;
    const data = migrate(raw, { DATA, wageFor, hashString });
    const w = new GameWorld({ _fromSave: true, seed: data.seed });
    w.rng.setState(data.rngState);
    w.season = data.season;
    w.completedSeasons = data.completedSeasons || 0;
    w.currentWeek = data.currentWeek || 0;
    w.totalWeeks = data.totalWeeks || 0;
    w.manager = { ...data.manager };
    w.manager.wealth ??= 0;
    w.manager.ownedClubId ??= null;
    w.manager.ownedSource ??= null;
    w.econ = data.econ || 1;
    w.history = data.history || w.history;
    w.managerHistory = data.managerHistory || [];
    w.inbox = data.inbox || [];
    w._inboxSeq = data.inboxSeq || w.inbox.length;
    w.pendingBids = data.pendingBids || [];
    w.liveMatch = data.liveMatch || null;
    w.weekState = data.weekState || null;
    w.lastMatch = data.lastMatch || null;
    w.qualifiers = data.qualifiers || {};
    w.continental = data.continental || [];
    w.cups = data.cups || [];
    w.achievements = data.achievements || {};
    w.records = data.records || {};
    w.jobOffers = data.jobOffers || [];
    w.staffMarket = data.staffMarket || {};
    w.sponsorOffers = data.sponsorOffers || null;
    w.flags = data.flags || {};
    w.knowledge = data.knowledge || {};
    w.scouting = data.scouting || { assignments: [], reports: [] };
    w.negotiations = data.negotiations || {};
    w.news = data.news || [];
    w.newsSeq = data.newsSeq || 0;
    w.challenges = data.challenges || null;
    w.intl = data.intl || null;
    w.manager.delegate ??= { contracts: false, bids: false };
    w.pyramids = data.pyramids;
    for (const pd of data.players) w.players.set(pd.id, Player.fromData(pd));
    w.clubs = data.clubs.map(cd => Club.fromData(cd, w.players));
    w.leagues = data.leagues.map(ld => League.fromData(ld));
    w._index();
    // Root cause fixed: ids restarted at 1 on server boot and a throwaway world was built first,
    // so new players could reuse saved ids. Counters are saved and restored above max(saved id) + 1.
    const maxPid = Math.max(0, ...[...w.players.keys()]);
    const maxCid = Math.max(0, ...w.clubs.map(c => c.id));
    w.ids = { pid: Math.max(data.ids?.pid || 1, maxPid + 1), cid: Math.max(data.ids?.cid || 1, maxCid + 1) };
    if (data._needsSeasonStart) w._startSeason();
    if (!w.intl) INTL.init(w);
    if (!w.challenges) { CH.startSeason(w); if (!w.weekState) w._setNextChallenge(); }
    if (!w.manager.careerId) w.manager.careerId = `${w.seed}:${w.club().country}:${w.club().id}`;
    for (const c of w.clubs) if (!c.finance.period) FIN.openPeriod(c, w.season, w.currentWeek + 1, w._detailed(c));
    return w;
  }
}

module.exports = { GameWorld, CFG, TACTICS, FORMATIONS, TRAINING_FOCUS, FORMATION_SLOTS, wageFor };
