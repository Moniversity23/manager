// Server: no throwaway world, setup lists only lowest-division clubs, halftime flow, and
// "save, kill the server, restart, load → identical state hash".
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gaffer-srv-'));
let proc = null;

function start() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
      cwd: ROOT, env: { ...process.env, SAVE_BACKEND: 'file', SAVE_DIR, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${buf}`)), 60_000);
    proc.stdout.on('data', d => {
      buf += d.toString();
      const m = buf.match(/LISTENING (\d+)/);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
    });
    proc.stderr.on('data', d => { buf += d.toString(); });
    proc.on('exit', code => { clearTimeout(timer); if (!buf.includes('LISTENING')) reject(new Error(`server exited ${code}: ${buf}`)); });
  });
}

function kill() {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', () => resolve());
    proc.kill('SIGKILL');
  });
}

const call = async (base, method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};

afterAll(async () => { await kill(); fs.rmSync(SAVE_DIR, { recursive: true, force: true }); });

describe('server', () => {
  it('boots without a career, refuses non-bottom clubs, plays a halftime, and survives a hard restart', async () => {
    let base = await start();

    const state0 = await call(base, 'GET', '/api/state');
    expect(state0.ok).toBe(false);
    expect(state0.hasCareer).toBe(false);

    const setup = await call(base, 'GET', '/api/setup');
    expect(setup.ok).toBe(true);
    const nigeria = setup.clubsByCountry.Nigeria;
    expect(nigeria).toHaveLength(15);
    expect(nigeria).not.toContain('Lagos Harbor FC');

    const bad = await call(base, 'POST', '/api/reset', { country: 'Nigeria', mode: 'existing', clubName: 'Lagos Harbor FC', seed: 9 });
    expect(bad.ok).toBe(false);

    const pick = nigeria[3];
    const s = await call(base, 'POST', '/api/reset', { country: 'Nigeria', mode: 'existing', clubName: pick, seed: 9 });
    expect(s.ok).toBe(true);
    expect(s.club).toBe(pick);
    expect(s.division).toBe(4);
    expect(s.transferWindow.open).toBe(true);
    expect(s.currentXI).toHaveLength(11);

    const tac = await call(base, 'POST', '/api/tactics', { tactic: 'counter', formation: '4-4-2' });
    expect(tac.ok).toBe(true);
    expect(tac.current.formation).toBe('4-4-2');

    let ht = null;
    for (let i = 0; i < 3 && !ht; i++) {
      const r = await call(base, 'POST', '/api/step-week', { interactive: true });
      expect(r.ok).toBe(true);
      ht = r.halftime || null;
    }
    expect(ht).not.toBeNull();
    const off = ht.onPitch.find(p => p.slot !== 'GK').playerId;
    const on = ht.bench.find(p => p.position !== 'GK').playerId;
    const res = await call(base, 'POST', '/api/match/resume', { tactic: 'possession', subs: [{ offId: off, onId: on }] });
    expect(res.ok).toBe(true);
    const played = res.matchResult || res.finished;
    expect(played.events.some(e => e.type === 'sub' && /manager/.test(e.text))).toBe(true);
    if (res.halftime) await call(base, 'POST', '/api/match/resume', {});

    const p = res.current.squad[0];
    const terms = await call(base, 'POST', '/api/renew-contract', { playerId: p.id, years: 1, dryRun: true });
    expect(terms.ok).toBe(true);
    expect(terms.terms.signingBonus).toBeGreaterThan(0);

    await call(base, 'POST', '/api/step-week', {});
    const h1 = await call(base, 'GET', '/api/state-hash');
    expect(h1.ok).toBe(true);

    await kill();
    base = await start();
    const h2 = await call(base, 'GET', '/api/state-hash');
    expect(h2.hash).toBe(h1.hash);
    const after = await call(base, 'GET', '/api/state');
    expect(after.club).toBe(pick);

    const bad404 = await call(base, 'GET', '/api/nope');
    expect(bad404.ok).toBe(false);
  });
});
