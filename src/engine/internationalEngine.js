// src/engine/internationalEngine.js — national teams.
//
// Every nation picks its best 23 players (3 keepers + 20 outfield) at each international break.
// Nations League every season: two groups of five drawn by ranking (Elo), five matchdays during the
// season and a final between the group winners. Every second summer the top eight play the World
// Nations Cup (quarter-finals, semi-finals, final). Caps and international goals are recorded;
// club stats, bans and morale effects stay at club level. A manager with a strong reputation can
// be offered a national team job alongside the club job.

const ME = require('./matchEngine');
const { hashString } = require('../utils');

const NL_WEEKS = [6, 11, 16, 21, 26];
const NL_FINAL_WEEK = 31;
const SQUAD = 23;

const teamId = country => `N:${country}`;
const countryOf = id => String(id).slice(2);

function nations(world) { return world.pyramids.map(p => p.country); }

// Best available players per nation (one pass over all players).
function pools(world) {
  const by = {};
  for (const p of world.players.values()) {
    if (p.retired || p.age < 17 || p.isInjured()) continue;
    (by[p.nation] ||= []).push(p);
  }
  for (const k of Object.keys(by)) by[k].sort((a, b) => b.currentAbility - a.currentAbility || a.id - b.id);
  return by;
}

function pickSquad(world, country, pool) {
  const intl = world.intl;
  const chosen = [];
  const used = new Set();
  if (intl.job && intl.job.country === country && Array.isArray(intl.job.squad) && intl.job.squad.length) {
    for (const id of intl.job.squad) {
      const p = world.players.get(id);
      if (p && !p.retired && !p.isInjured() && p.nation === country && !used.has(id)) { chosen.push(p); used.add(id); }
    }
  }
  const list = pool || [];
  const gkCount = () => chosen.filter(x => x.position === 'GK').length;
  for (const p of list) {
    if (chosen.length >= SQUAD) break;
    if (used.has(p.id)) continue;
    if (p.position === 'GK' ? gkCount() < 3 : chosen.length - gkCount() < SQUAD - 3) { chosen.push(p); used.add(p.id); }
  }
  for (const p of list) { if (chosen.length >= SQUAD) break; if (!used.has(p.id)) { chosen.push(p); used.add(p.id); } }
  return chosen.slice(0, SQUAD);
}

function teamObject(country, squad) {
  return { id: teamId(country), name: country, country, national: true, squad, youth: [], formation: '4-3-3', tactic: 'possession',
    manualXI: null, manualBench: null, lastXI: null, chemistry: 60, fanMood: 50, prestige: 50, staff: {}, division: 0 };
}

function strength(pool) {
  const top = (pool || []).slice(0, 16);
  return top.length ? top.reduce((s, p) => s + p.currentAbility, 0) / top.length : 40;
}

function init(world) {
  const by = pools(world);
  const elo = {};
  for (const n of nations(world)) elo[n] = Math.round(1500 + (strength(by[n]) - 70) * 40);
  world.intl = { elo, season: null, groups: [], fixtures: [], final: null, winners: [], wnc: null, job: null, offers: [], squads: {}, form: {} };
  newSeason(world);
}

function rankings(world) {
  return Object.entries(world.intl.elo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([country, elo], i) => ({ country, elo: Math.round(elo), rank: i + 1 }));
}

// Circle method for five teams (one bye per matchday).
function roundRobin5(teams) {
  const t = [...teams, null];
  const rounds = [];
  for (let r = 0; r < t.length - 1; r++) {
    const pairs = [];
    for (let i = 0; i < t.length / 2; i++) {
      const a = t[i], b = t[t.length - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop());
  }
  return rounds;
}

function newSeason(world) {
  const intl = world.intl;
  const ranked = rankings(world).map(r => r.country);
  const A = [], B = [];
  ranked.forEach((c, i) => ((i % 4 === 0 || i % 4 === 3) ? A : B).push(c));
  intl.season = world.season;
  intl.groups = [{ name: 'A', teams: A }, { name: 'B', teams: B }].map(g => ({ ...g, table: g.teams.map(country => ({ country, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 })) }));
  intl.fixtures = [];
  for (const g of intl.groups) roundRobin5(g.teams).forEach((pairs, md) => { for (const [h, a] of pairs) intl.fixtures.push({ week: NL_WEEKS[md], group: g.name, h, a, result: null }); });
  intl.final = null;
}

const sortTable = rows => rows.slice().sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.country.localeCompare(b.country));

function updateElo(intl, h, a, hg, ag, winner) {
  const ra = intl.elo[h], rb = intl.elo[a];
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const sa = winner ? (winner === h ? 1 : 0) : hg > ag ? 1 : hg < ag ? 0 : 0.5;
  const k = 30 * (1 + Math.min(3, Math.abs(hg - ag)) * 0.25);
  intl.elo[h] = Math.round(ra + k * (sa - ea));
  intl.elo[a] = Math.round(rb - k * (sa - ea));
}

function play(world, h, a, by, opts) {
  const home = teamObject(h, pickSquad(world, h, by[h]));
  const away = teamObject(a, pickSquad(world, a, by[a]));
  world.intl.squads[h] = home.squad.map(p => p.id);
  world.intl.squads[a] = away.squad.map(p => p.id);
  const ctx = { rng: world.rng, getPlayer: id => world.players.get(id), getClub: id => (id === home.id ? home : id === away.id ? away : world.clubById(id)) };
  const { match, result } = ME.playMatch(ctx, { id: `intl-${world.season}-${opts.week}-${h}-${a}`, comp: 'intl', compName: opts.compName, week: opts.week, home, away, neutral: !!opts.neutral, knockout: !!opts.knockout, international: true });
  const winner = result.winner ? countryOf(result.winner) : null;
  updateElo(world.intl, h, a, result.hg, result.ag, winner);
  const scorers = match.events.filter(e => e.type === 'goal').map(e => ({ side: e.side, name: world.players.get(e.playerId)?.name, min: e.min }));
  const res = { hg: result.hg, ag: result.ag, pens: result.pens, winner, scorers };
  recordJob(world, h, a, res);
  return res;
}

function recordJob(world, h, a, res) {
  const job = world.intl.job;
  if (!job || (job.country !== h && job.country !== a)) return;
  const mine = job.country;
  const won = res.winner ? res.winner === mine : (mine === h ? res.hg > res.ag : res.ag > res.hg);
  const lost = res.winner ? res.winner !== mine : (mine === h ? res.hg < res.ag : res.ag < res.hg);
  job.played++; if (won) job.won++; else if (lost) job.lost++; else job.drawn++;
  job.form = [...(job.form || []), won ? 'W' : lost ? 'L' : 'D'].slice(-5);
}

// Called at the end of every week. Returns { played: [...], events: [...] }.
function weekly(world, week) {
  const intl = world.intl;
  if (!intl) return null;
  const todays = intl.fixtures.filter(f => f.week === week && !f.result);
  const isFinal = week === NL_FINAL_WEEK && !intl.final;
  if (!todays.length && !isFinal) return null;
  const by = pools(world);
  const played = [];
  for (const f of todays) {
    f.result = play(world, f.h, f.a, by, { week, compName: `Nations League · Group ${f.group}` });
    const g = intl.groups.find(x => x.name === f.group);
    const rh = g.table.find(r => r.country === f.h), ra = g.table.find(r => r.country === f.a);
    rh.p++; ra.p++; rh.gf += f.result.hg; rh.ga += f.result.ag; ra.gf += f.result.ag; ra.ga += f.result.hg;
    if (f.result.hg > f.result.ag) { rh.w++; ra.l++; rh.pts += 3; } else if (f.result.hg < f.result.ag) { ra.w++; rh.l++; ra.pts += 3; } else { rh.d++; ra.d++; rh.pts++; ra.pts++; }
    played.push({ comp: 'Nations League', h: f.h, a: f.a, ...f.result });
  }
  let champion = null;
  if (isFinal) {
    const [wa, wb] = intl.groups.map(g => sortTable(g.table)[0].country);
    const r = play(world, wa, wb, by, { week, compName: 'Nations League · Final', neutral: true, knockout: true });
    intl.final = { week, h: wa, a: wb, result: r, winner: r.winner };
    intl.winners.push({ season: world.season, comp: 'Nations League', winner: r.winner, runnerUp: r.winner === wa ? wb : wa });
    played.push({ comp: 'Nations League final', h: wa, a: wb, ...r });
    champion = r.winner;
  }
  return { played, champion, callups: callupsFor(world, world.manager.clubId) };
}

function callupsFor(world, clubId) {
  const out = [];
  for (const [country, ids] of Object.entries(world.intl.squads || {})) {
    for (const id of ids) { const p = world.players.get(id); if (p && p.clubId === clubId) out.push({ id, name: p.name, country }); }
  }
  return out;
}

// World Nations Cup: every second summer, top eight by ranking, neutral knockout.
function worldCup(world) {
  const intl = world.intl;
  const by = pools(world);
  const seeds = rankings(world).slice(0, 8).map(r => r.country);
  const rounds = [];
  let alive = [[seeds[0], seeds[7]], [seeds[3], seeds[4]], [seeds[1], seeds[6]], [seeds[2], seeds[5]]];
  for (const name of ['Quarter-finals', 'Semi-finals', 'Final']) {
    const ties = alive.map(([h, a]) => ({ h, a, result: play(world, h, a, by, { week: 33, compName: `World Nations Cup · ${name}`, neutral: true, knockout: true }) }));
    ties.forEach(t => { t.winner = t.result.winner || (t.result.hg > t.result.ag ? t.h : t.a); });
    rounds.push({ name, ties });
    const winners = ties.map(t => t.winner);
    alive = [];
    for (let i = 0; i < winners.length; i += 2) if (winners[i + 1]) alive.push([winners[i], winners[i + 1]]);
  }
  const final = rounds[2].ties[0];
  intl.wnc = { season: world.season, rounds, winner: final.winner, runnerUp: final.winner === final.h ? final.a : final.h };
  intl.winners.push({ season: world.season, comp: 'World Nations Cup', winner: final.winner, runnerUp: intl.wnc.runnerUp });
  return intl.wnc;
}

// Season end: World Nations Cup in even seasons, job verdicts and offers, new Nations League.
function seasonEnd(world) {
  const intl = world.intl;
  const out = { wnc: null, offers: [], jobEnded: null, trophies: [] };
  if (world.season % 2 === 0) out.wnc = worldCup(world);
  const job = intl.job;
  if (job) {
    const nl = intl.final && intl.final.winner === job.country;
    const wc = out.wnc && out.wnc.winner === job.country;
    if (nl) out.trophies.push('Nations League');
    if (wc) out.trophies.push('World Nations Cup');
    const recent = (job.form || []).filter(r => r === 'L').length;
    if (recent >= 4) { out.jobEnded = `${job.country} dismissed you after ${recent} defeats in five games.`; intl.job = null; }
  }
  intl.offers = [];
  const rep = world.manager.reputation;
  if (!intl.job && rep >= 50) {
    const ranks = rankings(world);
    const minRank = rep >= 80 ? 1 : rep >= 65 ? 3 : 6;
    const pool = ranks.filter(r => r.rank >= minRank).map(r => r.country);
    const mine = world.club().country;
    const pick = pool.includes(mine) ? mine : pool[hashString(`nt:${world.season}`) % Math.max(1, pool.length)];
    if (pick) { intl.offers = [{ country: pick, season: world.season, rank: ranks.find(r => r.country === pick).rank }]; out.offers = intl.offers; }
  }
  for (const id of Object.keys(intl.squads)) intl.squads[id] = intl.squads[id].filter(pid => world.players.has(pid));
  newSeason(world);
  return out;
}

function acceptJob(world, country) {
  const intl = world.intl;
  const offer = (intl.offers || []).find(o => o.country === country);
  if (!offer) return { ok: false, error: 'No offer from that nation' };
  intl.job = { country, since: world.season, played: 0, won: 0, drawn: 0, lost: 0, form: [], squad: null };
  intl.offers = [];
  return { ok: true, country };
}

function leaveJob(world) {
  if (!world.intl.job) return { ok: false, error: 'You do not manage a national team' };
  const c = world.intl.job.country;
  world.intl.job = null;
  return { ok: true, country: c };
}

function setSquad(world, ids) {
  const job = world.intl.job;
  if (!job) return { ok: false, error: 'You do not manage a national team' };
  const clean = [...new Set(ids.map(Number))].filter(id => { const p = world.players.get(id); return p && !p.retired && p.nation === job.country; }).slice(0, SQUAD);
  if (clean.length && !clean.some(id => world.players.get(id).position === 'GK')) return { ok: false, error: 'Pick at least one goalkeeper' };
  job.squad = clean.length ? clean : null;
  return { ok: true, picked: clean.length };
}

function view(world) {
  const intl = world.intl;
  if (!intl) return null;
  const by = intl.job ? pools(world) : null;
  const pname = id => world.players.get(id)?.name;
  return {
    rankings: rankings(world),
    groups: intl.groups.map(g => ({ name: g.name, rows: sortTable(g.table).map((r, i) => ({ pos: i + 1, ...r, gd: r.gf - r.ga })) })),
    fixtures: intl.fixtures.map(f => ({ week: f.week, group: f.group, h: f.h, a: f.a, score: f.result ? `${f.result.hg}–${f.result.ag}` : null, scorers: f.result ? f.result.scorers : [] })),
    final: intl.final ? { h: intl.final.h, a: intl.final.a, score: `${intl.final.result.hg}–${intl.final.result.ag}${intl.final.result.pens ? ` (${intl.final.result.pens.home}–${intl.final.result.pens.away} pens)` : ''}`, winner: intl.final.winner } : null,
    finalWeek: NL_FINAL_WEEK, weeks: NL_WEEKS,
    nextWeek: [...NL_WEEKS, NL_FINAL_WEEK].find(w => w > world.currentWeek) || null,
    wnc: intl.wnc ? { season: intl.wnc.season, winner: intl.wnc.winner, rounds: intl.wnc.rounds.map(r => ({ name: r.name, ties: r.ties.map(t => ({ h: t.h, a: t.a, score: `${t.result.hg}–${t.result.ag}${t.result.pens ? ` (${t.result.pens.home}–${t.result.pens.away} p)` : ''}`, winner: t.winner })) })) } : null,
    nextWnc: world.season % 2 === 0 ? world.season : world.season + 1,
    winners: intl.winners.slice(-12).reverse(),
    job: intl.job ? { ...intl.job, squadNames: (intl.squads[intl.job.country] || []).map(pname).filter(Boolean),
      pool: (by[intl.job.country] || []).slice(0, 40).map(p => ({ id: p.id, name: p.name, position: p.position, age: p.age, ovr: p.currentAbility, club: p.clubId ? world.clubById(p.clubId)?.name : 'Free agent', picked: (intl.job.squad || intl.squads[intl.job.country] || []).includes(p.id) })) } : null,
    offers: intl.offers || [],
    callups: callupsFor(world, world.manager.clubId),
  };
}

module.exports = { init, newSeason, weekly, seasonEnd, acceptJob, leaveJob, setSquad, view, rankings, NL_WEEKS, NL_FINAL_WEEK, teamId };
