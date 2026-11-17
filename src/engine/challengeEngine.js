// src/engine/challengeEngine.js — weekly and season challenges, manager score, challenge codes.
//
// A weekly challenge is set for each week with one of your matches (win by two, clean sheet, start
// a youngster, win away, beat a team above you …) and three season challenges at the start of each
// season. They complete automatically — no claiming — and pay cash plus points. Points, trophies,
// promotions and achievements make the manager score shown on the leaderboard.
// A challenge code (seed + country + start club) lets a friend start the exact same world and
// compare scores. Challenge choice uses a hash, never the RNG.

const { clamp, hashString } = require('../utils');
const { post } = require('./financeEngine');

const WEEKLY = [
  { key: 'win_by2', text: 'Win by two goals or more', pts: 15, test: (r) => r.result === 'W' && Math.abs(r.hg - r.ag) >= 2 },
  { key: 'clean', text: 'Keep a clean sheet', pts: 12, test: (r) => (r.myKey === 'home' ? r.ag : r.hg) === 0 },
  { key: 'score3', text: 'Score three or more', pts: 15, test: (r) => (r.myKey === 'home' ? r.hg : r.ag) >= 3 },
  { key: 'youth', text: 'Start a player aged 21 or under — and win', pts: 15, test: (r, w) => r.result === 'W' && r.lineups[r.myKey].some(s => (w.players.get(s.playerId)?.age || 99) <= 21) },
  { key: 'away_win', text: 'Win away from home', pts: 15, when: (cx) => cx.away, test: (r) => r.result === 'W' },
  { key: 'beat_higher', text: 'Beat a team above you in the table', pts: 20, when: (cx) => cx.oppAbove, test: (r) => r.result === 'W' },
  { key: 'no_cards', text: 'Win without a single card', pts: 12, test: (r) => r.result === 'W' && !r.events.some(e => (e.type === 'yellow' || e.type === 'red') && e.side === r.myKey) },
];
const SEASON = [
  { key: 'top_half', text: 'Finish in the top half of the league', pts: 40 },
  { key: 'cup_qf', text: 'Reach the national cup quarter-finals', pts: 40 },
  { key: 'profit', text: 'End the season with more money than you started with', pts: 40 },
  { key: 'goals45', text: 'Score 45 league goals', pts: 40 },
  { key: 'unbeaten6', text: 'Go six league games unbeaten', pts: 35 },
  { key: 'homegrown', text: 'Give league minutes to three academy graduates', pts: 35 },
];
const CASH = [40_000, 25_000, 15_000, 8_000];

function ensure(world) {
  world.challenges = world.challenges || { weekly: null, season: [], points: 0, completed: 0, history: [] };
  return world.challenges;
}

function setWeekly(world, week, cx) {
  const ch = ensure(world);
  if (!cx) { ch.weekly = null; return null; }
  const pool = WEEKLY.filter(t => !t.when || t.when(cx));
  const t = pool[hashString(`wk:${world.season}:${week}:${world.manager.clubId}`) % pool.length];
  const cash = CASH[clamp(world.club().division, 1, 4) - 1];
  ch.weekly = { key: t.key, text: t.text, pts: t.pts, cash, season: world.season, week, status: 'open' };
  return ch.weekly;
}

function settleWeekly(world, report) {
  const ch = ensure(world);
  const w = ch.weekly;
  if (!w || w.status !== 'open' || w.season !== world.season || w.week !== world.weekState?.week) return null;
  if (!report || !report.result) { w.status = 'void'; return null; }
  const t = WEEKLY.find(x => x.key === w.key);
  const ok = t.test(report, world);
  w.status = ok ? 'done' : 'failed';
  if (ok) reward(world, w);
  ch.history = [{ ...w }, ...ch.history].slice(0, 20);
  return w;
}

// Match XP: every game you manage moves you towards the next manager level, so each result
// counts for something. Wins in a row add a growing streak bonus (capped at five).
function matchXp(world, report) {
  const ch = ensure(world);
  if (!report || !report.result || !report.myKey) return null;
  const home = report.myKey === 'home', gf = home ? report.hg : report.ag, ga = home ? report.ag : report.hg;
  const parts = [['Match played', 3]];
  if (report.result === 'W') parts.push(['Win', 10]); else if (report.result === 'D') parts.push(['Draw', 4]);
  if (gf > 0) parts.push([`${Math.min(gf, 5)} goal${gf > 1 ? 's' : ''} scored`, Math.min(gf, 5)]);
  if (ga === 0) parts.push(['Clean sheet', 4]);
  if (gf - ga >= 3) parts.push(['Big win', 5]);
  ch.streak = report.result === 'W' ? (ch.streak || 0) + 1 : 0;
  ch.unbeaten = report.result === 'L' ? 0 : (ch.unbeaten || 0) + 1;
  ch.bestStreak = Math.max(ch.bestStreak || 0, ch.streak);
  if (ch.streak >= 2) parts.push([`🔥 ${ch.streak} wins in a row`, 2 * Math.min(ch.streak, 5)]);
  const motm = report.motm && report.ratings && report.ratings[report.myKey].some(x => x.playerId === report.motm.playerId);
  if (motm) parts.push(['Man of the match is yours', 2]);
  const xp = parts.reduce((t, [, n]) => t + n, 0);
  ch.points += xp;
  return { xp, parts, streak: ch.streak, unbeaten: ch.unbeaten, best: ch.bestStreak };
}

function reward(world, c) {
  const ch = ensure(world);
  ch.points += c.pts;
  ch.completed++;
  if (c.cash) post(world.club(), 'Challenge prize', c.cash, c.text);
}

function startSeason(world) {
  const ch = ensure(world);
  const me = world.club();
  const pool = SEASON.filter(t => !(t.key === 'cup_qf' && !world.cups.some(c => c.country === me.country)));
  const h = hashString(`season:${world.season}:${me.id}`);
  const picked = [];
  for (let i = 0; picked.length < 3 && i < pool.length * 2; i++) { const t = pool[(h + i * 7) % pool.length]; if (!picked.includes(t)) picked.push(t); }
  const cash = CASH[clamp(me.division, 1, 4) - 1] * 3;
  ch.season = picked.map(t => ({ key: t.key, text: t.text, pts: t.pts, cash, season: world.season, status: 'open', startBalance: Math.round(me.finance.balance) }));
  me.unbeatenRun = 0;
}

// Mid-season checks after each week (cup run, unbeaten run, homegrown minutes, goals).
function weeklySeason(world, reports) {
  const ch = ensure(world);
  const me = world.club();
  const done = [];
  for (const r of reports.filter(x => x.myKey && x.comp === 'league')) me.unbeatenRun = r.result === 'L' ? 0 : (me.unbeatenRun || 0) + 1;
  for (const c of ch.season) {
    if (c.status !== 'open' || c.season !== world.season) continue;
    let ok = false;
    if (c.key === 'unbeaten6') ok = (me.unbeatenRun || 0) >= 6;
    else if (c.key === 'cup_qf') { const cup = world.cups.find(x => x.country === me.country); ok = !!cup && cup.round >= 3 && (cup.rounds[cup.round]?.ties || []).some(t => t.h === me.id || t.a === me.id); }
    else if (c.key === 'homegrown') ok = me.squad.filter(p => p.homegrownClubId === me.id && p.seasonStats.minutes > 0).length >= 3;
    else if (c.key === 'goals45') { const row = world.league().table.find(x => x.clubId === me.id); ok = !!row && row.gf >= 45; }
    if (ok) { c.status = 'done'; reward(world, c); done.push(c); }
  }
  return done;
}

function endSeason(world, pos, size) {
  const ch = ensure(world);
  const me = world.club();
  const done = [];
  for (const c of ch.season) {
    if (c.status !== 'open') continue;
    let ok = false;
    if (c.key === 'top_half') ok = pos <= Math.ceil(size / 2);
    else if (c.key === 'profit') ok = me.finance.balance > c.startBalance;
    c.status = ok ? 'done' : 'failed';
    if (ok) { reward(world, c); done.push(c); }
    ch.history = [{ ...c }, ...ch.history].slice(0, 20);
  }
  return done;
}

function score(world) {
  const ch = ensure(world);
  const seasons = world.managerHistory || [];
  const promotions = seasons.filter(s => s.promotion).length;
  const topFlight = seasons.filter(s => s.division === 1).length;
  const ach = Object.keys(world.achievements || {}).length;
  return Math.max(0, Math.round(world.manager.trophies * 150 + promotions * 80 + topFlight * 30 + ach * 25 + ch.points + world.manager.reputation * 4 + seasons.length * 10 - (world.manager.sacks || 0) * 40));
}

// Manager level from the score: each level needs 25% more than the last. A new title every 3 levels.
const TITLES = ['Rookie', 'Apprentice', 'Coach', 'Tactician', 'Gaffer', 'Mastermind', 'Legend'];
function level(points) {
  let lvl = 1, need = 120, base = 0;
  while (points >= base + need && lvl < 60) { base += need; lvl++; need = Math.round(need * 1.25); }
  return { level: lvl, title: TITLES[Math.min(TITLES.length - 1, Math.floor((lvl - 1) / 3))], xp: points - base, next: need, pct: Math.round((points - base) / need * 100) };
}

// Challenge code: GAF-<seed base36>-<country index><club index | Z for a created club>
function encodeCode(seed, countryIdx, clubIdx) {
  return `GAF-${(seed >>> 0).toString(36).toUpperCase()}-${countryIdx.toString(36).toUpperCase()}${clubIdx == null ? 'Z' : clubIdx.toString(36).toUpperCase()}`;
}
function decodeCode(code) {
  const m = /^GAF-([0-9A-Z]+)-([0-9A-Z])([0-9A-Z])$/i.exec(String(code || '').trim());
  if (!m) return null;
  const club = m[3].toUpperCase();
  return { seed: parseInt(m[1], 36) >>> 0, countryIdx: parseInt(m[2], 36), clubIdx: club === 'Z' ? null : parseInt(club, 36) };
}

module.exports = { matchXp, setWeekly, settleWeekly, startSeason, weeklySeason, endSeason, score, level, encodeCode, decodeCode, ensure, WEEKLY, SEASON };
