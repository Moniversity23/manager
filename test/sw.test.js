import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function worker(networkFetch) {
  const listeners = {}, entries = new Map();
  const caches = {
    async open() { return { put: async (request, response) => entries.set(new URL(request.url).pathname, response.clone()) }; },
    async match(request) { const hit = entries.get(new URL(request.url).pathname); return hit && hit.clone(); },
    async keys() { return ['gaffer-shell-v30']; },
    async delete() { return true; },
  };
  const self = { location: { origin: 'https://game.test' }, addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {}, matchAll: async () => [] } };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch: networkFetch, URL, Request, Response, Headers, Promise, Error });
  return { listeners, entries };
}

function request(workerState, url, range) {
  let response;
  workerState.listeners.fetch({ request: new Request(url, { headers: { Range: range } }), respondWith: p => { response = p; } });
  return response;
}

describe('offline media ranges', () => {
  it('caches the whole stadium MP3 on first range and serves later ranges offline', async () => {
    let online = true, calls = 0;
    const w = worker(async req => {
      calls++;
      expect(req.headers.has('range')).toBe(false);
      if (!online) throw new Error('offline');
      return new Response(Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80]), { headers: { 'Content-Type': 'audio/mpeg' } });
    });
    const first = await request(w, 'https://game.test/manager/audio/stadium/bed-calm.mp3', 'bytes=2-5');
    expect(first.status).toBe(206);
    expect(first.headers.get('content-range')).toBe('bytes 2-5/8');
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([30, 40, 50, 60]);
    expect(w.entries.size).toBe(1);
    online = false;
    const again = await request(w, 'https://game.test/manager/audio/stadium/bed-calm.mp3', 'bytes=-3');
    expect(again.status).toBe(206);
    expect(again.headers.get('content-range')).toBe('bytes 5-7/8');
    expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([60, 70, 80]);
    expect(calls).toBe(1);
  });

  it('returns a proper unsatisfied-range response for invalid requests', async () => {
    const w = worker(async () => new Response(Uint8Array.from([1, 2, 3])));
    const bad = await request(w, 'https://game.test/audio/stadium/bed-calm.mp3', 'bytes=9-12');
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */3');
  });
});
