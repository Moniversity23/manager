// src/engine/competitionEngine.js — continental club competitions with their own group tables.
//
// Format per competition (from src/data/world.json → continental):
//   entrants = the top N clubs of each member nation's top division (previous season),
//   groups of 4 (double round robin on GROUP_WEEKS), top 2 advance,
//   2 groups → semi-finals (single leg, extra time, penalties) → final at a neutral ground;
//   1 group  → final between the top 2.
// Prize money is paid per entry, win, draw, semi-final, runner-up and winner.

const { buildRoundRobin, sortRows, applyResultToRows, emptyRow } = require('./seasonEngine');
const { post } = require('./financeEngine');

const GROUP_WEEKS = [3, 6, 9, 12, 15, 18];
const SEMI_WEEK = 22;
const FINAL_WEEK = 27;
const GROUP_NAMES = ['A', 'B', 'C', 'D'];

function qualifiersFor(def, world) {
  const out = [];
  for (const [country, n] of Object.entries(def.slots)) {
    const ordered = world.qualifiers[country] || [];
    out.push(...ordered.slice(0, n));
  }
  return out.filter(id => world.clubById(id));
}

function drawGroups(ids, world) {
  const seeded = ids.slice().sort((a, b) => world.clubById(b).prestige - world.clubById(a).prestige || a - b);
  const nGroups = Math.max(1, Math.floor(seeded.length / 4));
  const groups = Array.from({ length: nGroups }, (_, i) => ({ name: GROUP_NAMES[i], clubIds: [] }));
  seeded.slice(0, nGroups * 4).forEach((id, i) => {
    const pot = Math.floor(i / nGroups);
    const g = pot % 2 === 0 ? i % nGroups : nGroups - 1 - (i % nGroups);
    groups[g].clubIds.push(id);
  });
  for (const g of groups) {
    g.table = g.clubIds.map(id => emptyRow(id));
    g.rounds = buildRoundRobin(g.clubIds);
    g.results = [];
  }
  return groups;
}

function createContinentalSeason(world) {
  const comps = [];
  for (const def of world.data.continental) {
    const entrants = qualifiersFor(def, world);
    if (entrants.length < 4) continue;
    const comp = { id: def.id, name: def.name, continent: def.continent, season: world.season, prize: def.prize,
      entrants, groups: drawGroups(entrants, world), knockout: [], winner: null, runnerUp: null, stage: 'groups' };
    for (const id of entrants) post(world.clubById(id), 'Continental prize', def.prize.entry * (world.econ || 1), `${def.name} participation`);
    comps.push(comp);
  }
  return comps;
}

// Fixtures to play this week: [{ comp, kind, group?, tie?, h, a, neutral, knockout }]
function fixturesForWeek(world, week) {
  const out = [];
  for (const comp of world.continental || []) {
    const gi = GROUP_WEEKS.indexOf(week);
    if (gi >= 0 && comp.stage === 'groups') {
      for (const g of comp.groups) for (const [h, a] of (g.rounds[gi] || [])) out.push({ comp, kind: 'group', group: g, h, a, neutral: false, knockout: false });
    }
    if (week === SEMI_WEEK || week === FINAL_WEEK) {
      for (const tie of comp.knockout) if (tie.week === week && !tie.result) out.push({ comp, kind: 'ko', tie, h: tie.h, a: tie.a, neutral: tie.round === 'Final', knockout: true });
    }
  }
  return out;
}

function recordContinental(world, fx, result) {
  const comp = fx.comp;
  const econ = world.econ || 1;
  if (fx.kind === 'group') {
    applyResultToRows(fx.group.table, result);
    fx.group.results.push(result);
    const pay = (id, amt, why) => post(world.clubById(id), 'Continental prize', amt * econ, `${comp.name}: ${why}`);
    if (result.hg > result.ag) pay(result.h, comp.prize.win, 'group win');
    else if (result.hg < result.ag) pay(result.a, comp.prize.win, 'group win');
    else { pay(result.h, comp.prize.draw, 'group draw'); pay(result.a, comp.prize.draw, 'group draw'); }
  } else {
    fx.tie.result = result;
    fx.tie.winner = result.winner;
  }
}

// Called after each week: closes the group stage and resolves knockout rounds.
function advanceContinental(world, week) {
  const done = [];
  for (const comp of world.continental || []) {
    if (comp.stage === 'groups' && week >= GROUP_WEEKS[GROUP_WEEKS.length - 1]) {
      const tops = comp.groups.map(g => sortRows(g.table).slice(0, 2).map(r => r.clubId));
      if (tops.length >= 2) {
        comp.knockout.push({ round: 'Semi-final', week: SEMI_WEEK, h: tops[0][0], a: tops[1][1], result: null, winner: null });
        comp.knockout.push({ round: 'Semi-final', week: SEMI_WEEK, h: tops[1][0], a: tops[0][1], result: null, winner: null });
        comp.stage = 'semis';
      } else {
        comp.knockout.push({ round: 'Final', week: FINAL_WEEK, h: tops[0][0], a: tops[0][1], result: null, winner: null });
        comp.stage = 'final';
      }
    }
    if (comp.stage === 'semis' && week >= SEMI_WEEK && comp.knockout.filter(t => t.round === 'Semi-final').every(t => t.winner)) {
      const semis = comp.knockout.filter(t => t.round === 'Semi-final');
      for (const t of semis) post(world.clubById(t.winner), 'Continental prize', comp.prize.semi * (world.econ || 1), `${comp.name}: reached the final`);
      comp.knockout.push({ round: 'Final', week: FINAL_WEEK, h: semis[0].winner, a: semis[1].winner, result: null, winner: null });
      comp.stage = 'final';
    }
    if (comp.stage === 'final' && week >= FINAL_WEEK) {
      const fin = comp.knockout.find(t => t.round === 'Final');
      if (fin && fin.winner) {
        comp.winner = fin.winner;
        comp.runnerUp = fin.winner === fin.h ? fin.a : fin.h;
        post(world.clubById(comp.winner), 'Continental prize', comp.prize.winner * (world.econ || 1), `${comp.name} winners`);
        post(world.clubById(comp.runnerUp), 'Continental prize', comp.prize.runnerUp * (world.econ || 1), `${comp.name} runners-up`);
        comp.stage = 'done';
        done.push(comp);
      }
    }
  }
  return done;
}

module.exports = { createContinentalSeason, fixturesForWeek, recordContinental, advanceContinental, GROUP_WEEKS, SEMI_WEEK, FINAL_WEEK };
