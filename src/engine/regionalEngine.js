// src/engine/regionalEngine.js — re-election at the foot of each pyramid.
//
// The bottom two clubs of every nation's lowest division drop out into regional football and are
// replaced by two newly generated regional champions (fresh fictional names, weaker squads, small
// stadiums). Players at the clubs that drop out become free agents. The manager's club and the
// manager's second club always survive the re-election vote (with a fine) — the next club up
// drops out instead — so a career never disappears.

const { clamp } = require('../utils');
const { Club } = require('../models');
const STAFF = require('./staffEngine');
const FIN = require('./financeEngine');

const DROPS = 2;

function placeOf(name) { const parts = name.split(' '); return parts.length > 1 ? parts.slice(0, -1).join(' ') : name; }
function suffixOf(name) { const parts = name.split(' '); return parts[parts.length - 1]; }

function newName(world, country, used, banned) {
  const names = world.clubs.filter(c => c.country === country).map(c => c.name);
  const places = [...new Set(names.map(placeOf))].sort();
  const suffixes = [...new Set(names.map(suffixOf))].sort();
  const extra = ['Wanderers', 'Pioneers', 'Rangers', 'Harriers', 'Mariners', 'Falcons', 'Stallions', 'Rockets'];
  const all = [...suffixes, ...extra];
  for (let tries = 0; tries < 400; tries++) {
    const name = `${world.rng.pick(places)} ${world.rng.pick(all)}`;
    if (!used.has(name) && !banned.has(name)) return name;
  }
  return `${country} Regional ${world.ids.cid}`;
}

// Runs at season end on the final tables. Returns [{ country, out: [names], in: [names], spared }].
function reElection(world, finalTables, banned = new Set()) {
  const report = [];
  const me = world.manager.clubId, owned = world.manager.ownedClubId;
  const used = new Set(world.clubs.map(c => c.name));
  for (const pyr of world.pyramids) {
    const bottom = world.leagueById(pyr.leagueIds[pyr.leagueIds.length - 1]);
    const rows = finalTables.get(bottom.id) || [];
    const ordered = rows.map(r => r.clubId).reverse().filter(id => bottom.clubIds.includes(id));
    const out = [];
    let spared = null;
    for (const id of ordered) {
      if (out.length >= DROPS) break;
      if (id === me || id === owned) { if (out.length < DROPS && !spared) spared = id; continue; }
      out.push(id);
    }
    if (spared) {
      const c = world.clubById(spared);
      FIN.post(c, 'League fine', -Math.round(Math.max(20_000, c.finance.balance * 0.05)), 'Survived the re-election vote');
    }
    const entry = { country: pyr.country, league: bottom.name, out: [], in: [], spared: spared ? world.clubById(spared).name : null };
    for (const id of out) {
      const c = world.clubById(id);
      for (const p of [...c.squad, ...c.youth]) { p.clubId = null; p.listedForSale = false; p.wantsOut = false; p.contractYears = Math.max(p.contractYears, 1); }
      c.squad = []; c.youth = [];
      world.clubs = world.clubs.filter(x => x.id !== id);
      bottom.clubIds = bottom.clubIds.filter(x => x !== id);
      entry.out.push(c.name);
      used.delete(c.name);
      const name = newName(world, pyr.country, used, banned);
      used.add(name);
      const nc = new Club(world.ctx(), { name, country: pyr.country, continent: pyr.continent, division: bottom.level });
      nc.prestige = clamp(8 + world.rng.int(0, 10), 5, 30);
      nc.fanMood = 70;
      nc.boardTrust = 60;
      nc.finance.balance = world.rng.int(150_000, 400_000);
      nc.finance.sponsorship = world.rng.int(60_000, 110_000);
      nc.facilities = { training: world.rng.int(1, 2), youth: world.rng.int(1, 2), medical: 1, stadium: world.rng.int(2000, 3500) };
      world.clubs.push(nc);
      world._index();
      world._seedSquad(nc, bottom.level);
      nc.staff = STAFF.generateClubStaff(world.rng, nc);
      FIN.syncBudgets(nc);
      FIN.openPeriod(nc, world.season, 'end', false);
      bottom.clubIds.push(nc.id);
      entry.in.push(name);
    }
    world._index();
    report.push(entry);
  }
  return report;
}

module.exports = { reElection, DROPS };
