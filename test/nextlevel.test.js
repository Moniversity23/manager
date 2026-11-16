// Next-level systems: scouting fog, agents and negotiation, the dressing room,
// international football, regional re-election, the newspaper, challenges and the leaderboard,
// the season budget (with the shirt sponsor), delegation, and the transport-free API used offline.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { GameWorld } = require('../src/index.js');
const { createApi } = require('../src/api.js');
const { stateHash } = require('../src/saveStore.js');
const SCOUT = require('../src/engine/scoutingEngine.js');
const NEG = require('../src/engine/negotiationEngine.js');
const DR = require('../src/engine/dressingRoomEngine.js');
const RENAMES = require('../src/data/renames.json');

const playSeason = (w) => { let out; do { out = w.stepWeek({}); if (w.manager.status === 'sacked') w.acceptJob(w.jobOffers[0].clubId); } while (!out.seasonComplete); return out; };

describe('scouting fog', () => {
  it('shows ranges that contain the truth, and a full report reveals the exact player', () => {
    const w = new GameWorld({ seed: 301, startCountry: 'England' });
    const snap = w.snapshot();
    const fogged = snap.market.filter(r => r.fog);
    expect(fogged.length).toBeGreaterThan(20);
    for (const r of fogged) {
      const p = w.players.get(r.id);
      expect(r.ovrLo).toBeLessThanOrEqual(Math.round(p.currentAbility));
      expect(r.ovrHi).toBeGreaterThanOrEqual(Math.round(p.currentAbility));
    }
    // Own players are never fogged.
    expect(snap.squad.every(p => !p.fog)).toBe(true);
    const target = w.players.get(fogged.sort((a, b) => a.known - b.known)[0].id);
    w.club().finance.balance = 1_000_000;
    expect(w.scoutPlayer(target.id).ok).toBe(true);
    for (let i = 0; i < 6 && SCOUT.knowledge(w, target, w.club()) < 100; i++) w.stepWeek({});
    expect(SCOUT.knowledge(w, target, w.club())).toBe(100);
    expect(w.scouting.reports.some(r => r.playerId === target.id)).toBe(true);
    const row = w.snapshot().market.find(r => r.id === target.id);
    if (row) expect(row.fog).toBeFalsy();
  });
});

describe('agents and contract talks', () => {
  it('accepts the asking terms, counters a near offer, walks out on a lowball', () => {
    const w = new GameWorld({ seed: 302, startCountry: 'Spain' });
    const me = w.club();
    me.finance.balance = 5_000_000;
    const [a, b, c] = me.squad.filter(p => !p.retired).slice(0, 3);
    const da = w.negotiationTerms(a.id).demand;
    const ok = w.negotiate(a.id, { wage: da.wage, bonus: da.bonus, agentFee: da.agentFee, years: da.years, role: da.role, releaseClause: da.wantsClause ? 10_000_000 : 0 });
    expect(ok.ok).toBe(true);
    expect(a.weeklyWage).toBe(da.wage);
    if (da.agentFee) expect(me.finance.period.items['Agent fees']).toBeLessThan(0);

    const db = w.negotiationTerms(b.id).demand;
    const near = w.negotiate(b.id, { wage: Math.round(db.wage * 0.9), bonus: Math.round(db.bonus * 0.9), agentFee: Math.round(db.agentFee * 0.9), years: db.years, role: db.role, releaseClause: db.wantsClause ? 10_000_000 : 0 });
    expect(['counter', 'accepted']).toContain(near.action);

    const dc = w.negotiationTerms(c.id).demand;
    const low = w.negotiate(c.id, { wage: Math.round(dc.wage * 0.4), bonus: 0, agentFee: 0, years: dc.years, role: dc.role });
    expect(low.action).toBe('walked');
    expect(w.negotiate(c.id, dc).ok).toBe(false); // blocked for four weeks
  });

  it('signs a free agent on personal terms and records a promise of playing time', () => {
    const w = new GameWorld({ seed: 303, startCountry: 'Ghana' });
    const me = w.club();
    me.finance.balance = 3_000_000;
    const seller = w.clubs.find(x => x.id !== me.id && x.division === 3);
    const fa = seller.squad.find(p => p.age > 18);
    require('../src/engine/transferEngine.js').releasePlayer(w, seller, fa);
    expect(fa.clubId).toBeNull();
    const t = w.negotiationTerms(fa.id);
    expect(t.kind).toBe('sign');
    const better = NEG.ROLES[Math.max(0, NEG.ROLES.indexOf(t.demand.role) - 1)];
    const r = w.negotiate(fa.id, { ...t.demand, role: better, releaseClause: t.demand.wantsClause ? 5_000_000 : 0 });
    expect(r.ok).toBe(true);
    expect(fa.clubId).toBe(me.id);
    if (better !== t.demand.role) expect(fa.promise && fa.promise.role).toBe(better);
  });
});

describe('dressing room', () => {
  it('a benched star loses morale and eventually asks to leave; a talk can win him back', () => {
    const w = new GameWorld({ seed: 305, startCountry: 'Germany' });
    const me = w.club();
    const star = me.squad.slice().sort((a, b) => b.currentAbility - a.currentAbility)[0];
    star.personality = 'Temperamental';
    star.morale = 45;
    star.playLog = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++) DR.weekly(w, me, []);
    expect(star.morale).toBeLessThan(35);
    expect(star.wantsOut).toBe(true);
    star.morale = 45;
    const r = w.playerTalk(star.id, 'stay');
    expect(r.ok).toBe(true);
    expect(star.wantsOut).toBe(false);
    expect(w.playerTalk(star.id, 'praise').ok).toBe(false); // one talk per week
    expect(w.teamTalk('motivate').ok).toBe(true);
    expect(w.snapshot().dressingRoom.players.length).toBe(me.squad.length);
  });
});

describe('a full season of the new world', () => {
  it('plays the Nations League, re-elects the bottom clubs, writes the paper and scores challenges', () => {
    const w = new GameWorld({ seed: 306, startCountry: 'Nigeria' });
    const bottomBefore = new Map(w.pyramids.map(p => [p.country, [...w.leagueById(p.leagueIds[3]).clubIds]]));
    const myId = w.club().id;
    playSeason(w);
    // International
    const nl = w.intl.winners.find(x => x.comp === 'Nations League');
    expect(nl).toBeTruthy();
    expect([...w.players.values()].some(p => (p.history.caps || 0) > 0)).toBe(true);
    // Regional re-election: two clubs per bottom division replaced by new names
    const banned = new Set(Object.values(RENAMES.clubs).flatMap(m => Object.keys(m)));
    for (const pyr of w.pyramids) {
      const now = w.leagueById(pyr.leagueIds[3]).clubIds;
      expect(now).toHaveLength(15);
      const fresh = now.filter(id => !w.clubs.some(c => c.id === id && bottomBefore.get(pyr.country).includes(id)) && id > 600);
      expect(fresh.length).toBeGreaterThanOrEqual(2);
      for (const id of fresh) expect(banned.has(w.clubById(id).name)).toBe(false);
    }
    expect(w.clubById(myId)).toBeTruthy();
    // Paper, challenges, leaderboard
    expect(w.news.length).toBeGreaterThan(20);
    expect(w.news.some(n => n.kind === 'title')).toBe(true);
    expect(w.challenges.history.length).toBeGreaterThan(5);
    const entry = w.leaderboardEntry();
    expect(entry.score).toBeGreaterThan(0);
    expect(entry.code).toMatch(/^GAF-/);
    // Save/load keeps all of it
    const again = GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));
    expect(stateHash(again.toSave())).toBe(stateHash(w.toSave()));
  });
});

describe('challenge codes, budget and delegation', () => {
  it('a challenge code rebuilds the exact same world at the same club', () => {
    const a = new GameWorld({ seed: 987654, startCountry: 'Brazil', mode: 'existing', startClubName: GameWorld.setupClubs().Brazil.clubs[4] });
    const d = GameWorld.decodeChallenge(a.manager.challengeCode);
    expect(d).toEqual({ seed: 987654, country: 'Brazil', clubName: GameWorld.setupClubs().Brazil.clubs[4] });
    const b = new GameWorld({ seed: d.seed, startCountry: d.country, mode: 'existing', startClubName: d.clubName });
    expect(stateHash(b.toSave())).toBe(stateHash(a.toSave()));
  });

  it('the season budget includes the shirt sponsor and its bonuses', () => {
    const w = new GameWorld({ seed: 307, startCountry: 'USA' });
    const before = w.snapshot().budget;
    expect(before.season.sponsor).toBeGreaterThan(0);
    expect(w.sponsorOffers[2].bonus.promotion).toBeGreaterThan(0);
    w.acceptSponsor(2);
    const after = w.snapshot().budget;
    expect(after.sponsor.name).toBe(w.club().sponsor.name);
    expect(after.season.sponsor).toBe(Math.round(w.club().sponsor.perSeason * (w.econ || 1)));
    expect(after.sponsor.bonus).toEqual(w.club().sponsor.bonus);
    expect(after.transferBudget).toBeLessThanOrEqual(Math.max(0, w.club().finance.balance));
    expect(after.wageBudget).toBeGreaterThan(0);
  });

  it('delegated bids: key players are protected', () => {
    const w = new GameWorld({ seed: 308, startCountry: 'Argentina' });
    w.setDelegate({ bids: true });
    const me = w.club();
    const key = me.squad.slice().sort((a, b) => b.currentAbility - a.currentAbility)[0];
    const buyer = w.clubs.find(c => c.id !== me.id && c.division === 1);
    w.pendingBids = [{ id: 'bx', playerId: key.id, clubId: buyer.id, fee: 1000, maxFee: 1000, value: 100000, week: 1, expiresWeek: 3 }];
    expect(w._autoBid(w.pendingBids[0])).toBe(true);
    expect(w.pendingBids).toHaveLength(0);
    expect(key.clubId).toBe(me.id);
  });
});

describe('transport-free API (the offline engine runs this)', () => {
  it('starts a career, plays a week, saves and reloads through an in-memory store', async () => {
    const mem = new Map();
    const store = {
      backend: () => 'memory', flush: async () => {},
      save: async (slot, gameState, meta) => { mem.set(slot, JSON.parse(JSON.stringify({ gameState, meta }))); return { ok: true }; },
      load: async slot => (mem.has(slot) ? { ...mem.get(slot), loadedFrom: slot, recovered: false, errors: [] } : null),
      backup: async () => {}, remove: async slot => mem.delete(slot), listMeta: async () => Object.fromEntries([...mem.keys()].map(k => [k, mem.get(k).meta])),
      readDoc: async name => mem.get(`doc:${name}`) || null, writeDoc: async (name, doc) => { mem.set(`doc:${name}`, doc); },
    };
    const api = createApi({ store, stateHash, randomSeed: () => 4242, log: { log() {}, error() {} } });
    const call = (m, path, body) => { const u = new URL(path, 'http://x'); return api.handle(m, u.pathname, u.searchParams, body); };
    expect((await call('GET', '/api/state')).payload.hasCareer).toBe(false);
    const start = await call('POST', '/api/reset', { country: 'Australia', mode: 'existing', clubName: GameWorld.setupClubs().Australia.clubs[0] });
    expect(start.payload.hasCareer).toBe(true);
    const wk = await call('POST', '/api/step-week', { interactive: false });
    expect(wk.payload.ok).toBe(true);
    const h1 = (await call('GET', '/api/state-hash')).payload.hash;
    expect((await call('POST', '/api/load/auto')).payload.ok).toBe(true);
    expect((await call('GET', '/api/state-hash')).payload.hash).toBe(h1);
    const lb = (await call('GET', '/api/leaderboard')).payload;
    expect(lb.entries.length).toBe(1);
    expect((await call('GET', '/api/news')).payload.ok).toBe(true);
    const bad = await call('POST', '/api/reset', { challenge: 'nonsense' });
    expect(bad.status).toBe(400);
  });
});

describe('revamp: sponsor cash, ratings, Golden Ball, levels, public hosting', () => {
  it('signing a shirt sponsor pays 30% into the balance at once and the season total is unchanged', () => {
    const w = new GameWorld({ seed: 401, startCountry: 'Nigeria' });
    const me = w.club();
    const before = me.finance.balance;
    const r = w.acceptSponsor(0);
    expect(r.upfront).toBe(Math.round(me.sponsor.perSeason * 0.3));
    expect(me.finance.balance).toBe(before + r.upfront);
    expect(me.finance.period.items.Sponsorship).toBe(r.upfront);
    const b = w.snapshot().budget;
    expect(b.income.sponsor).toBe(Math.round((me.sponsor.perSeason - r.upfront) * (w.econ || 1)));
  });

  it('rates every player in your match, names a man of the match and tracks form', () => {
    const w = new GameWorld({ seed: 402, startCountry: 'Spain' });
    let rep = null;
    for (let i = 0; i < 4 && !rep; i++) { const out = w.stepWeek({}); rep = out.reports[0] || null; }
    expect(rep.ratings.home.length).toBeGreaterThanOrEqual(11);
    for (const x of [...rep.ratings.home, ...rep.ratings.away]) { expect(x.rating).toBeGreaterThanOrEqual(3.5); expect(x.rating).toBeLessThanOrEqual(10); }
    expect(rep.motm.rating).toBe(Math.max(...rep.ratings.home.map(x => x.rating), ...rep.ratings.away.map(x => x.rating)));
    const snap = w.snapshot();
    expect(snap.squad.some(p => p.form != null)).toBe(true);
    expect(snap.squad.every(p => p.progress != null)).toBe(true);
    expect(snap.challenges.level.level).toBeGreaterThanOrEqual(1);
    expect(snap.awardsRace.world.length).toBe(10);
  });

  it('awards the Golden Ball with a top ten and a team of the season', () => {
    const w = new GameWorld({ seed: 403, startCountry: 'Ghana' });
    const out = playSeason(w);
    const g = w.history.goldenBall[0];
    expect(g.top).toHaveLength(10);
    expect(g.winner.name).toBe(g.top[0].name);
    expect(g.team).toHaveLength(11);
    expect(g.team[0].position).toBe('GK');
    expect(out.endSummary.goldenBall.name).toBe(g.winner.name);
    expect(w.snapshot().goldenBall[0].season).toBe(g.season);
  });

  it('a public host only serves the app: no shared career on the server', async () => {
    const store = { backend: () => 'memory', flush: async () => {}, save: async () => ({ ok: true }), load: async () => null, backup: async () => {}, remove: async () => true, listMeta: async () => ({}), readDoc: async () => null, writeDoc: async () => {} };
    const api = createApi({ store, stateHash, randomSeed: () => 1, log: { log() {}, error() {} }, publicMode: true });
    const q = new URLSearchParams();
    expect((await api.handle('GET', '/api/health', q, {})).payload.public).toBe(true);
    expect((await api.handle('POST', '/api/reset', q, { country: 'Nigeria' })).status).toBe(403);
  });
});
