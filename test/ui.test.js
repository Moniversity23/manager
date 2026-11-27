// UI wiring: every screen renders from a real engine snapshot without throwing, so the single-file
// UI can never drift from the snapshot fields again (the original Phase 0 wiring bug).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import vm from 'vm';
const require = createRequire(import.meta.url);
const { GameWorld } = require('../src/index.js');

function stubElement() {
  const el = {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [], disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, remove() {}, focus() {}, click() {},
    querySelectorAll() { return []; }, querySelector() { return null; },   // as the DOM: nothing found
  };
  return el;
}

function loadUI() {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf-8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const els = new Map();
  const document = {
    getElementById: id => { if (!els.has(id)) els.set(id, stubElement()); return els.get(id); },
    querySelectorAll: () => [], createElement: () => stubElement(), addEventListener() {},
    documentElement: { dataset: {} },
  };
  const ctx = vm.createContext({
    document, window: { location: { origin: 'http://test' }, addEventListener() {}, innerWidth: 1200 },
    navigator: { sendBeacon() {}, clipboard: { writeText() {} } }, location: { protocol: 'file:' }, localStorage: { getItem: () => null, setItem() {} }, prompt: () => null, fetch: async () => ({ json: async () => ({ ok: false }) }),
    setTimeout: () => 0, clearTimeout() {}, console, URL, Blob: class {}, confirm: () => true,
  });
  for (const s of scripts) vm.runInContext(s, ctx);
  return { ctx, els };
}

describe('single-file UI', () => {
  it('renders every screen, halftime, match report and season end from the live snapshot', () => {
    const w = new GameWorld({ seed: 17, startCountry: 'Nigeria' });
    for (let i = 0; i < 3; i++) w.stepWeek({});
    let ht;
    do { ht = w.advanceWeek({}, true).halftime; } while (!ht);
    w.club().finance.balance = 30_000_000;
    w.buySecondClub(w.secondClubOptions()[0].id, 'club');
    const snap = JSON.parse(JSON.stringify(w.snapshot()));
    expect(snap.liveMatch).toBeTruthy();

    const { ctx, els } = loadUI();
    ctx.SNAP = snap;
    vm.runInContext('STATE = SNAP; SETUP = { countries: [], clubsByCountry: {}, leagueByCountry: {} };', ctx);
    const screens = ['rDash', 'rInbox', 'rSquad', 'rLineup', 'rTactics', 'rFixtures', 'rContinental', 'rTransfers', 'rAcademy', 'rFinances', 'rClub2', 'rPerf', 'rLeagues', 'rCup', 'rStaff', 'rCareer', 'rAwards', 'rSettings', 'rNews', 'rDressing', 'rScouting', 'rInternational', 'rChallenges'];
    for (const fn of screens) {
      const out = vm.runInContext(`${fn}()`, ctx);
      expect(typeof out, fn).toBe('string');
      expect(out.length, fn).toBeGreaterThan(50);
      expect(out, fn).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
    vm.runInContext('showHalftime(STATE.liveMatch)', ctx);
    expect(els.get('genMoContent').innerHTML).toMatch(/Half-time/);
    expect(els.get('genMoContent').innerHTML).toMatch(/Team talk/);
    // Action centre and budget render from the same snapshot.
    expect(vm.runInContext('rDash()', ctx)).toMatch(/Decisions|Nothing needs you/);
    expect(vm.runInContext('rFinances()', ctx)).toMatch(/Season budget/);

    const out = w.advanceWeek({}, false).out;
    ctx.REPORT = JSON.parse(JSON.stringify(out.matchReport));
    expect(vm.runInContext('matchReportHTML(REPORT)', ctx)).toMatch(/xG/);
    expect(ctx.REPORT.lineups.home).toHaveLength(11);
    expect(vm.runInContext('normalizeMatch(REPORT).events.length', ctx)).toBeGreaterThan(5);
    vm.runInContext('updateTopbar()', ctx);
    expect(els.get('winPill').innerHTML).toMatch(/WINDOW|Closed/);
    expect(els.get('continueBtn').textContent).toMatch(/Play|Continue|Resume/);

    let end;
    do { end = w.stepWeek({}); } while (!end.seasonComplete);
    ctx.SUMMARY = JSON.parse(JSON.stringify(end.endSummary));
    ctx.SNAP2 = JSON.parse(JSON.stringify(w.snapshot()));
    vm.runInContext('STATE = SNAP2; showSeasonEnd(SUMMARY)', ctx);
    expect(els.get('genMoContent').innerHTML).toMatch(/complete/);
  });
});
