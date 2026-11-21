// Shirt sponsorship is priced from the club itself (division, prestige, fans), never from the last
// deal — it used to compound every season and reached billions.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');
const FIN = require('../src/engine/financeEngine');

describe('shirt sponsorship', () => {
  it('does not compound: signing the richest offer every season stays within the market', () => {
    const w = new GameWorld({ seed: 21, startCountry: 'England' });
    const c = w.club();
    c.prestige = 99; c.fanMood = 100; c.division = 1;
    const seen = [];
    for (let season = 0; season < 25; season++) {
      c.sponsor = null;
      w._sponsorOffers();
      const best = w.sponsorOffers.reduce((a, b) => (b.perSeason > a.perSeason ? b : a));
      seen.push(best.perSeason);
      w.acceptSponsor(w.sponsorOffers.indexOf(best), true);
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(FIN.SPONSOR_CAP[0] * 1.2);
    expect(Math.max(...seen) / Math.min(...seen)).toBeLessThan(1.25);     // no growth from deal to deal
  });

  it('a lower-division club keeps the income it started with', () => {
    const w = new GameWorld({ seed: 3, startCountry: 'England' });
    for (const c of w.clubs.slice(0, 200)) {
      const v = FIN.sponsorValue(c);
      expect(v).toBeGreaterThan(c.finance.sponsorship * 0.7);
      expect(v).toBeLessThan(c.finance.sponsorship * 1.4);
    }
  });

  it('loading a save with a runaway deal brings it back to market value (money earned is kept)', () => {
    const w = new GameWorld({ seed: 3, startCountry: 'England' });
    const c = w.club();
    c.finance.sponsorship = 1_800_000_000;
    c.sponsor = { name: 'Runaway Ltd', years: 2, perSeason: 1_800_000_000, bonus: { promotion: 360_000_000, trophy: 180_000_000 } };
    c.finance.balance = 2_000_000_000;
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));
    const c2 = w2.club();
    expect(c2.finance.sponsorship).toBe(FIN.sponsorValue(c2, w2.econ || 1));
    expect(c2.sponsor.perSeason).toBe(c2.finance.sponsorship);
    expect(c2.sponsor.bonus.promotion).toBeLessThan(c2.finance.sponsorship);
    expect(c2.finance.balance).toBe(2_000_000_000);
    // A sane deal is never touched.
    const w3 = GameWorld.fromSave(JSON.parse(JSON.stringify(w2.toSave())));
    expect(w3.club().finance.sponsorship).toBe(c2.finance.sponsorship);
  });

  it('after a full season every club is still within its division cap', () => {
    const w = new GameWorld({ seed: 8, startCountry: 'Spain' });
    let out; do { out = w.stepWeek({}); if (w.manager.status === 'sacked') w.acceptJob(w.jobOffers[0].clubId); } while (!out.seasonComplete);
    for (const c of w.clubs) expect(c.finance.sponsorship).toBeLessThanOrEqual(FIN.SPONSOR_CAP[Math.min(4, c.division) - 1] * 1.2);
  }, 120000);
});
