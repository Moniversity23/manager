// src/api.js — every game endpoint, independent of the transport.
//
// The Node server (src/server.js) and the offline browser engine (src/webEngine.js) both call
// createApi() with their own save store, so the game behaves the same online and offline.
// handle(method, pathname, query, body) → { status, payload }. Every payload is { ok, error?, ... }.
//
// A store provides: save(slot, gameState, meta), load(slot) → { gameState, recovered, loadedFrom,
// errors } | null, backup(slot, raw, v), remove(slot), listMeta(), readDoc(name), writeDoc(name, obj),
// backend(), flush().

const { GameWorld } = require('./index');
const { SAVE_VERSION } = require('./migrations');
const { TACTICS, FORMATIONS } = require('./utils');
const { attachRoutes: attachStudioRoutes } = require('./studio/studioApi');

const MANUAL_SLOTS = ['slot_1', 'slot_2', 'slot_3'];
const ALL_SLOTS = ['auto', ...MANUAL_SLOTS];

function createApi({ store, stateHash, randomSeed, log = console, now = () => new Date(), publicMode = false }) {
  let world = null;          // no throwaway world: null until a career is restored or created
  let debounceTimer = null;

  function buildMeta() {
    const c = world.club();
    const lg = world.league();
    return {
      club: c.name, country: c.country, division: c.division, season: `${world.season}/${world.season + 1}`,
      week: world.currentWeek, position: lg.positionOf(c.id), points: lg.sorted().find(r => r.clubId === c.id)?.pts ?? 0,
      reputation: world.manager.reputation, trophies: world.manager.trophies, v: SAVE_VERSION, savedAt: now().toISOString(),
    };
  }

  function logError(route, e) {
    const where = world ? `season ${world.season} week ${world.currentWeek}` : 'no career';
    log.error(`[${route}] (${where}) ${e && e.stack ? e.stack : e}`);
  }

  async function autoSave() {
    if (!world) return null;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    try {
      const r = await store.save('auto', world.toSave(), buildMeta());
      await submitLeaderboard();
      return r;
    } catch (e) { logError('autoSave', e); return null; }
  }

  // The autosave after a week or a half runs in the background, so the reply is not held up by
  // serialising and compressing the whole world. Saves run one at a time; a queued save that has
  // not started yet is reused, and it captures the newest state when it runs. Everything that
  // reads saves or reports the state's hash waits for the queue first (flushSaves), and the server
  // flushes it on shutdown. A crash can lose at most the week being saved.
  let queued = null, running = Promise.resolve();
  function queueAutoSave() {
    if (queued) return queued;
    const p = running.then(() => { queued = null; return autoSave(); });
    queued = p; running = p.catch(() => null);
    return p;
  }
  async function flushSaves() { await running; }

  // Lineup and tactic edits are saved 5 s after the last change.
  function autoSaveDebounced() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; autoSave(); }, 5000);
  }

  async function restoreFrom(slotId) {
    await flushSaves();
    const saved = await store.load(slotId);
    if (!saved || !saved.gameState) return { ok: false, error: saved?.errors?.length ? `Save is corrupt: ${saved.errors.join('; ')}` : 'no_save_found' };
    const v = saved.gameState._v || 6;
    const restored = GameWorld.fromSave(saved.gameState); // throws on a newer save version
    if (v < SAVE_VERSION) await store.backup(slotId, saved.gameState, v);
    world = restored;
    if (v < SAVE_VERSION) await autoSave();
    return { ok: true, recovered: !!saved.recovered, loadedFrom: saved.loadedFrom, migratedFrom: v < SAVE_VERSION ? v : null };
  }

  async function tryRestoreAutoSave() {
    try {
      const r = await restoreFrom('auto');
      if (r.ok) log.log(`✓ Auto-save restored${r.recovered ? ` from ${r.loadedFrom} (newest was corrupt)` : ''}: ${world.club().name}, season ${world.season}, week ${world.currentWeek}`);
      return r.ok;
    } catch (e) { logError('restore', e); return false; }
  }

  // ── leaderboard: one entry per career (seed + start club), best score kept ──
  async function readBoard() { try { return (await store.readDoc('leaderboard')) || { entries: [] }; } catch { return { entries: [] }; } }
  let boardKey = null;
  async function submitLeaderboard() {
    if (!world || !world.leaderboardEntry) return;
    // Once per played week (not on every click).
    const key = `${world.manager.careerId}:${world.season}:${world.currentWeek}`;
    if (key === boardKey) return;
    boardKey = key;
    const entry = world.leaderboardEntry();
    if (!entry) return;
    const board = await readBoard();
    const i = board.entries.findIndex(e => e.careerId === entry.careerId);
    if (i >= 0) board.entries[i] = { ...entry, updatedAt: now().toISOString() };
    else board.entries.push({ ...entry, updatedAt: now().toISOString() });
    board.entries.sort((a, b) => b.score - a.score);
    board.entries = board.entries.slice(0, 100);
    await store.writeDoc('leaderboard', board);
  }

  const snap = () => world.snapshot();

  // ── routes ──────────────────────────────────────────────────────
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, opts });

  route('GET', '/api/health', async () => ({ ok: true, public: publicMode, db: store.backend(), hasCareer: !!world, saveVersion: SAVE_VERSION, time: now().toISOString() }));
  route('GET', '/api/state', async () => (world ? snap() : { ok: false, hasCareer: false, error: 'No career in progress' }));
  route('GET', '/api/state-hash', async () => { await flushSaves(); return { ok: true, hash: stateHash(world.toSave()), season: world.season, week: world.currentWeek }; }, { world: true });

  route('GET', '/api/setup', async () => {
    const setup = GameWorld.setupClubs();
    const countries = GameWorld.availableCountries();
    const clubsByCountry = Object.fromEntries(countries.map(c => [c, setup[c].clubs]));
    const leagueByCountry = Object.fromEntries(countries.map(c => [c, setup[c].league]));
    return { ok: true, defaultCountry: 'Nigeria', countries, clubsByCountry, leagueByCountry, tactics: TACTICS, formations: FORMATIONS };
  });

  route('GET', '/api/saves', async () => { await flushSaves(); return { ok: true, slots: await store.listMeta() }; });

  route('POST', /^\/api\/saves\/([\w]+)$/, async (m) => {
    const slotId = m[1];
    if (!MANUAL_SLOTS.includes(slotId)) return { ok: false, status: 400, error: 'invalid_slot' };
    const meta = buildMeta();
    await store.save(slotId, world.toSave(), meta);
    return { ok: true, meta };
  }, { world: true });

  route('POST', /^\/api\/load\/([\w]+)$/, async (m) => {
    const slotId = m[1];
    if (!ALL_SLOTS.includes(slotId)) return { ok: false, status: 400, error: 'invalid_slot' };
    const r = await restoreFrom(slotId);
    if (!r.ok) return { ...r, status: 404 };
    if (slotId !== 'auto') await autoSave();
    return { ...snap(), ok: true, recovered: r.recovered, loadedFrom: r.loadedFrom, migratedFrom: r.migratedFrom };
  });

  route('DELETE', /^\/api\/saves\/([\w]+)$/, async (m) => {
    if (!MANUAL_SLOTS.includes(m[1])) return { ok: false, status: 400, error: 'Only manual slots can be deleted' };
    await store.remove(m[1]);
    return { ok: true };
  });

  route('POST', '/api/reset', async (m, body) => {
    let seed = Number.isInteger(body.seed) ? body.seed >>> 0 : randomSeed();
    let country = body.country || 'Nigeria', mode = body.mode, clubName = body.clubName;
    if (body.challenge) {
      const c = GameWorld.decodeChallenge(body.challenge);
      if (!c) return { ok: false, status: 400, error: 'That challenge code is not valid' };
      seed = c.seed; country = c.country;
      if (c.clubName) { mode = 'existing'; clubName = c.clubName; } else mode = 'create';
    }
    if (mode === 'create' && !body.customClubName) return { ok: false, status: 400, error: 'Enter a club name' };
    world = new GameWorld({
      seed, startCountry: country, mode,
      startClubName: mode === 'existing' ? clubName : undefined,
      customClubName: mode === 'create' ? body.customClubName : undefined,
      managerName: body.managerName,
    });
    await autoSave();
    return snap();
  });

  const sackedGuard = () => (world.manager.status === 'sacked'
    ? { ok: false, status: 409, sacked: true, error: 'You have been sacked — accept a job offer (Career) to continue.', current: snap() } : null);

  // Plays on until the week ends or one of the manager's matches reaches half-time (interactive).
  async function playOn(decisions, interactive) {
    const r = world.advanceWeek(decisions, interactive);
    queueAutoSave();
    if (r.halftime) {
      const done = world.weekState ? world.weekState.reports : [];
      return { ok: true, halftime: r.halftime, finished: done[done.length - 1] || null, current: snap() };
    }
    return { ok: true, out: r.out, matchResult: r.out.matchReport, current: snap() };
  }

  route('POST', '/api/step-week', async (m, body) => {
    const g = sackedGuard(); if (g) return g;
    if (body.tactic || body.formation || body.trainingFocus || body.trainingIntensity) world.applyDecisions(body);
    if (world.liveMatch && body.interactive) return { ok: true, halftime: world.halftimeView(), current: snap() };
    world.beginWeek();
    return playOn({}, !!body.interactive);
  }, { world: true });

  // The live match while it is watched (see GameWorld.liveChange): the second half is played but
  // kept open ({ live: true }), changes can be made from the next five-minute mark, and /finish
  // records the result at full time. The week then carries on with /api/step-week.
  const liveDecisions = body => ({ tactic: body.tactic, formation: body.formation, instructions: body.instructions && typeof body.instructions === 'object' ? body.instructions : null, subs: Array.isArray(body.subs) ? body.subs.slice(0, 5) : [], talk: body.talk });
  route('POST', '/api/match/state', async (m, body) => {
    if (!world.liveMatch) return { ok: false, status: 409, error: 'No live match' };
    return world.liveState(Number(body.minute));
  }, { world: true });
  route('POST', '/api/match/change', async (m, body) => {
    if (!world.liveMatch) return { ok: false, status: 409, error: 'No live match' };
    const r = world.liveChange(Number(body.minute), liveDecisions(body));
    if (r.ok) queueAutoSave();
    return r;
  }, { world: true });
  route('POST', '/api/match/finish', async () => {
    if (!world.liveMatch) return { ok: false, status: 409, error: 'No live match' };
    const finished = world.liveFinish();
    queueAutoSave();
    return { ok: true, finished, current: snap() };
  }, { world: true });

  route('POST', '/api/match/resume', async (m, body) => {
    if (!world.liveMatch) return { ok: false, status: 409, error: 'No match is paused at halftime' };
    if (body.live) { const live = world.liveResume(liveDecisions(body)); queueAutoSave(); return { ok: true, live, current: snap() }; }
    return playOn({ tactic: body.tactic, formation: body.formation, instructions: body.instructions && typeof body.instructions === 'object' ? body.instructions : null, subs: Array.isArray(body.subs) ? body.subs : [], talk: body.talk }, body.interactive !== false);
  }, { world: true });

  route('POST', '/api/step', async (m, body) => {
    const g = sackedGuard(); if (g) return g;
    const summary = world.stepSeason({ tactic: body.tactic, formation: body.formation, trainingFocus: body.trainingFocus, trainingIntensity: body.trainingIntensity });
    await autoSave();
    return { ok: true, summary, current: snap() };
  }, { world: true });

  route('POST', '/api/tactics', async (m, body) => { world.applyDecisions(body); autoSaveDebounced(); return { ok: true, current: snap() }; }, { world: true });
  route('POST', '/api/lineup', async (m, body) => {
    const r = world.setManualLineup(body.lineup || [], Array.isArray(body.bench) ? body.bench : null);
    autoSaveDebounced();
    return { ...r, current: snap() };
  }, { world: true });
  route('POST', '/api/lineup/clear', async () => { world.clearManualLineup(); autoSaveDebounced(); return { ok: true, current: snap() }; }, { world: true });

  // Every action that changes the game: run it, auto-save on success, return the new state.
  const action = (fn) => async (m, body) => {
    const r = fn(body, m);
    if (r.ok) await autoSave();
    return { ...r, status: r.ok || ['counter', 'rejected', 'withdrawn', 'walked'].includes(r.action) ? 200 : 400, current: snap() };
  };
  const read = (fn) => async (m, body, query) => fn(body, m, query);

  route('POST', '/api/transfer', action(b => world.buyPlayer(b.playerId, b.fromClubId || null, b.fee || 0)), { world: true });
  route('POST', '/api/loan', action(b => world.loanIn(b.playerId, b.fromClubId, b.loanFee, b.wageContribution)), { world: true });
  route('GET', /^\/api\/loan-out\/(\d+)$/, read((b, m) => world.loanOutOptions(Number(m[1]))), { world: true });
  route('POST', '/api/loan-out', action(b => world.loanOut(Number(b.playerId), Number(b.clubId))), { world: true });
  route('POST', '/api/loan-recall', action(b => world.recallLoan(Number(b.playerId))), { world: true });
  route('POST', '/api/release', async (m, b, q) => (b.dryRun ? world.releasePlayer(b.playerId, true) : action(x => world.releasePlayer(x.playerId))(m, b, q)), { world: true });
  route('POST', /^\/api\/bids\/([\w-]+)\/counter$/, action((b, m) => world.counterBid(m[1], b.fee)), { world: true });
  route('POST', /^\/api\/bids\/([\w-]+)\/accept$/, action((b, m) => world.acceptBid(m[1])), { world: true });
  route('POST', /^\/api\/bids\/([\w-]+)\/reject$/, action((b, m) => world.rejectBid(m[1])), { world: true });
  route('POST', '/api/jobs/accept', action(b => world.acceptJob(Number(b.clubId))), { world: true });
  route('POST', '/api/jobs/decline', action(() => world.declineJobs()), { world: true });
  route('POST', '/api/jobs/apply', action(b => world.applyForJob(Number(b.clubId))), { world: true });
  route('POST', '/api/course/start', action(() => world.startCourse()), { world: true });
  route('GET', '/api/staff/candidates', read((b, m, q) => world.staffCandidates(q.get('role'))), { world: true });
  route('POST', '/api/staff/hire', action(b => world.hireStaff(b.role, Number(b.index))), { world: true });
  route('POST', '/api/staff/fire', action(b => world.fireStaff(b.role)), { world: true });
  route('POST', '/api/sponsor/accept', action(b => world.acceptSponsor(Number(b.index))), { world: true });
  route('POST', '/api/ticket-price', action(b => world.setTicketPrice(b.mult)), { world: true });
  route('POST', '/api/rename', action(b => world.rename(b.kind, b.id, b.name)), { world: true });
  route('POST', '/api/sell', action(b => world.sellPlayer(b.playerId)), { world: true });
  route('POST', '/api/list-player', action(b => world.toggleListed(b.playerId)), { world: true });
  route('POST', '/api/upgrade', action(b => world.upgradeFacility(b.facility)), { world: true });
  route('POST', '/api/promote-youth', action(b => world.promoteYouthPlayer(b.playerId)), { world: true });
  route('POST', '/api/scout', action(b => world.scoutRegion(b.region)), { world: true });
  route('POST', '/api/renew-contract', async (m, b, q) => {
    if (b.dryRun) return world.renewalTerms(b.playerId, b.years);
    return action(x => world.renew(x.playerId, x.years))(m, b, q);
  }, { world: true });

  // Scouting, agents and the dressing room.
  route('POST', '/api/scout/player', action(b => world.scoutPlayer(Number(b.playerId))), { world: true });
  route('POST', '/api/scout/cancel', action(b => world.cancelScouting(Number(b.playerId))), { world: true });
  route('GET', /^\/api\/player\/(\d+)$/, read((b, m) => world.playerDetail(Number(m[1]))), { world: true });
  route('POST', '/api/negotiate', async (m, b, q) => (b.dryRun ? world.negotiationTerms(Number(b.playerId)) : action(x => world.negotiate(Number(x.playerId), x))(m, b, q)), { world: true });
  route('POST', '/api/talk', action(b => world.playerTalk(Number(b.playerId), b.kind)), { world: true });
  route('POST', '/api/team-talk', action(b => world.teamTalk(b.kind)), { world: true });

  // International football.
  route('POST', '/api/national/accept', action(b => world.acceptNationalJob(b.country)), { world: true });
  route('POST', '/api/national/leave', action(() => world.leaveNationalJob()), { world: true });
  route('POST', '/api/national/squad', action(b => world.setNationalSquad(b.playerIds || [])), { world: true });

  // News, delegation, leaderboard.
  route('GET', '/api/news', read((b, m, q) => ({ ok: true, news: world.newsFeed(q.get('filter') || 'all') })), { world: true });
  route('POST', '/api/delegate', action(b => world.setDelegate(b)), { world: true });
  route('GET', '/api/leaderboard', async () => {
    const board = await readBoard();
    return { ok: true, entries: board.entries, mine: world && world.leaderboardEntry ? world.leaderboardEntry()?.careerId : null };
  });

  route('GET', '/api/second-club/options', async () => ({ ok: true, options: world.secondClubOptions(), wealth: Math.round(world.manager.wealth) }), { world: true });
  route('POST', '/api/second-club/buy', action(b => world.buySecondClub(b.clubId, b.source)), { world: true });
  route('POST', '/api/second-club/money', action(b => world.moveMoneySecondClub(b.amount)), { world: true });
  route('POST', '/api/second-club/upgrade', action(b => world.manager.ownedClubId ? world.upgradeFacility(b.facility, world.manager.ownedClubId) : { ok: false, error: 'You do not own a second club' }), { world: true });
  route('POST', '/api/second-club/sell', action(() => world.sellSecondClub()), { world: true });

  route('GET', '/api/league', read((b, m, q) => {
    const country = q.get('country'), name = q.get('name');
    if (!country || !name) return { ok: false, status: 400, error: 'country and name required' };
    return { ok: true, table: world.leagueTable(country, name) };
  }), { world: true });

  route('GET', /^\/api\/club\/(\d+)$/, read((b, m) => {
    const d = world.clubDetail(parseInt(m[1], 10));
    return d ? { ok: true, ...d } : { ok: false, status: 404, error: 'Club not found' };
  }), { world: true });

  route('GET', '/api/history', read((b, m, q) => ({ ok: true, ...world.historySnapshot(q.get('limit') || '10') })), { world: true });
  route('GET', '/api/hist', read(() => world.historyIndex()), { world: true });
  route('GET', '/api/hist/comp', read((b, m, q) => world.competitionHistory(q.get('key') || '')), { world: true });
  route('GET', /^\/api\/hist\/club\/(\d+)$/, read((b, m) => world.clubHistory(Number(m[1]))), { world: true });
  route('GET', /^\/api\/hist\/player\/(\d+)$/, read((b, m) => world.playerHistory(Number(m[1]))), { world: true });
  route('GET', '/api/hist/manager', read(() => world.managerCareer()), { world: true });
  route('GET', '/api/hist/search', read((b, m, q) => world.historySearch(q.get('q'))), { world: true });
  route('GET', '/api/hist/matches', read((b, m, q) => world.matchArchive(q.get('season') ? Number(q.get('season')) : null, q.get('club') ? Number(q.get('club')) : null)), { world: true });
  route('GET', /^\/api\/hist\/match\/(\d+)$/, read((b, m) => world.matchRecord(Number(m[1]))), { world: true });
  route('GET', '/api/export-save', async () => ({ ok: true, gameState: world.toSave(), meta: buildMeta() }), { world: true });

  route('POST', '/api/import-save', async (m, body) => {
    if (!body || !body.gameState) return { ok: false, status: 400, error: 'gameState required' };
    world = GameWorld.fromSave(body.gameState);
    await autoSave();
    return snap();
  });

  // navigator.sendBeacon target on page close.
  route('POST', '/api/autosave', async () => { await flushSaves(); if (world) await autoSave(); return { ok: true }; });

  async function handle(method, pathname, query, body) {
    // Public deployments serve the app only: every visitor plays in their own browser (offline engine).
    if (publicMode && pathname !== '/api/health') return { status: 403, payload: { ok: false, public: true, error: 'This server only hosts the game; careers run in your browser.' } };
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = typeof r.pattern === 'string' ? (r.pattern === pathname ? [pathname] : null) : pathname.match(r.pattern);
      if (!m) continue;
      try {
        if (r.opts.world && !world) return { status: 409, payload: { ok: false, hasCareer: false, error: 'No career in progress. Start a new career or load a save.' } };
        const out = await r.handler(m, body || {}, query || new URLSearchParams());
        const status = out.status || (out.ok === false ? 400 : 200);
        delete out.status;
        return { status, payload: out };
      } catch (e) {
        logError(`${method} ${pathname}`, e);
        return { status: 500, payload: { ok: false, error: e.message || 'Internal server error' } };
      }
    }
    return { status: 404, payload: { ok: false, error: 'not_found' } };
  }

  attachStudioRoutes(route, store, () => world, { save: () => queueAutoSave() });

  return { handle, autoSave, buildMeta, tryRestoreAutoSave, restoreFrom, getWorld: () => world, flush: async () => { await flushSaves(); await store.flush(); } };
}

module.exports = { createApi, MANUAL_SLOTS, ALL_SLOTS };
