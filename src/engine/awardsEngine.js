// src/engine/awardsEngine.js — season awards, the club records book and achievements.

const ACHIEVEMENTS = {
  first_win: { name: 'Off the mark', text: 'Win your first match.' },
  five_goals: { name: 'Goal fest', text: 'Score five or more in a match.' },
  promotion: { name: 'Going up', text: 'Win promotion.' },
  title: { name: 'Champions', text: 'Win a league title.' },
  cup: { name: 'Cup winners', text: 'Win your national cup.' },
  giant_killer: { name: 'Giant killer', text: 'Knock a club two or more divisions above you out of the cup.' },
  continental: { name: 'Kings of the continent', text: 'Win a continental competition.' },
  top_flight: { name: 'The big time', text: 'Reach the top division.' },
  unbeaten: { name: 'Invincibles', text: 'Go a whole league season unbeaten.' },
  big_sale: { name: 'Shrewd business', text: 'Sell a player for 10 times what you paid (or $500K+ for an academy graduate).' },
  academy_star: { name: 'Home grown', text: 'An academy graduate makes 20 league starts in a season.' },
  millionaire: { name: 'Money in the bank', text: 'Reach a $10M balance.' },
  pro_licence: { name: 'Fully licensed', text: 'Earn the Pro Licence.' },
  owner: { name: 'Tycoon', text: 'Own a second club.' },
  survivor: { name: 'Great escape', text: 'Avoid relegation after being bottom at week 20.' },
};

function unlock(world, id) {
  world.achievements = world.achievements || {};
  if (world.achievements[id] || !ACHIEVEMENTS[id]) return false;
  world.achievements[id] = { season: world.season, week: world.currentWeek };
  world.notify('achievement', `🏅 Achievement unlocked: ${ACHIEVEMENTS[id].name} — ${ACHIEVEMENTS[id].text}`);
  return true;
}

function records(world, clubId) {
  world.records = world.records || {};
  if (!world.records[clubId]) world.records[clubId] = {};
  return world.records[clubId];
}

// After any match involving a club whose records we keep (the manager's and the owned club).
function recordMatch(world, clubId, r, attendance, compName) {
  const rec = records(world, clubId);
  const home = r.h === clubId;
  const gf = home ? r.hg : r.ag, ga = home ? r.ag : r.hg;
  const opp = world.clubById(home ? r.a : r.h)?.name || '?';
  const label = { score: `${gf}–${ga}`, opponent: opp, comp: compName, season: world.season };
  if (gf - ga > 0 && (!rec.biggestWin || gf - ga > rec.biggestWin.margin || (gf - ga === rec.biggestWin.margin && gf > rec.biggestWin.gf))) rec.biggestWin = { ...label, margin: gf - ga, gf };
  if (ga - gf > 0 && (!rec.heaviestDefeat || ga - gf > rec.heaviestDefeat.margin)) rec.heaviestDefeat = { ...label, margin: ga - gf };
  if (home && attendance && (!rec.attendance || attendance > rec.attendance.value)) rec.attendance = { value: attendance, opponent: opp, season: world.season };
  if (clubId === world.manager.clubId) {
    if (gf > ga) unlock(world, 'first_win');
    if (gf >= 5) unlock(world, 'five_goals');
  }
}

function recordTransfer(world, p, fromClub, toClub, fee) {
  for (const [club, key] of [[toClub, 'recordSigning'], [fromClub, 'recordSale']]) {
    if (!club || !fee || !(club.id === world.manager.clubId || club.id === world.manager.ownedClubId)) continue;
    const rec = records(world, club.id);
    if (!rec[key] || fee > rec[key].fee) rec[key] = { name: p.name, fee, season: world.season, other: (key === 'recordSale' ? toClub : fromClub)?.name || 'free agency' };
  }
  if (fromClub && fromClub.id === world.manager.clubId && fee > 0) {
    if ((p.lastFee > 0 && fee >= p.lastFee * 10) || (p.homegrownClubId === fromClub.id && fee >= 500_000)) unlock(world, 'big_sale');
  }
}

// Season-end awards for every league + season records for the manager's club.
function seasonAwards(world, finalTables) {
  const out = [];
  for (const lg of world.leagues) {
    const players = finalTables.get(lg.id).flatMap(r => world.clubById(r.clubId).squad.map(p => ({ p, club: world.clubById(r.clubId) })));
    if (!players.length) continue;
    const by = f => players.slice().sort((a, b) => f(b) - f(a) || a.p.id - b.p.id)[0];
    const boot = by(x => x.p.seasonStats.goals * 100 + x.p.seasonStats.assists);
    const pots = by(x => x.p.seasonStats.goals * 3 + x.p.seasonStats.assists * 2 + x.p.currentAbility * 0.6 + x.p.seasonStats.apps * 0.5);
    const young = by(x => (x.p.age <= 21 ? 1000 : 0) + x.p.currentAbility + x.p.seasonStats.apps * 0.3);
    const a = {
      season: world.season, league: `${lg.country} ${lg.name}`, leagueId: lg.id,
      goldenBoot: { name: boot.p.name, club: boot.club.name, goals: boot.p.seasonStats.goals },
      playerOfSeason: { id: pots.p.id, name: pots.p.name, club: pots.club.name, clubId: pots.club.id, goals: pots.p.seasonStats.goals, assists: pots.p.seasonStats.assists, apps: pots.p.seasonStats.apps },
      youngPlayer: young.p.age <= 21 ? { name: young.p.name, club: young.club.name, age: young.p.age } : null,
    };
    out.push(a);
    for (const x of [boot, pots]) x.p.history.awards = (x.p.history.awards || 0) + 1;
  }
  world.history.awards = (world.history.awards || []).concat(out);
  if (world.history.awards.length > 400) world.history.awards.splice(0, world.history.awards.length - 400);
  const me = world.club();
  const rec = records(world, me.id);
  for (const p of me.squad) {
    if (p.seasonStats.goals > 0 && (!rec.seasonScorer || p.seasonStats.goals > rec.seasonScorer.goals)) rec.seasonScorer = { name: p.name, goals: p.seasonStats.goals, season: world.season };
    if (p.homegrownClubId === me.id && p.seasonStats.apps >= 20) unlock(world, 'academy_star');
  }
  return out.find(a => a.leagueId === world.league().id);
}

// ── World awards: the Golden Ball (best player in the world's top divisions) ──
const GROUP = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', CDM: 'MID', CM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT', CF: 'ATT' };
function seasonScore(p, bonus = 0) {
  const s = p.seasonStats;
  const def = GROUP[p.position] === 'GK' || GROUP[p.position] === 'DEF';
  return s.goals * 4 + s.assists * 2.5 + s.apps * (def ? 0.9 : 0.5) + p.currentAbility * 0.55 - (s.reds || 0) * 2 + bonus;
}
function candidates(world, leagues, bonusClubs = new Map()) {
  const out = [];
  for (const lg of leagues) for (const id of lg.clubIds) {
    const club = world.clubById(id);
    for (const p of club.squad) if (!p.retired && p.seasonStats.apps > 0) out.push({ p, club, score: seasonScore(p, bonusClubs.get(id) || 0) });
  }
  return out.sort((a, b) => b.score - a.score || a.p.id - b.p.id);
}
const row = x => ({ id: x.p.id, name: x.p.name, club: x.club.name, clubId: x.club.id, nation: x.p.nation, position: x.p.position, age: x.p.age,
  goals: x.p.seasonStats.goals, assists: x.p.seasonStats.assists, apps: x.p.seasonStats.apps, points: Math.round(x.score) });

// Live standings during the season: the world race and the race in the manager's own league.
function race(world) {
  const top = world.leagues.filter(l => l.level === 1);
  return { world: candidates(world, top).slice(0, 10).map(row), league: candidates(world, [world.league()]).slice(0, 5).map(row) };
}

// Season end: Golden Ball top ten, world Golden Boot, Golden Boy (21 or under), Team of the Season.
function worldAwards(world, finalTables, continentalWinners = []) {
  const top = world.leagues.filter(l => l.level === 1);
  const bonus = new Map();
  for (const lg of top) { const rows = finalTables.get(lg.id); if (rows && rows[0]) bonus.set(rows[0].clubId, 8); }
  for (const id of continentalWinners) bonus.set(id, (bonus.get(id) || 0) + 10);
  const list = candidates(world, top, bonus);
  if (!list.length) return null;
  const boot = list.slice().sort((a, b) => b.p.seasonStats.goals - a.p.seasonStats.goals || b.score - a.score)[0];
  const young = list.find(x => x.p.age <= 21) || null;
  const pick = (g, n) => list.filter(x => GROUP[x.p.position] === g).slice(0, n).map(row);
  const award = { season: world.season, winner: row(list[0]), top: list.slice(0, 10).map(row), goldenBoot: row(boot), goldenBoy: young ? row(young) : null,
    team: [...pick('GK', 1), ...pick('DEF', 4), ...pick('MID', 3), ...pick('ATT', 3)] };
  list[0].p.history.awards = (list[0].p.history.awards || 0) + 1;
  list[0].p.history.goldenBalls = (list[0].p.history.goldenBalls || 0) + 1;
  world.history.goldenBall = [...(world.history.goldenBall || []), award].slice(-20);
  return award;
}

module.exports = { ACHIEVEMENTS, unlock, recordMatch, recordTransfer, seasonAwards, records, race, worldAwards, seasonScore };
