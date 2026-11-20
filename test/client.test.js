// The browser code has no build step, and a syntax error in it (for example a duplicate declaration
// in the 3D view) only shows up at run time, where the match view silently falls back to 2D.
// This parses every client script — including the page's inline scripts — with esbuild.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const pub = path.join(__dirname, '..', 'public');
const parse = (code, format) => {
  try { esbuild.transformSync(code, { loader: 'js', format }); return null; } catch (e) { return e.message.split('\n').slice(0, 4).join(' '); }
};

describe('client scripts', () => {
  it('every public script parses', () => {
    const modules = new Set(['match3d.js']);
    for (const f of ['match3d.js', 'ball.js', 'sound.js', 'commentary.js', 'sw.js']) {
      expect(parse(fs.readFileSync(path.join(pub, f), 'utf8'), modules.has(f) ? 'esm' : undefined), f).toBeNull();
    }
  });

  it('the inline scripts in index.html parse', () => {
    const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    // Both blocks share one global scope, so they are checked together as well as apart.
    blocks.forEach((b, i) => expect(parse(b), `inline script ${i + 1}`).toBeNull());
  });

  it('the service worker caches every script the page loads', () => {
    const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
    const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
    for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) expect(sw.includes(`'${src}'`), src).toBe(true);
  });
});
