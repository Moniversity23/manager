// src/engine/newsEngine.js — the world's newspaper (separate from the manager's inbox).
//
// Headlines for big transfers, your matches, title races, relegation fights, cup giant-killings,
// continental and international results, AI managers sacked, champions, promotions, regional
// re-election, wonderkids and records. Template choice uses a hash, never the RNG, so the paper
// never changes the simulation.

const { hashString } = require('../utils');

const KEEP = 160;
const pick = (key, arr) => arr[hashString(key) % arr.length];
const money = n => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);

function add(world, item) {
  world.news = world.news || [];
  world.newsSeq = (world.newsSeq || 0) + 1;
  world.news.push({ id: world.newsSeq, season: world.season, week: item.week ?? world.currentWeek, scope: 'world', ...item });
  if (world.news.length > KEEP) world.news.splice(0, world.news.length - KEEP);
}

function scopeFor(world, clubIds) {
  const me = world.club();
  if (clubIds.includes(me.id)) return 'club';
  const lg = world.league();
  if (clubIds.some(id => lg.clubIds.includes(id))) return 'league';
  if (clubIds.some(id => world.clubById(id)?.country === me.country)) return 'nation';
  return 'world';
}

function transfer(world, p, from, to, fee) {
  if (!to || !fee) return;
  const ids = [to.id, from ? from.id : null].filter(x => x != null);
  const scope = scopeFor(world, ids);
  const big = fee >= 2_000_000 || (fee >= 300_000 && scope !== 'world');
  if (!big) return;
  const key = `tr:${p.id}:${world.season}:${world.currentWeek}`;
  const headline = pick(key, [
    `${to.name} land ${p.name} for ${money(fee)}`,
    `Done deal: ${p.name} joins ${to.name}`,
    `${money(fee)} move takes ${p.name} to ${to.name}`,
    `${to.name} break the bank for ${p.name}`,
  ]);
  add(world, { kind: 'transfer', scope, clubIds: ids, headline, text: `${p.name} (${p.age}, ${p.position}) moves from ${from ? from.name : 'free agency'} to ${to.name} for ${money(fee)}.` });
}

function myMatch(world, r) {
  if (!r || !r.result) return;
  const me = world.club();
  const myGoals = r.myKey === 'home' ? r.hg : r.ag, theirs = r.myKey === 'home' ? r.ag : r.hg;
  const opp = r.myKey === 'home' ? r.away : r.home;
  const key = `mm:${world.season}:${r.week}:${r.comp}`;
  const score = `${myGoals}–${theirs}`;
  let headline;
  if (r.result === 'W' && myGoals - theirs >= 3) headline = pick(key, [`${me.name} run riot against ${opp}`, `Rampant ${me.name} hit ${opp} for ${myGoals}`, `${opp} swept aside by ${me.name}`]);
  else if (r.result === 'W') headline = pick(key, [`${me.name} edge past ${opp}`, `${me.name} beat ${opp} ${score}`, `Three points for ${me.name}`]);
  else if (r.result === 'D') headline = pick(key, [`${me.name} held by ${opp}`, `Honours even: ${me.name} ${score} ${opp}`, `Stalemate for ${me.name}`]);
  else headline = pick(key, [`${opp} sink ${me.name}`, `Setback for ${me.name} against ${opp}`, `${me.name} beaten ${theirs}–${myGoals} by ${opp}`]);
  const scorers = r.events.filter(e => e.type === 'goal' && e.side === r.myKey).map(e => e.text.replace(/^⚽\s*/, '').replace(/\s*\(assist.*\)$/, ''));
  add(world, { kind: 'match', scope: 'club', clubIds: [me.id], headline, text: `${r.compName}: ${r.home} ${r.hg}–${r.ag} ${r.away}.${scorers.length ? ` Scorers: ${scorers.join(', ')}.` : ''}` });
}

// Weekly round-up from the leagues: leaders, races, big wins, cup upsets.
function weekly(world, week, cupUpsets) {
  const me = world.club();
  const lg = world.league();
  const rows = lg.sorted();
  if (rows.length && week <= lg.schedule.length) {
    const leader = world.clubById(rows[0].clubId);
    const prevLeader = world.flags.leader && world.flags.leader[lg.id];
    world.flags.leader = { ...(world.flags.leader || {}), [lg.id]: leader.id };
    if (prevLeader && prevLeader !== leader.id && week > 3) add(world, { kind: 'league', scope: scopeFor(world, [leader.id]), clubIds: [leader.id], headline: pick(`top:${week}:${leader.id}`, [`${leader.name} go top of ${lg.name}`, `New leaders: ${leader.name}`, `${leader.name} take over at the summit`]), text: `${leader.name} lead ${lg.name} on ${rows[0].pts} points after week ${week}.` });
    if (week >= 24 && week % 3 === 0 && rows[1] && rows[0].pts - rows[1].pts <= 3) {
      const second = world.clubById(rows[1].clubId);
      add(world, { kind: 'league', scope: scopeFor(world, [leader.id, second.id]), clubIds: [leader.id, second.id], headline: `Title race: ${leader.name} and ${second.name} neck and neck`, text: `Just ${rows[0].pts - rows[1].pts} point${rows[0].pts - rows[1].pts === 1 ? '' : 's'} separate the top two in ${lg.name}.` });
    }
    // Biggest win of the round in your league.
    const last = lg.results.filter(r => r.week === week || r.id?.includes(`-${week}-`));
    const big = last.slice().sort((a, b) => Math.abs(b.hg - b.ag) - Math.abs(a.hg - a.ag))[0];
    if (big && Math.abs(big.hg - big.ag) >= 4 && big.h !== me.id && big.a !== me.id) {
      const w = world.clubById(big.hg > big.ag ? big.h : big.a), l = world.clubById(big.hg > big.ag ? big.a : big.h);
      add(world, { kind: 'league', scope: 'league', clubIds: [w.id, l.id], headline: pick(`bw:${week}`, [`${w.name} thrash ${l.name}`, `${l.name} humiliated by ${w.name}`]), text: `${world.clubById(big.h).name} ${big.hg}–${big.ag} ${world.clubById(big.a).name}.` });
    }
  }
  for (const u of cupUpsets || []) add(world, { kind: 'cup', scope: scopeFor(world, [u.winnerId, u.loserId]), clubIds: [u.winnerId, u.loserId], headline: pick(`up:${u.winnerId}:${week}`, [`Giant-killing! ${u.winner} knock out ${u.loser}`, `Cup shock as ${u.winner} topple ${u.loser}`, `${u.loser} red-faced after ${u.winner} upset`]), text: `${u.cup}: division ${u.winnerDiv} ${u.winner} beat division ${u.loserDiv} ${u.loser} ${u.score}.` });
}

function sacking(world, club, managerName) {
  add(world, { kind: 'sacking', scope: scopeFor(world, [club.id]), clubIds: [club.id], headline: pick(`sk:${club.id}:${world.season}`, [`${club.name} sack ${managerName}`, `${managerName} dismissed by ${club.name}`, `Axe falls at ${club.name}`]), text: `${club.name} parted company with ${managerName} after a poor run. The job is now open in the Job Centre.` });
}

function international(world, played) {
  for (const g of played || []) {
    const key = `in:${world.season}:${g.h}:${g.a}`;
    const w = g.winner || (g.hg > g.ag ? g.h : g.hg < g.ag ? g.a : null);
    const mine = [g.h, g.a].includes(world.club().country);
    const headline = g.comp.includes('final') ? `${w} win the Nations League` : w ? pick(key, [`${w} beat ${w === g.h ? g.a : g.h} ${Math.max(g.hg, g.ag)}–${Math.min(g.hg, g.ag)}`, `${w} too strong for ${w === g.h ? g.a : g.h}`]) : `${g.h} and ${g.a} share the points`;
    add(world, { kind: 'international', scope: mine ? 'nation' : 'world', clubIds: [], headline, text: `${g.comp}: ${g.h} ${g.hg}–${g.ag} ${g.a}${g.pens ? ` (${g.pens.home}–${g.pens.away} pens)` : ''}.${g.scorers && g.scorers.length ? ` Goals: ${g.scorers.map(s => s.name).join(', ')}.` : ''}` });
  }
}

function story(world, kind, headline, text, clubIds = [], scope = null) {
  add(world, { kind, scope: scope || scopeFor(world, clubIds), clubIds, headline, text });
}

function feed(world, filter = 'all') {
  const items = (world.news || []).slice().reverse();
  if (filter === 'all') return items.slice(0, 80);
  if (filter === 'transfers') return items.filter(n => n.kind === 'transfer').slice(0, 80);
  const order = { club: ['club'], league: ['club', 'league'], nation: ['club', 'league', 'nation'] }[filter];
  return order ? items.filter(n => order.includes(n.scope)).slice(0, 80) : items.slice(0, 80);
}

module.exports = { add, transfer, myMatch, weekly, sacking, international, story, feed };
