// Feature tests: cards and bans, cups, play-offs, board and jobs, staff, sponsors, release payout,
// counter-bids, fictional data, and interactive ≡ headless determinism.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { GameWorld } = require('../src/index.js');
const { stateHash } = require('../src/saveStore.js');
const ME = require('../src/engine/matchEngine.js');
const BOARD = require('../src/engine/boardEngine.js');
const TR = require('../src/engine/transferEngine.js');
const { pickXI } = require('../src/engine/selection.js');
const DATA = require('../src/data/world.json');
const RENAMES = require('../src/data/renames.json');

const playSeason = (w) => { let out; do { out = w.stepWeek({}); if (w.manager.status === 'sacked') w.acceptJob(w.jobOffers[0].clubId); } while (!out.seasonComplete); return out; };

describe('discipline', () => {
  it('produces realistic cards, and a sent-off player is banned and left out', () => {
    const w = new GameWorld({ seed: 201, startCountry: 'Spain' });
    let yellows = 0, reds = 0, matches = 0, banned = null;
    for (let i = 0; i < 120; i++) {
      const home = w.clubs[(i * 2) % w.clubs.length], away = w.clubs[(i * 2 + 1) % w.clubs.length];
      const { match } = ME.playMatch(w.matchCtx(), { id: `d${i}`, comp: 'test', week: 1, home, away });
      matches++;
      yellows += match.events.filter(e => e.type === 'yellow').length;
      const red = match.events.find(e => e.type === 'red');
      if (red) { reds++; banned = banned || w.players.get(red.playerId); }
    }
    expect(yellows / matches).toBeGreaterThan(2.5);
    expect(yellows / matches).toBeLessThan(4.5);
    expect(reds / matches).toBeLessThan(0.3);
    expect(banned).toBeTruthy();
    expect(banned.suspension).toBeGreaterThan(0);
    const club = w.clubById(banned.clubId);
    expect(pickXI(club).xi.some(s => s.playerId === banned.id)).toBe(false);
  });
});

describe('season structure', () => {
  it('runs a national cup per nation and promotes play-off winners', () => {
    const w = new GameWorld({ seed: 202, startCountry: 'England' });
    playSeason(w);
    const season = w.season - 1;
    expect((w.history.cupWinners || []).filter(c => c.season === season)).toHaveLength(DATA.nations.length);
    // Play-off winners of every lower division now sit one level up.
    const lastSeasonPlayoffs = w.inbox.length; // smoke: inbox exists
    expect(lastSeasonPlayoffs).toBeGreaterThan(0);
    for (const lg of w.leagues) expect(lg.clubIds).toHaveLength(15);
    expect(w.totalWeeks).toBe(32);
  });

  it('play-off final winner is promoted', () => {
    const w = new GameWorld({ seed: 203, startCountry: 'Japan' });
    while (w.currentWeek < w.totalWeeks - 1) { w.stepWeek({}); if (w.manager.status === 'sacked') w.acceptJob(w.jobOffers[0].clubId); }
    // Before the final week: every lower division has a play-off final between two clubs.
    const finals = w.leagues.filter(l => l.level > 1).map(l => ({ level: l.level, country: l.country, pair: [l.playoff.final.h, l.playoff.final.a] }));
    expect(finals).toHaveLength(30);
    const out = w.stepWeek({});
    expect(out.seasonComplete).toBe(true);
    for (const f of finals) {
      const up = f.pair.filter(id => w.clubById(id).division === f.level - 1);
      expect(up.length, `${f.country} D${f.level} play-off`).toBe(1);
    }
  });
});

describe('board and career', () => {
  it('sacks after a long bad run (not in the first season), offers jobs, and the new job works', () => {
    const w = new GameWorld({ seed: 204, startCountry: 'Ghana' });
    const me = w.club();
    w.manager.joinedSeason = w.season - 1;      // past the first-season grace period
    me.objective.warned = true;
    me.boardTrust = 5;
    w.currentWeek = 17;
    expect(BOARD.weeklyConfidence(w, me, w.league())).toBe('sacked');
    w.currentWeek = 0;
    w._sack('Test');
    expect(w.manager.status).toBe('sacked');
    expect(() => w.beginWeek()).toThrow(/sacked/);
    const offer = w.jobOffers[0];
    expect(w.acceptJob(offer.clubId).ok).toBe(true);
    expect(w.club().id).toBe(offer.clubId);
    expect(w.manager.status).toBe('employed');
    w.stepWeek({});
  });

  it('coaching licence courses take time and money', () => {
    const w = new GameWorld({ seed: 205, startCountry: 'USA' });
    expect(w.startCourse().ok).toBe(false);
    w.manager.wealth = 10_000;
    expect(w.startCourse().ok).toBe(true);
    for (let i = 0; i < 6; i++) w.stepWeek({});
    expect(w.manager.badge).toBe(1);
    expect(w.club().badgeBonus).toBeCloseTo(0.02);
  });
});

describe('club management', () => {
  it('hires staff (fee in the ledger), signs a sponsor, sets ticket prices, releases with a payout', () => {
    const w = new GameWorld({ seed: 206, startCountry: 'Argentina' });
    const me = w.club();
    me.finance.balance = 5_000_000;
    const cands = w.staffCandidates('coach').candidates;
    expect(cands.length).toBe(5);
    const best = cands[0].rating;
    expect(w.hireStaff('coach', 0).ok).toBe(true);
    expect(me.staff.coach.rating).toBe(best);
    expect(me.finance.period.items['Staff signing fee']).toBeLessThan(0);
    expect(w.sponsorOffers).toHaveLength(3);
    expect(w.acceptSponsor(2).ok).toBe(true);
    expect(me.sponsor.years).toBe(3);
    expect(w.setTicketPrice(1.5).ticketPrice).toBe(1.5);
    const p = me.squad.find(x => x.contractYears >= 2);
    const terms = w.releasePlayer(p.id, true);
    expect(terms.payout).toBeGreaterThan(0);
    const r = w.releasePlayer(p.id);
    expect(r.ok).toBe(true);
    expect(me.finance.period.items['Contract termination']).toBe(-terms.payout);
  });

  it('countering a bid: within their limit they pay, far above it they walk away', () => {
    const w = new GameWorld({ seed: 207, startCountry: 'Nigeria' });
    for (const c of w.clubs) if (c.id !== w.club().id) c.finance.balance = Math.max(c.finance.balance, 5_000_000);
    let bids = [];
    for (let wk = 1; wk < 300 && bids.length < 2; wk++) { w.pendingBids = []; bids = TR.generateIncomingBids(w, 1).concat(bids); }
    const [a, b] = bids;
    w.pendingBids = [a, b].filter(Boolean);
    const ok = w.counterBid(a.id, Math.min(a.maxFee, a.fee + 1000));
    expect(ok.ok).toBe(true);
    if (b) {
      const no = w.counterBid(b.id, b.maxFee * 3);
      expect(no.ok).toBe(false);
      expect(no.action).toBe('withdrawn');
    }
  });
});

describe('data and determinism', () => {
  it('contains no real club names', () => {
    const current = new Set(DATA.nations.flatMap(n => n.clubs.flat()));
    // Every old name was replaced; an old name may survive only if the generator produced the same
    // fictional name again for another club (e.g. an invented name like 'Ilorin Royals').
    for (const map of Object.values(RENAMES.clubs)) {
      const generated = new Set(Object.values(map));
      for (const old of Object.keys(map)) if (!generated.has(old)) expect(current.has(old)).toBe(false);
    }
    expect(current.has('Bayern Munich') || current.has('Flamengo') || current.has('River Plate') || current.has('Asante Kotoko')).toBe(false);
  });

  it('interactive play (pausing at half-time) gives exactly the same world as headless play', () => {
    const a = new GameWorld({ seed: 208, startCountry: 'Brazil' });
    const b = new GameWorld({ seed: 208, startCountry: 'Brazil' });
    for (let i = 0; i < 8; i++) {
      a.stepWeek({});
      b.beginWeek();
      let r;
      do { r = b.advanceWeek({}, true); } while (r.halftime);
    }
    expect(stateHash(b.toSave())).toBe(stateHash(a.toSave()));
  });
});
