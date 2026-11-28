// Writes the commentary script and every surname the game can produce to JSON, for the voice build
// (build-commentary.py). Surnames: the last word of each name in the nation pools, as the match
// code calls players (surname() in public/index.html).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { LINES, SCORES, VOICE } from './lines.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { POOLS } = require('./src/names.js');
const names = new Set();
for (const pool of Object.values(POOLS)) for (const full of pool.last || []) names.add(String(full).trim().split(/\s+/).slice(-1)[0]);
const lines = [];
for (const [kind, list] of Object.entries(LINES)) for (const l of list) lines.push({ ...l, kind });
for (const l of SCORES) lines.push({ ...l, kind: 'score' });
const out = { voice: VOICE, lines, names: [...names].sort((a, b) => a.localeCompare(b)) };
fs.writeFileSync(process.argv[2] || path.join(HERE, 'script.json'), JSON.stringify(out, null, 1));
console.log(`${lines.length} lines, ${out.names.length} surnames`);
