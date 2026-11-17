// Loaning your own players out: offers, the move, wages, recall and the return at season end.
import { describe, it, expect } from 'vitest';
const { GameWorld } = require('../src/index');

const fresh = () => new GameWorld({ seed: 77, startCountry: 'England' });
const fringe = w => w.club().squad.filter(p => !p.retired && p.position !== 'GK' && !p.isInjured() && p.age >= 17).sort((a, b) => a.currentAbility - b.currentAbility)[0];

describe('loaning players out', () => {
  it('lists clubs that would play him, with stable terms', () => {
    const w = fresh();
    const p = fringe(w);
    const a = w.loanOutOptions(p.id), b = w.loanOutOptions(p.id);
    expect(a.ok).toBe(true);
    expect(a.offers.length).toBeGreaterThan(0);
    expect(a.offers).toEqual(b.offers);
    for (const o of a.offers) {
      expect(['starter', 'rotation']).toContain(o.role);
      expect(o.wageShare).toBeGreaterThanOrEqual(35);
      expect(o.wageShare).toBeLessThanOrEqual(100);
      expect(o.clubId).not.toBe(w.club().id);
    }
  });

  it('moves him, pays the fee, shares the wages, tracks his loan and brings him home at season end', () => {
    const w = fresh();
    const me = w.club(), p = fringe(w);
    const o = w.loanOutOptions(p.id).offers[0];
    const bal = me.finance.balance;
    const r = w.loanOut(p.id, o.clubId);
    expect(r.ok).toBe(true);
    expect(me.squad.includes(p)).toBe(false);
    expect(w.clubById(o.clubId).squad.includes(p)).toBe(true);
    expect(p.loan.parentClubId).toBe(me.id);
    expect(me.finance.balance).toBe(bal + o.fee);
    expect(w.snapshot().loanedOut.map(x => x.id)).toContain(p.id);
    expect(w.loanOutOptions(p.id).ok).toBe(false);                      // no longer in your squad
    for (let i = 0; i < 5; i++) w.stepWeek({});
    const row = w.snapshot().loanedOut.find(x => x.id === p.id);
    expect(row.loanClub).toBe(w.clubById(o.clubId).name);
    expect(row.loanStats.apps).toBeGreaterThanOrEqual(0);
    let out; do { out = w.stepWeek({}); if (w.manager.status === 'sacked') w.acceptJob(w.jobOffers[0].clubId); } while (!out.seasonComplete);
    if (w.manager.clubId === me.id) expect(me.squad.includes(p) || p.retired || p.clubId !== me.id).toBe(true);
    expect(p.loan).toBe(null);
    expect(w.inbox.some(m => /returns from his loan/.test(m.text))).toBe(true);
  });

  it('can recall him while the window is open, and refuses when it is shut', () => {
    const w = fresh();
    const me = w.club(), p = fringe(w);
    w.loanOut(p.id, w.loanOutOptions(p.id).offers[0].clubId);
    const back = w.recallLoan(p.id);
    expect(back.ok).toBe(true);
    expect(me.squad.includes(p)).toBe(true);
    expect(p.loan).toBe(null);
    w.loanOut(p.id, w.loanOutOptions(p.id).offers[0].clubId);
    while (w.isWindowOpen()) w.stepWeek({});
    expect(w.recallLoan(p.id).ok).toBe(false);
    expect(w.loanOut(fringe(w).id, 1).ok).toBe(false);
  });

  it('survives a save and load', () => {
    const w = fresh();
    const p = fringe(w);
    w.loanOut(p.id, w.loanOutOptions(p.id).offers[0].clubId);
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));
    expect(w2.snapshot().loanedOut.map(x => x.id)).toContain(p.id);
    expect(w2.players.get(p.id).loan.start).toBeTruthy();
  });
});
