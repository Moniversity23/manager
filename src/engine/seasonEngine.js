// src/engine/seasonEngine.js — leagues, fixtures, tables, promotion/relegation and world invariants.
//
// Root cause fixed: the pyramid (which league is above which) used to be stored on the shared WORLD
// constant (cd._refs), so two GameWorlds in one process overwrote each other's leagues. Leagues now
// belong to the world, hold club ids (not object references), and are saved explicitly.

const FIN = require('./financeEngine');

// Top 2 promoted automatically, 3rd–6th play off for the third place; bottom 3 relegated.
const AUTO_PROMOTED = 2;
const PROMOTED = 3;
const RELEGATED = 3;
const PLAYOFF_PLACES = [3, 4, 5, 6];

// Double round robin. With an odd club count one club rests each round (15 clubs → 30 rounds).
function buildRoundRobin(ids) {
  const teams = [...ids];
  if (teams.length % 2) teams.push(null);
  const n = teams.length;
  const rounds = [];
  let rot = [...teams];
  for (let r = 0; r < n - 1; r++) {
    const wk = [];
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i], b = rot[n - 1 - i];
      if (a != null && b != null) wk.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(wk);
    rot = [rot[0], rot[n - 1], ...rot.slice(1, n - 1)];
  }
  return [...rounds, ...rounds.map(wk => wk.map(([a, b]) => [b, a]))];
}

function emptyRow(clubId, ded = 0) {
  return { clubId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: -ded, ded };
}

function sortRows(rows) {
  return [...rows].sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.clubId - b.clubId);
}

function applyResultToRows(rows, r) {
  const h = rows.find(x => x.clubId === r.h);
  const a = rows.find(x => x.clubId === r.a);
  if (!h || !a) return;
  h.p++; a.p++;
  h.gf += r.hg; h.ga += r.ag; a.gf += r.ag; a.ga += r.hg;
  if (r.hg > r.ag) { h.w++; h.pts += 3; a.l++; }
  else if (r.hg < r.ag) { a.w++; a.pts += 3; h.l++; }
  else { h.d++; a.d++; h.pts++; a.pts++; }
}

class League {
  constructor({ id, continent, country, name, level, clubIds }) {
    this.id = id;
    this.continent = continent;
    this.country = country;
    this.name = name;
    this.level = level;
    this.clubIds = [...clubIds];
    this.table = [];
    this.schedule = [];
    this.weekIdx = 0;
    this.results = [];
  }

  static fromData(d) { return Object.assign(Object.create(League.prototype), d); }
  toData() {
    return { id: this.id, continent: this.continent, country: this.country, name: this.name, level: this.level,
      clubIds: this.clubIds, table: this.table, schedule: this.schedule, weekIdx: this.weekIdx, results: this.results, playoff: this.playoff || null };
  }

  startSeason(deductions = {}) {
    this.table = this.clubIds.map(id => emptyRow(id, deductions[id] || 0));
    this.schedule = buildRoundRobin(this.clubIds);
    this.weekIdx = 0;
    this.results = [];
    this.playoff = null;
  }

  regularWeeks() { return this.schedule.length; }

  // Called once the 30 rounds are played. The top division has no play-off.
  startPlayoff() {
    if (this.level === 1 || this.playoff) return null;
    const rows = this.sorted();
    const [p3, p4, p5, p6] = PLAYOFF_PLACES.map(n => rows[n - 1].clubId);
    const wk = this.regularWeeks() + 1;
    this.playoff = { semis: [{ round: 'Play-off semi-final', week: wk, h: p3, a: p6, result: null, winner: null }, { round: 'Play-off semi-final', week: wk, h: p4, a: p5, result: null, winner: null }], final: null, winner: null };
    return this.playoff;
  }

  playoffFixtures(week) {
    if (!this.playoff) return [];
    const ties = [...this.playoff.semis, ...(this.playoff.final ? [this.playoff.final] : [])];
    return ties.filter(t => t.week === week && !t.result);
  }

  recordPlayoff(tie, r) {
    tie.result = r; tie.winner = r.winner;
    const po = this.playoff;
    if (!po.final && po.semis.every(t => t.winner)) po.final = { round: 'Play-off final', week: this.regularWeeks() + 2, h: po.semis[0].winner, a: po.semis[1].winner, result: null, winner: null, neutral: true };
    else if (po.final && po.final.winner) po.winner = po.final.winner;
  }

  currentRound() { return this.schedule[this.weekIdx] || []; }
  regularOver() { return this.weekIdx >= this.schedule.length; }
  record(r) { applyResultToRows(this.table, r); this.results.push(r); }
  advance() { if (this.weekIdx < this.schedule.length) this.weekIdx++; return this.weekIdx >= this.schedule.length; }
  sorted() { return sortRows(this.table); }
  positionOf(clubId) { return this.sorted().findIndex(r => r.clubId === clubId) + 1; }
}

function leagueZone(level, idx, size, isBottom = false) {
  if (idx < 0) return '';
  if (level === 1) {
    if (idx === 0) return 'champion';
    if (idx < 4) return 'continental';
    if (idx >= size - RELEGATED) return 'relegation';
    return '';
  }
  if (idx < AUTO_PROMOTED) return 'promotion';
  if (idx < 6) return 'playoff';
  if (!isBottom && idx >= size - RELEGATED) return 'relegation';
  if (isBottom && idx >= size - 2) return 'reelection';
  return '';
}

function zoneLabel(zone) {
  return { champion: 'Champions', continental: 'Continental spot', promotion: 'Automatic promotion', playoff: 'Play-off place', relegation: 'Relegation zone', reelection: 'Re-election vote' }[zone] || '';
}

// Swap clubs between adjacent divisions of each national pyramid using the final tables.
function promoteAndRelegate(world, finalTables) {
  const moves = [];
  for (const pyr of world.pyramids) {
    const leagues = pyr.leagueIds.map(id => world.leagueById(id));
    for (let i = 0; i < leagues.length - 1; i++) {
      const upper = leagues[i], lower = leagues[i + 1];
      const relegated = finalTables.get(upper.id).slice(-RELEGATED).map(r => r.clubId);
      const auto = finalTables.get(lower.id).slice(0, AUTO_PROMOTED).map(r => r.clubId);
      const poWinner = lower.playoff && lower.playoff.winner;
      const third = poWinner && !auto.includes(poWinner) ? poWinner : finalTables.get(lower.id)[AUTO_PROMOTED].clubId;
      const promoted = [...auto, third];
      upper.clubIds = upper.clubIds.filter(id => !relegated.includes(id)).concat(promoted);
      lower.clubIds = lower.clubIds.filter(id => !promoted.includes(id)).concat(relegated);
      for (const id of promoted) moves.push({ clubId: id, from: lower.level, to: upper.level, type: 'promoted', via: id === third && poWinner ? 'play-offs' : 'automatic' });
      for (const id of relegated) moves.push({ clubId: id, from: upper.level, to: lower.level, type: 'relegated' });
    }
  }
  for (const mv of moves) {
    const c = world.clubById(mv.clubId);
    c.division = mv.to;
    if (mv.type === 'promoted') {
      c.fanMood = Math.min(100, c.fanMood + 12);
      c.boardTrust = Math.min(100, c.boardTrust + 8);
      // Promotion raises what the shirt is worth (a signed deal pays its promotion bonus instead).
      if (!(c.sponsor && c.sponsor.years > 0)) c.finance.sponsorship = Math.max(c.finance.sponsorship, FIN.sponsorValue(c));
    } else {
      c.fanMood = Math.max(0, c.fanMood - 10);
      c.boardTrust = Math.max(0, c.boardTrust - 8);
    }
  }
  return moves;
}

// Invariants checked after every season (and by the soak test). Throws on any violation.
function assertWorldInvariants(world) {
  const size = world.cfg.leagueSize;
  const seen = new Map();
  for (const lg of world.leagues) {
    if (lg.clubIds.length !== size) throw new Error(`Invariant: ${lg.country} ${lg.name} has ${lg.clubIds.length} clubs, expected ${size}`);
    for (const id of lg.clubIds) {
      if (seen.has(id)) throw new Error(`Invariant: club ${id} is in two leagues`);
      seen.set(id, lg);
      const c = world.clubById(id);
      if (!c) throw new Error(`Invariant: league ${lg.name} references missing club ${id}`);
      if (c.division !== lg.level || c.country !== lg.country) throw new Error(`Invariant: ${c.name} division ${c.division} but league level ${lg.level}`);
    }
  }
  if (seen.size !== world.clubs.length) throw new Error(`Invariant: ${world.clubs.length - seen.size} clubs are in no league`);
  const owner = new Map();
  for (const c of world.clubs) {
    for (const p of [...c.squad, ...c.youth]) {
      if (owner.has(p.id)) throw new Error(`Invariant: player ${p.id} is in two squads`);
      owner.set(p.id, c.id);
      if (p.clubId !== c.id) throw new Error(`Invariant: player ${p.id} clubId ${p.clubId} but listed at club ${c.id}`);
      if (!world.players.has(p.id)) throw new Error(`Invariant: player ${p.id} at ${c.name} is not registered`);
    }
    if (c.squad.length > 40) throw new Error(`Invariant: ${c.name} hoards ${c.squad.length} players`);
  }
  return true;
}

module.exports = { League, buildRoundRobin, sortRows, applyResultToRows, emptyRow, leagueZone, zoneLabel, promoteAndRelegate, assertWorldInvariants, PROMOTED, RELEGATED, AUTO_PROMOTED };
