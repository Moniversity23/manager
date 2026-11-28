// Formations as drawn on the Lineup screen and the match board (src/utils.js FORMATION_LAYOUT): every
// place where it belongs (a lone holding midfielder or striker central, full-backs and wingers on
// their own side, a 4-4-2's wide players in the midfield line), nobody on top of anybody, and the
// chosen formation kept through saving and reloading. The Lineup's cards show each player's overall
// rating, with how well he suits his slot shown apart.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';
const { FORMATION_SLOTS, FORMATION_LAYOUT } = require('../src/utils.js');
const { GameWorld } = require('../src/index.js');

describe('formation layout', () => {
  it('has a place for every slot of every formation, on the pitch', () => {
    expect(Object.keys(FORMATION_LAYOUT).sort()).toEqual(Object.keys(FORMATION_SLOTS).sort());
    for (const [f, slots] of Object.entries(FORMATION_SLOTS)) {
      expect(FORMATION_LAYOUT[f], f).toHaveLength(slots.length);
      for (const [d, y] of FORMATION_LAYOUT[f]) { expect(d).toBeGreaterThan(0); expect(d).toBeLessThan(0.9); expect(y).toBeGreaterThan(0.05); expect(y).toBeLessThan(0.95); }
    }
  });

  it('puts each slot where it belongs', () => {
    for (const [f, slots] of Object.entries(FORMATION_SLOTS)) {
      const L = FORMATION_LAYOUT[f], at = slot => slots.map((s, i) => (s === slot ? L[i] : null)).filter(Boolean);
      expect(at('GK')[0], f).toEqual([0.05, 0.5]);
      for (const i of slots.keys()) if (slots[i] !== 'GK') expect(L[i][0], `${f} ${slots[i]} ahead of the keeper`).toBeGreaterThan(0.15);
      for (const s of ['LB', 'LW']) for (const [, y] of at(s)) expect(y, `${f} ${s}`).toBeLessThan(0.2);
      for (const s of ['RB', 'RW']) for (const [, y] of at(s)) expect(y, `${f} ${s}`).toBeGreaterThan(0.8);
      for (const s of ['CDM', 'ST', 'CAM']) if (at(s).length === 1) expect(at(s)[0][1], `${f}: a lone ${s} is central`).toBeCloseTo(0.5, 5);
      // Strikers ahead of midfielders, midfielders ahead of centre-backs.
      const depth = s => Math.min(...at(s).map(p => p[0]));
      if (at('ST').length) expect(depth('ST'), f).toBeGreaterThan(Math.max(...[...at('CM'), ...at('CDM')].map(p => p[0])));
      expect(depth('CB'), f).toBeLessThan(Math.min(...[...at('CM'), ...at('CDM')].map(p => p[0])));
    }
    // A 4-4-2's wide players stand in the midfield line, not with the strikers.
    const L = FORMATION_LAYOUT['4-4-2'], S = FORMATION_SLOTS['4-4-2'];
    const cm = L[S.indexOf('CM')][0], lw = L[S.indexOf('LW')][0], st = L[S.indexOf('ST')][0];
    expect(Math.abs(lw - cm)).toBeLessThan(0.06);
    expect(st - lw).toBeGreaterThan(0.2);
  });

  it('is left-right symmetric and keeps every player clear of the others', () => {
    for (const [f, L] of Object.entries(FORMATION_LAYOUT)) {
      for (const [d, y] of L) expect(L.some(([d2, y2]) => Math.abs(d2 - d) < 1e-9 && Math.abs(y2 - (1 - y)) < 1e-9), `${f}: mirror of ${d},${y}`).toBe(true);
      // On the drawn pitch (about 0.78 wide for 1 tall; depth 0.76 → 0.8 of the height) cards are
      // about 0.18 of the width and 0.13 of the height: no two may overlap in both directions.
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const dx = Math.abs(L[i][1] - L[j][1]), dy = Math.abs(L[i][0] - L[j][0]) / 0.76 * 0.8;
        expect(dx >= 0.17 || dy >= 0.12, `${f}: places ${i} and ${j} overlap`).toBe(true);
      }
    }
  });
});

describe('the chosen formation', () => {
  it('is in the snapshot with its layout, and survives saving and reloading', () => {
    const w = new GameWorld({ seed: 23, startCountry: 'England' });
    w.applyDecisions({ formation: '3-5-2' });
    const snap = w.snapshot();
    expect(snap.formation).toBe('3-5-2');
    expect(snap.formationLayouts['3-5-2']).toEqual(FORMATION_LAYOUT['3-5-2']);
    expect(snap.currentXI.map(s => s.slot)).toEqual(FORMATION_SLOTS['3-5-2']);
    const w2 = GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave())));
    const s2 = w2.snapshot();
    expect(s2.formation).toBe('3-5-2');
    expect(s2.currentXI.map(s => s.slotKey)).toEqual(snap.currentXI.map(s => s.slotKey));
    // And it is still the formation after a week is played.
    w2.stepWeek({});
    expect(w2.snapshot().formation).toBe('3-5-2');
  });
});

describe('Lineup cards', () => {
  it('show each player\'s overall rating, with his suitability for the slot apart', () => {
    const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf-8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const el = () => ({ innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, appendChild() {}, querySelectorAll() { return []; }, querySelector() { return null; } });
    const ctx = vm.createContext({ document: { getElementById: el, querySelectorAll: () => [], createElement: el, addEventListener() {}, documentElement: { dataset: {} } }, window: { location: { origin: 'x' }, addEventListener() {}, innerWidth: 1200 },
      navigator: {}, location: { protocol: 'file:' }, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ json: async () => ({}) }), setTimeout: () => 0, clearTimeout() {}, console, URL, Blob: class {} });
    for (const s of scripts) vm.runInContext(s, ctx);
    const w = new GameWorld({ seed: 23, startCountry: 'England' });
    ctx.SNAP = JSON.parse(JSON.stringify(w.snapshot()));
    vm.runInContext('STATE = SNAP;', ctx);
    const out = vm.runInContext('rLineup()', ctx);
    const snap = ctx.SNAP;
    for (const s of snap.currentXI) {
      const p = snap.squad.find(q => q.id === s.playerId);
      // The big number on his card is his overall rating, whatever his rating in the slot.
      expect(out).toContain(`<span class="lc-o">${p.ovr}</span><span class="lc-p">${s.slot}</span>`);
    }
    expect(out).toMatch(/lc-s lc-s[nox]/);                               // suitability marks
    expect(out).toContain('fp-spot');                                    // placed on the formation pitch
    // A player out of position: overall rating on the card, his lower slot rating in its title.
    const card = vm.runInContext(`miniCard({ id: 1, name: 'A Keeper', position: 'GK', ovr: 70, attrs: { strength: 40, vision: 40, workRate: 40, defending: 40, pace: 40, finishing: 40, passing: 40, dribbling: 40 }, fit: 90 }, { slot: 'ST' })`, ctx);
    expect(card).toContain('<span class="lc-o">70</span>');
    expect(card).toContain('lc-sx');
    expect(card).toMatch(/\d+ as ST \(wrong position/);
  });
});
