// src/engine/cupEngine.js — national cup for every club in each nation (giant-killings welcome).
// 60 clubs: the 4 highest-prestige clubs get a first-round bye, 56 play → 32 → 16 → 8 → 4 → 2 → final.
// Each round is drawn when the previous one ends; extra time and penalties decide ties; the final
// is at a neutral ground. Prize money per round reached.

const { post } = require('./financeEngine');

const CUP_WEEKS = [5, 10, 14, 20, 24, 28];
const ROUND_NAMES = ['Round 1', 'Round 2', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
const PRIZE = [15_000, 30_000, 60_000, 120_000, 250_000, 400_000]; // for winning that round
const WINNER_BONUS = 400_000;

function draw(world, ids) {
  const shuffled = world.rng.shuffle(ids);
  const ties = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) ties.push({ h: shuffled[i], a: shuffled[i + 1], result: null, winner: null });
  return ties;
}

function createCups(world) {
  const cups = [];
  for (const pyr of world.pyramids) {
    const nation = world.data.nations.find(n => n.country === pyr.country);
    const ids = pyr.leagueIds.flatMap(id => world.leagueById(id).clubIds);
    const byPrestige = ids.slice().sort((a, b) => world.clubById(b).prestige - world.clubById(a).prestige || a - b);
    const byes = byPrestige.slice(0, Math.max(0, ids.length - 56));
    const playing = ids.filter(id => !byes.includes(id));
    cups.push({ id: `${pyr.country}-cup`, country: pyr.country, name: (nation && nation.cup) || `${pyr.country} National Cup`,
      round: 0, byes, rounds: [{ name: ROUND_NAMES[0], week: CUP_WEEKS[0], ties: draw(world, playing) }], winner: null, runnerUp: null });
  }
  return cups;
}

function fixturesForWeek(world, week) {
  const out = [];
  for (const cup of world.cups || []) {
    const r = cup.rounds[cup.round];
    if (!r || r.week !== week || cup.winner) continue;
    for (const tie of r.ties) if (!tie.result) out.push({ cup, tie, round: cup.round, h: tie.h, a: tie.a, neutral: cup.round === ROUND_NAMES.length - 1 });
  }
  return out;
}

function recordCup(world, fx, result) {
  fx.tie.result = result;
  fx.tie.winner = result.winner;
  post(world.clubById(result.winner), 'Cup prize money', PRIZE[fx.round] * (world.econ || 1), `${fx.cup.name}: won ${ROUND_NAMES[fx.round]}`);
}

// After the week: close finished rounds and draw the next. Returns { draws: [...], finished: [...] }.
function advanceCups(world) {
  const draws = [], finished = [];
  for (const cup of world.cups || []) {
    const r = cup.rounds[cup.round];
    if (!r || cup.winner || !r.ties.every(t => t.winner)) continue;
    const winners = r.ties.map(t => t.winner);
    if (cup.round === ROUND_NAMES.length - 1) {
      cup.winner = winners[0];
      const fin = r.ties[0];
      cup.runnerUp = fin.winner === fin.h ? fin.a : fin.h;
      post(world.clubById(cup.winner), 'Cup prize money', WINNER_BONUS * (world.econ || 1), `${cup.name} winners`);
      finished.push(cup);
      continue;
    }
    const next = cup.round === 0 ? [...winners, ...cup.byes] : winners;
    cup.round++;
    cup.rounds.push({ name: ROUND_NAMES[cup.round], week: CUP_WEEKS[cup.round], ties: draw(world, next) });
    draws.push(cup);
  }
  return { draws, finished };
}

module.exports = { createCups, fixturesForWeek, recordCup, advanceCups, CUP_WEEKS, ROUND_NAMES };
