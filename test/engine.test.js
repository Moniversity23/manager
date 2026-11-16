// Engine unit tests for the Phase 0 owner requirements.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { GameWorld } = require('../src/index.js');
const { RNG, ATTR_KEYS } = require('../src/utils.js');
const DEV = require('../src/engine/developmentEngine.js');
const ME = require('../src/engine/matchEngine.js');
const FIN = require('../src/engine/financeEngine.js');
const TR = require('../src/engine/transferEngine.js');
const YOUTH = require('../src/engine/youthEngine.js');
const { pickXI, pickBench, isAvailable } = require('../src/engine/selection.js');

const fresh = (seed = 21, country = 'Nigeria') => new GameWorld({ seed, startCountry: country });

describe('development', () => {
  it('training never lowers an attribute', () => {
    const w = fresh();
    const rng = new RNG(1);
    for (const c of w.clubs.slice(0, 40)) {
      for (const p of [...c.squad, ...c.youth]) {
        const before = { ...p.attributes };
        for (let i = 0; i < 30; i++) DEV.trainPlayer(p, c, rng);
        for (const k of ATTR_KEYS) expect(p.attributes[k]).toBeGreaterThanOrEqual(before[k]);
      }
    }
  });

  it('decline comes only from age, after the positional peak', () => {
    const w = fresh();
    const rng = new RNG(2);
    const players = w.clubs.flatMap(c => c.squad);
    const young = players.find(p => p.age <= 25);
    const before = { ...young.attributes };
    for (let i = 0; i < 30; i++) DEV.ageDecline(young, rng);
    expect(young.attributes).toEqual(before);
    const old = players.find(p => p.age >= 33 && p.position !== 'GK');
    const ca = old.currentAbility;
    for (let i = 0; i < 30; i++) DEV.ageDecline(old, rng);
    expect(old.currentAbility).toBeLessThan(ca);
  });

  it('fresh youth respect the rating caps', () => {
    const w = fresh();
    const club = w.club();
    for (let i = 0; i < 400; i++) {
      const p = YOUTH.makeYouth(w, club, { wonderkid: i % 10 === 0 });
      const attrCap = p.wonderkid ? 82 : 75;
      const ovrCap = p.wonderkid ? 60 : 55;
      expect(p.currentAbility).toBeLessThanOrEqual(ovrCap);
      for (const k of ATTR_KEYS) expect(p.attributes[k]).toBeLessThanOrEqual(attrCap);
      expect(w.players.has(p.id)).toBe(true);
    }
  });

  it('fatigue drain falls and recovery rises with stamina (work rate), strength and medical level', () => {
    const base = { attributes: { workRate: 50, strength: 50 } };
    const club = { facilities: { medical: 1 }, trainingIntensity: 3 };
    let lastDrain = Infinity, lastRec = -Infinity;
    for (let v = 30; v <= 90; v += 10) {
      const p = { attributes: { ...base.attributes, workRate: v } };
      const d = ME.drainFactor(p), r = DEV.weeklyRecovery(p, club);
      expect(d).toBeLessThanOrEqual(lastDrain);
      expect(r).toBeGreaterThanOrEqual(lastRec);
      lastDrain = d; lastRec = r;
    }
    lastDrain = Infinity; lastRec = -Infinity;
    for (let v = 30; v <= 90; v += 10) {
      const p = { attributes: { ...base.attributes, strength: v } };
      const d = ME.drainFactor(p), r = DEV.weeklyRecovery(p, club);
      expect(d).toBeLessThanOrEqual(lastDrain);
      expect(r).toBeGreaterThanOrEqual(lastRec);
      lastDrain = d; lastRec = r;
    }
    expect(DEV.weeklyRecovery(base, { ...club, facilities: { medical: 5 } })).toBeGreaterThan(DEV.weeklyRecovery(base, club));
  });
});

describe('lineup integrity', () => {
  it('starts exactly the manual XI and uses exactly the chosen bench', () => {
    const w = fresh(31);
    const club = w.club();
    const avail = club.squad.filter(isAvailable).sort((a, b) => a.currentAbility - b.currentAbility);
    const slots = ME.createMatch(w.matchCtx(), { id: 't0', comp: 'test', week: 1, home: club, away: w.clubById(club.id + 1) }).home.startXI.map(s => s.slotKey);
    const gk = avail.find(p => p.position === 'GK');
    const outfield = avail.filter(p => p !== gk);
    const chosen = slots.map((slotKey, i) => ({ slotKey, playerId: slotKey.startsWith('GK') ? gk.id : outfield[i].id }));
    const used = new Set(chosen.map(c => c.playerId));
    const bench = club.squad.filter(p => isAvailable(p) && !used.has(p.id)).slice(0, 7).map(p => p.id);
    w.setManualLineup(chosen, bench);
    const m = ME.createMatch(w.matchCtx(), { id: 't1', comp: 'test', week: 1, home: club, away: w.clubById(club.id + 1) });
    expect(m.home.startXI).toEqual(chosen);
    expect(m.home.bench).toEqual(bench);
    ME.playFirstHalf(m, w.matchCtx());
    ME.playSecondHalf(m, w.matchCtx());
    const allowed = new Set([...chosen.map(c => c.playerId), ...bench]);
    for (const id of Object.keys(m.home.apps)) expect(allowed.has(Number(id))).toBe(true);
    for (const e of m.events.filter(e => e.type === 'sub' && e.side === 'home')) expect(bench).toContain(e.onId);
  });

  it('the assistant makes substitutions when the manager makes none', () => {
    const w = fresh(41);
    let subs = 0, sides = 0;
    for (let i = 0; i < 20; i++) {
      const home = w.clubs[i * 2], away = w.clubs[i * 2 + 1];
      const { match } = ME.playMatch(w.matchCtx(), { id: `a${i}`, comp: 'test', week: 1, home, away });
      for (const k of ['home', 'away']) { sides++; subs += match.events.filter(e => e.type === 'sub' && e.side === k).length; }
    }
    expect(subs / sides).toBeGreaterThanOrEqual(2);
  });

  it('once the manager makes a change at halftime the assistant leaves the bench alone', () => {
    const w = fresh(43);
    const home = w.club(), away = w.clubById(home.id === 1 ? 2 : 1);
    const m = ME.createMatch(w.matchCtx(), { id: 'h1', comp: 'test', week: 1, home, away, interactiveSide: 'home' });
    ME.playFirstHalf(m, w.matchCtx());
    const off = m.home.onPitch.find(s => s.slot !== 'GK').playerId;
    const on = m.home.bench.find(id => w.players.get(id).position !== 'GK');
    const applied = ME.applyHalftime(m, 'home', { subs: [{ offId: off, onId: on }], tactic: 'low_block' }, w.matchCtx());
    expect(applied.subs).toBe(1);
    ME.playSecondHalf(m, w.matchCtx());
    expect(m.events.filter(e => e.type === 'sub' && e.side === 'home' && e.reason.startsWith('assistant'))).toHaveLength(0);
  });

  it('auto-pick makes at most 2 voluntary changes a week', () => {
    const w = fresh(51);
    for (let i = 0; i < 12; i++) {
      const { changes } = pickXI(w.club());
      expect(changes.filter(c => c.reason === 'better option').length).toBeLessThanOrEqual(2);
      w.stepWeek({});
    }
  });

  it('a match never kicks off short: the assistant fills gaps', () => {
    const w = fresh(53);
    const club = w.club();
    for (const p of club.squad.slice(0, club.squad.length - 6)) p.injury = { type: 'test', weeks: 5 };
    w._ensureMatchSquad(club);
    const { xi } = pickXI(club);
    expect(xi.filter(s => s.playerId != null)).toHaveLength(11);
    expect(pickBench(club, xi.map(s => s.playerId)).length).toBeGreaterThanOrEqual(0);
  });
});

describe('contracts', () => {
  it('renewal extends the deal and is posted to the ledger', () => {
    const w = fresh(61);
    const club = w.club();
    club.finance.balance = 5_000_000;
    const p = club.squad[0];
    p.contractYears = 1;
    const r = w.renew(p.id, 2);
    expect(r.ok).toBe(true);
    expect(p.contractYears).toBe(3);
    expect(club.finance.period.items['Signing bonus']).toBeLessThan(0);
  });

  it('warns about final-year contracts at season start and unrenewed players leave', () => {
    const w = fresh(63);
    const club = w.club();
    const leaver = club.squad.find(p => p.position !== 'GK');
    leaver.contractYears = 1;
    let out;
    do { out = w.stepWeek({}); } while (!out.seasonComplete);
    expect(club.squad.includes(leaver)).toBe(false);
    expect(leaver.clubId == null || leaver.retired || leaver.clubId !== club.id).toBe(true);
    expect(w.inbox.some(i => i.type === 'contract' && /final contract year/.test(i.text))).toBe(true);
  });
});

describe('finance', () => {
  it('debt rule: warning, freeze, then forced sales and administration', () => {
    const w = fresh(71);
    const club = w.clubs.find(c => c.division === 2);
    club.finance.balance = -2_000_000;
    expect(FIN.debtReview(club)).toBe('warning');
    expect(FIN.debtReview(club)).toBe('final');
    expect(FIN.spendingFrozen(club)).toBe(true);
    expect(FIN.debtReview(club)).toBe('forced');
    const before = club.squad.length;
    const sales = TR.forcedSales(w, club);
    expect(sales.length).toBeGreaterThan(0);
    expect(club.squad.length).toBe(before - sales.length);
    expect(club.finance.balance).toBeGreaterThan(-2_000_000);
  });

  it('every period reconciles: opening + items = closing', () => {
    const w = fresh(73);
    for (let i = 0; i < 4; i++) w.stepWeek({});
    for (const c of w.clubs) for (const l of c.ledger) {
      expect(l.opening + Object.values(l.items).reduce((a, b) => a + b, 0)).toBe(l.closing);
    }
  });
});

describe('transfers', () => {
  it('AI clubs bid for unlisted players at 30% or more over value', () => {
    const w = fresh(81);
    const club = w.club();
    for (const c of w.clubs) if (c.id !== club.id) c.finance.balance = Math.max(c.finance.balance, 3_000_000);
    const seen = [];
    for (let wk = 1; wk <= 400 && seen.length < 5; wk++) {
      w.pendingBids = [];
      for (const b of TR.generateIncomingBids(w, wk)) if (b.unsolicited) seen.push(b);
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const b of seen) expect(b.fee).toBeGreaterThanOrEqual(Math.floor(b.value * 1.3 / 1000) * 1000);
  });

  it('academy players aged 20+ can be listed; younger ones cannot', () => {
    const w = fresh(83);
    const club = w.club();
    const y = YOUTH.makeYouth(w, club); club.youth.push(y);
    y.age = 18;
    expect(w.toggleListed(y.id).ok).toBe(false);
    y.age = 20;
    expect(w.toggleListed(y.id).ok).toBe(true);
  });
});

describe('second club', () => {
  it('can be bought, funded and sold', () => {
    const w = fresh(91);
    const me = w.club();
    me.finance.balance = 50_000_000;
    const opt = w.secondClubOptions()[0];
    const r = w.buySecondClub(opt.id, 'club');
    expect(r.ok).toBe(true);
    expect(w.buySecondClub(w.secondClubOptions()[1].id).ok).toBe(false);
    const owned = w.clubById(opt.id);
    const bal = owned.finance.balance;
    expect(w.moveMoneySecondClub(100_000).ok).toBe(true);
    expect(owned.finance.balance).toBe(bal + 100_000);
    expect(w.sellSecondClub().ok).toBe(true);
    expect(w.manager.ownedClubId).toBeNull();
  });
});

describe('continental competition', () => {
  it('has its own group tables, knockouts and a winner', () => {
    const w = fresh(101, 'England');
    for (const comp of w.continental) for (const g of comp.groups) expect(g.table).toHaveLength(4);
    let out;
    do { out = w.stepWeek({}); } while (!out.seasonComplete);
    const winners = w.history.continentalWinners.filter(x => x.season === w.season - 1);
    expect(winners.length).toBe(w.data.continental.length);
  });
});
