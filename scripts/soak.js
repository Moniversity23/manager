// Long headless soak with a world-health report per season.
// Usage: npm run soak -- [seasons=10] [seed=2026]
const { GameWorld } = require('../src/index.js');
const { assertWorldInvariants } = require('../src/engine/seasonEngine.js');

const seasons = parseInt(process.argv[2] || '10', 10);
const seed = parseInt(process.argv[3] || '2026', 10);
const world = new GameWorld({ seed, startCountry: 'Nigeria' });
console.log(`Soak: ${seasons} seasons, seed ${seed}, ${world.clubs.length} clubs, ${world.players.size} players, career at ${world.club().name}`);

let totalWeeks = 0;
const t0 = Date.now();
for (let s = 0; s < seasons; s++) {
  const ts = Date.now();
  let weeks = 0, out, goals = 0, home = 0, draws = 0, matches = 0, xg = 0;
  do {
    if (world.currentWeek === world.totalWeeks - 1) {
      for (const l of world.leagues) for (const r of l.results) { matches++; goals += r.hg + r.ag; xg += r.hx + r.ax; if (r.hg > r.ag) home++; else if (r.hg === r.ag) draws++; }
    }
    out = world.stepWeek({});
    if (world.manager.status === 'sacked') world.acceptJob(world.jobOffers[0].clubId);
    weeks++;
  } while (!out.seasonComplete);
  totalWeeks += weeks;
  assertWorldInvariants(world);
  const byDiv = {};
  for (const c of world.clubs) (byDiv[c.division] ||= []).push(c);
  const divs = Object.keys(byDiv).sort().map(d => {
    const cs = byDiv[d];
    const ca = cs.reduce((a, c) => a + c.squad.reduce((x, p) => x + p.currentAbility, 0) / Math.max(1, c.squad.length), 0) / cs.length;
    const bal = cs.reduce((a, c) => a + c.finance.balance, 0) / cs.length;
    return `D${d} ca ${ca.toFixed(1)} bal ${(bal / 1e6).toFixed(2)}M debt ${cs.filter(c => c.finance.balance < 0).length}`;
  }).join(' | ');
  let active = 0, free = 0;
  for (const p of world.players.values()) if (!p.retired) { active++; if (p.clubId == null) free++; }
  const sum = out.endSummary;
  console.log(`S${s + 1} ${((Date.now() - ts) / weeks).toFixed(0)}ms/wk · you: ${sum.club} D${sum.division} ${sum.position}th ${sum.outcome} · goals/m ${(goals / matches).toFixed(2)} home ${(100 * home / matches).toFixed(1)}% draw ${(100 * draws / matches).toFixed(1)}% xG/goals ${(xg / goals).toFixed(2)} · players ${active} FA ${(100 * free / active).toFixed(1)}%`);
  console.log(`    ${divs}`);
}
console.log(`Done: ${totalWeeks} weeks in ${((Date.now() - t0) / 1000).toFixed(1)}s (${((Date.now() - t0) / totalWeeks).toFixed(0)} ms/week incl. season ends), zero exceptions.`);
