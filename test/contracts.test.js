// Season-end contracts at AI clubs: core players are kept, but a young player who has outgrown a
// modest club sometimes turns the new deal down and leaves on a free.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');
const CON = require('../src/engine/contractEngine');

describe('AI club contracts at season end', () => {
  it('keeps ordinary core players and lets some outgrown stars leave modest clubs for free', () => {
    const w = new GameWorld({ seed: 404, startCountry: 'England' });
    const me = w.manager.clubId;
    const modest = w.clubs.filter(c => c.id !== me && (c.prestige || 50) < 60).slice(0, 60);
    const stars = [], ordinary = [];
    for (const c of modest) {
      const active = c.squad.filter(p => !p.retired && !p.loan);
      const avg = active.reduce((s, p) => s + p.currentAbility, 0) / active.length;
      const sorted = active.slice().sort((a, b) => b.currentAbility - a.currentAbility);
      const star = sorted[0];
      star.age = 24; star.currentAbility = Math.round(avg + 15); star.contractYears = 1;
      stars.push({ p: star, club: c });
      const mid = sorted[8]; mid.age = 26; mid.contractYears = 1; ordinary.push({ p: mid, club: c });
    }
    CON.settleContracts(w);
    const gone = stars.filter(x => x.p.clubId !== x.club.id).length;
    expect(gone).toBeGreaterThan(stars.length * 0.15);                   // some leave…
    expect(gone).toBeLessThan(stars.length * 0.7);                       // …most stay
    for (const x of stars.filter(s => s.p.clubId == null)) expect(x.club.squad.includes(x.p)).toBe(false);
    // Ordinary first-teamers are simply kept on new deals.
    const kept = ordinary.filter(x => x.p.clubId === x.club.id);
    expect(kept.length).toBeGreaterThan(ordinary.length * 0.9);
    for (const x of kept) expect(x.p.contractYears).toBeGreaterThan(0);
  });
});
