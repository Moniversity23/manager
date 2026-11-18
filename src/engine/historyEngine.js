// src/engine/historyEngine.js — the football world's permanent record.
//
// Nothing here is ever overwritten when a season ends: each season is archived under its own key
// and everything points at stable ids (club ids, player ids, league ids). What is kept:
//   archive.seasons[s]   final table of every league (with promotion/relegation flags and the
//                        club's closing balance), every honour won (league, cup, continental,
//                        Nations League, World Nations Cup) and every award, with player ids.
//   archive.clubNames    the last name of every club id (clubs voted out still resolve).
//   archive.matches      every match you managed: lineups, scorers, assists, cards, subs, stats.
//   archive.stints       your managerial career: club, dates, W/D/L, goals, honours, promotions.
//   archive.changes      managerial changes at every club (sackings and appointments).
//   archive.retired      notable players after they retire (career, moves, honours, appearance).
// On each player (saved with him):
//   p.career   one row per season he played: [season, clubId, apps, subApps, goals, assists,
//              yellows, reds, cleanSheets, injuries, minutes, avgRating×10, onLoan]
//   p.moves    [season, week, fromClubId, toClubId, fee, kind]  kind: T transfer, F free,
//              L loan out, R back from loan, X released, Y promoted from the academy
//   p.honours  [season, code, label]  L league title, C cup, K continental, P player of the
//              season, B golden boot, Y young player, G golden glove, GB/WB/WY world awards, T team of the year

const CAREER = { s: 0, club: 1, apps: 2, sub: 3, goals: 4, assists: 5, yel: 6, red: 7, cs: 8, inj: 9, mins: 10, rating: 11, loan: 12 };

function ensure(world) {
  const a = world.archive || (world.archive = {});
  a.seasons = a.seasons || {};
  a.clubNames = a.clubNames || {};
  a.matches = a.matches || [];
  a.matchSeq = a.matchSeq || 0;
  a.stints = a.stints || [];
  a.changes = a.changes || [];
  a.retired = a.retired || {};
  return a;
}

const nameOf = (world, id) => (id == null ? 'Free agency' : (world.clubById(id) || {}).name || ensure(world).clubNames[id] || `Club ${id}`);

// ── players ────────────────────────────────────────────────────────
function move(world, p, fromId, toId, fee, kind) {
  if (!p) return;
  p.moves = p.moves || [];
  p.moves.push([world.season, world.currentWeek || 0, fromId ?? null, toId ?? null, Math.round(fee || 0), kind]);
}
function honour(p, season, code, label) {
  if (!p) return;
  p.honours = p.honours || [];
  if (!p.honours.some(h => h[0] === season && h[1] === code && h[2] === label)) p.honours.push([season, code, label]);
}
function careerTotals(rows) {
  const t = { seasons: rows.length, apps: 0, sub: 0, goals: 0, assists: 0, yel: 0, red: 0, cs: 0, inj: 0, mins: 0 };
  for (const r of rows) { t.apps += r[2]; t.sub += r[3]; t.goals += r[4]; t.assists += r[5]; t.yel += r[6]; t.red += r[7]; t.cs += r[8]; t.inj += r[9]; t.mins += r[10]; }
  return t;
}

// A retiring player is kept when his career is worth looking up later.
function retire(world, p) {
  const a = ensure(world);
  const rows = p.career || [];
  const tot = careerTotals(rows);
  const mine = new Set(a.stints.map(s => s.clubId));
  if (world.manager.ownedClubId) mine.add(world.manager.ownedClubId);
  const notable = tot.apps + tot.sub >= 120 || (p.honours || []).some(h => !['L', 'C', 'K'].includes(h[1])) || rows.some(r => mine.has(r[1])) || (p.moves || []).some(m => m[4] >= 1_000_000);
  if (!notable) return false;
  a.retired[p.id] = { id: p.id, name: p.name, nation: p.nation, position: p.position, age: p.age, retiredSeason: world.season, lastClubId: p.clubId ?? null,
    ability: Math.round(p.currentAbility), look: p.look || null, career: rows, moves: p.moves || [], honours: p.honours || [], caps: (p.history || {}).caps || 0 };
  return true;
}

// ── managers ───────────────────────────────────────────────────────
function openStint(world, clubId) {
  const a = ensure(world);
  const cur = a.stints[a.stints.length - 1];
  if (cur && !cur.to && cur.clubId === clubId) return cur;
  if (cur && !cur.to) cur.to = [world.season, world.currentWeek || 0];
  const st = { clubId, club: nameOf(world, clubId), from: [world.season, world.currentWeek || 0], to: null, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, honours: [], promotions: 0, relegations: 0, how: null };
  a.stints.push(st);
  return st;
}
function closeStint(world, how) {
  const a = ensure(world);
  const cur = a.stints[a.stints.length - 1];
  if (cur && !cur.to) { cur.to = [world.season, world.currentWeek || 0]; cur.how = how; }
}
function managerChange(world, club, out, inn, why) {
  ensure(world).changes.push([world.season, world.currentWeek || 0, club.id, out || '', inn || '', why || '']);
}

// ── matches you managed ────────────────────────────────────────────
function recordMatch(world, rep) {
  if (!rep || !rep.myKey) return;
  const a = ensure(world);
  const me = rep.myKey === 'home' ? rep.homeId : rep.awayId;
  const st = openStint(world, me);
  const gf = rep.myKey === 'home' ? rep.hg : rep.ag, ga = rep.myKey === 'home' ? rep.ag : rep.hg;
  st.p++; st.gf += gf; st.ga += ga;
  if (rep.result === 'W') st.w++; else if (rep.result === 'L') st.l++; else st.d++;
  const xi = side => ((rep.lineups || {})[side] || []).map(l => [l.playerId, l.name, l.slot]);
  const rt = side => ((rep.ratings || {})[side] || []).map(r => [r.playerId, Math.round(r.rating * 10)]);
  a.matches.push({ id: ++a.matchSeq, s: rep.season, w: rep.week, c: rep.compName, h: rep.homeId, a: rep.awayId, hn: rep.home, an: rep.away,
    hg: rep.hg, ag: rep.ag, pens: rep.pens || null, x: [rep.hx, rep.ax], sh: [rep.hs, rep.as], pos: rep.pos, mk: rep.myKey, r: rep.result,
    f: rep.formations ? [rep.formations.home, rep.formations.away] : null,
    ev: (rep.events || []).filter(e => e.type !== 'shot').map(e => [e.min, e.type, e.side === 'home' ? 0 : 1, e.text]),
    xi: [xi('home'), xi('away')], rt: [rt('home'), rt('away')], motm: rep.motm ? rep.motm.name : null });
}

// ── the end of a season ────────────────────────────────────────────
// Called once, after awards, promotion/relegation and the international season, and before
// loans end and players age (so the season's numbers and clubs are still in place).
function archiveSeason(world, finalTables, moves, extra = {}) {
  const a = ensure(world);
  const s = world.season;
  const flag = new Map();
  for (const m of moves || []) flag.set(m.clubId, m.type === 'promoted' ? (m.via === 'play-offs' ? 'PO' : 'P') : 'R');
  for (const c of world.clubs) a.clubNames[c.id] = c.name;
  const leagues = {};
  const honours = [];
  const awards = [];
  for (const lg of world.leagues) {
    const rows = finalTables.get(lg.id) || [];
    if (!rows.length) continue;
    const squadOf = id => (world.clubById(id) || { squad: [] }).squad.filter(p => !p.retired);
    // Leading scorer and the keeper with the most clean sheets (10+ starts).
    let top = null, glove = null;
    for (const r of rows) for (const p of squadOf(r.clubId)) {
      if (p.seasonStats.goals > 0 && (!top || p.seasonStats.goals > top.p.seasonStats.goals)) top = { p, clubId: r.clubId };
      if (p.position === 'GK' && p.seasonStats.apps >= 10 && (!glove || (p.seasonStats.cs || 0) > (glove.p.seasonStats.cs || 0))) glove = { p, clubId: r.clubId };
    }
    leagues[lg.id] = { name: lg.name, country: lg.country, level: lg.level,
      rows: rows.map((r, i) => [r.clubId, r.p, r.w, r.d, r.l, r.gf, r.ga, r.pts, i === 0 ? 'C' : (flag.get(r.clubId) || ''), Math.round((world.clubById(r.clubId) || { finance: { balance: 0 } }).finance.balance)]),
      top: top ? [top.p.id, top.p.name, top.clubId, top.p.seasonStats.goals] : null,
      glove: glove ? [glove.p.id, glove.p.name, glove.clubId, glove.p.seasonStats.cs || 0] : null };
    const champ = rows[0], second = rows[1];
    honours.push({ k: `L${lg.id}`, comp: `${lg.country} ${lg.name}`, level: lg.level, winner: champ.clubId, runnerUp: second ? second.clubId : null });
    for (const p of squadOf(champ.clubId)) if (p.seasonStats.apps + p.seasonStats.subApps > 0) honour(p, s, 'L', `${lg.country} ${lg.name}`);
    if (glove) { honour(glove.p, s, 'G', `${lg.country} ${lg.name}`); awards.push({ k: 'G', comp: `L${lg.id}`, id: glove.p.id, name: glove.p.name, clubId: glove.clubId, n: glove.p.seasonStats.cs || 0 }); }
  }
  // Cups and continental competitions
  for (const w of (world.history.cupWinners || []).filter(x => x.season === s)) {
    const cup = (world.cups || []).find(c => c.name === w.cup);
    honours.push({ k: `C${w.cup}`, comp: w.cup, winner: w.clubId, runnerUp: cup ? cup.runnerUp : null });
    for (const p of (world.clubById(w.clubId) || { squad: [] }).squad) honour(p, s, 'C', w.cup);
  }
  for (const w of (world.history.continentalWinners || []).filter(x => x.season === s)) {
    const comp = (world.continental || []).find(c => c.name === w.comp);
    honours.push({ k: `K${w.comp}`, comp: w.comp, winner: w.clubId, runnerUp: comp ? comp.runnerUp : null });
    for (const p of (world.clubById(w.clubId) || { squad: [] }).squad) honour(p, s, 'K', w.comp);
  }
  for (const w of ((world.intl || {}).winners || []).filter(x => x.season === s)) honours.push({ k: 'N', comp: w.comp || 'Nations League', nation: w.winner, runnerUpNation: w.runnerUp });
  if (extra.wnc) honours.push({ k: 'W', comp: 'World Nations Cup', nation: extra.wnc.winner, runnerUpNation: extra.wnc.runnerUp });
  // Awards (league and world)
  const byName = new Map();
  for (const lg of world.leagues) for (const r of finalTables.get(lg.id) || []) for (const p of (world.clubById(r.clubId) || { squad: [] }).squad) byName.set(`${p.name}|${(world.clubById(r.clubId) || {}).name}`, p);
  for (const aw of (world.history.awards || []).filter(x => x.season === s)) {
    const find = (x) => x ? byName.get(`${x.name}|${x.club}`) : null;
    for (const [k, x, n] of [['P', aw.playerOfSeason], ['B', aw.goldenBoot, aw.goldenBoot && aw.goldenBoot.goals], ['Y', aw.youngPlayer]]) {
      if (!x) continue;
      const p = find(x);
      if (p) honour(p, s, k, aw.league);
      awards.push({ k, comp: `L${aw.leagueId}`, id: p ? p.id : null, name: x.name, clubId: p ? p.clubId : null, club: x.club, n: n ?? null });
    }
  }
  const gb = (world.history.goldenBall || []).find(x => x.season === s);
  if (gb) {
    const add = (k, x, n) => { if (!x) return; honour(world.players.get(x.id), s, k, 'World'); awards.push({ k, comp: 'world', id: x.id, name: x.name, clubId: x.clubId, club: x.club, n: n ?? null }); };
    add('GB', gb.winner); add('WB', gb.goldenBoot, gb.goldenBoot && gb.goldenBoot.goals); add('WY', gb.goldenBoy);
    for (const x of gb.team || []) honour(world.players.get(x.id), s, 'T', 'World team of the year');
    awards.push({ k: 'TEAM', comp: 'world', team: (gb.team || []).map(x => [x.id, x.name, x.position, x.clubId]) });
  }
  // Every player's season line
  for (const p of world.players.values()) {
    const ss = p.seasonStats;
    if (!ss || ss.apps + (ss.subApps || 0) === 0) continue;
    p.career = p.career || [];
    if (p.career.some(r => r[0] === s)) continue;
    p.career.push([s, p.clubId ?? null, ss.apps, ss.subApps || 0, ss.goals, ss.assists, ss.yellows || 0, ss.reds || 0, ss.cs || 0, ss.inj || 0, ss.minutes || 0, ss.rn ? Math.round(ss.rs / ss.rn * 10) : 0, p.loan && p.loan.parentClubId !== p.clubId ? 1 : 0]);
  }
  // Your stint: honours, promotions and relegations
  const st = a.stints[a.stints.length - 1];
  if (st && !st.to) {
    for (const h of honours) if (h.winner === st.clubId) st.honours.push([s, h.comp]);
    const mv = (moves || []).find(m => m.clubId === st.clubId);
    if (mv && mv.type === 'promoted') st.promotions++;
    if (mv && mv.type === 'relegated') st.relegations++;
  }
  a.seasons[s] = { label: `${s}/${s + 1}`, leagues, honours, awards };
  return a.seasons[s];
}

// Clubs voted out at re-election: mark them in the season just archived.
function markReElection(world, season, regional) {
  const a = ensure(world), rec = a.seasons[season];
  if (!rec) return;
  const out = new Set((regional || []).flatMap(r => r.out || []));
  for (const lg of Object.values(rec.leagues)) for (const row of lg.rows) if (out.has(a.clubNames[row[0]])) row[8] = row[8] ? row[8] + 'E' : 'E';
}

module.exports = { CAREER, ensure, nameOf, move, honour, careerTotals, retire, openStint, closeStint, managerChange, recordMatch, archiveSeason, markReElection };
