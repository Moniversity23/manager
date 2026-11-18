// The history archive: seasons are archived, never overwritten, and every view resolves.
import { describe, it, expect, beforeAll } from 'vitest';
const { GameWorld } = require('../src/index');

let w, firstSeason;
const playSeason = (world) => { let out; do { out = world.stepWeek({}); if (world.manager.status === 'sacked') world.acceptJob(world.jobOffers[0].clubId); } while (!out.seasonComplete); return out; };

describe('history archive', () => {
  beforeAll(() => {
    w = new GameWorld({ seed: 31, startCountry: 'Spain' });
    firstSeason = w.season;
    playSeason(w);
  }, 300000);

  it('archives every league table, honour and award of the finished season', () => {
    const rec = w.archive.seasons[firstSeason];
    expect(rec).toBeTruthy();
    expect(Object.keys(rec.leagues).length).toBe(w.leagues.length);
    for (const lg of Object.values(rec.leagues)) {
      expect(lg.rows.length).toBeGreaterThan(10);
      expect(lg.rows[0][8]).toMatch(/^C/);                              // champions flagged
    }
    expect(rec.honours.filter(h => h.k[0] === 'L').length).toBe(w.leagues.length);
    expect(rec.awards.some(a => a.k === 'GB')).toBe(true);
    expect(rec.awards.some(a => a.k === 'G')).toBe(true);                // golden gloves
  });

  it('keeps a career line for players who played, and records your matches and stint', () => {
    const played = [...w.players.values()].filter(p => (p.career || []).some(r => r[0] === firstSeason));
    expect(played.length).toBeGreaterThan(3000);
    // The manager may have changed clubs at the end of the season: count every stint.
    const stints = w.archive.stints;
    for (const st of stints) expect(st.p).toBe(st.w + st.d + st.l);
    const total = stints.reduce((t, st) => t + st.p, 0);
    expect(total).toBeGreaterThan(20);
    expect(w.archive.matches.length).toBe(total);
    const m = w.archive.matches[0];
    expect(m.xi[0].length).toBe(11);
    expect(m.f && m.f[0]).toBeTruthy();
  });

  it('answers every history view', () => {
    const idx = w.historyIndex();
    expect(idx.seasons).toContain(firstSeason);
    const lg = idx.competitions.find(c => c.kind === 'league');
    const comp = w.competitionHistory(lg.key);
    expect(comp.seasons[0].winner).toBeTruthy();
    expect(comp.seasons[0].table.length).toBeGreaterThan(10);
    expect(w.competitionHistory('GB').seasons[0].goldenBall.name).toBeTruthy();
    const firstClub = w.archive.stints.find(st => st.p > 0).clubId;
    const club = w.clubHistory(firstClub);
    expect(club.seasons.length).toBe(1);
    expect(club.topApps.length).toBeGreaterThan(0);
    const pid = club.topApps[0].id;
    const ph = w.playerHistory(pid);
    expect(ph.ok).toBe(true);
    expect(ph.career.length).toBeGreaterThan(0);
    const mc = w.managerCareer();
    expect(mc.totals.p).toBeGreaterThan(20);
    expect(w.historySearch(ph.name.slice(0, 4)).players.length).toBeGreaterThan(0);
    const ms = w.matchArchive(firstSeason, null);
    expect(w.matchRecord(ms.matches[0].id).ok).toBe(true);
  });

  it('a second season adds to the archive without overwriting the first', () => {
    const before = JSON.stringify(w.archive.seasons[firstSeason].leagues);
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));
    expect(JSON.stringify(w2.archive.seasons[firstSeason].leagues)).toBe(before);
    playSeason(w2);
    expect(Object.keys(w2.archive.seasons).length).toBe(2);
    expect(JSON.stringify(w2.archive.seasons[firstSeason].leagues)).toBe(before);
    const multi = [...w2.players.values()].find(p => (p.career || []).length >= 2);
    expect(multi).toBeTruthy();
  }, 300000);

  it('migrates an older save into the archive', () => {
    const d = JSON.parse(JSON.stringify(w.toSave()));
    d._v = 10; delete d.archive;
    const w3 = GameWorld.fromSave(d);
    expect(w3.archive.seasons[firstSeason].honours.length).toBeGreaterThan(0);
    expect(w3.archive.stints.some(s => s.to === null)).toBe(true);
  });
});
