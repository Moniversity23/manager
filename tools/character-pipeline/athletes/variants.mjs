// The Gaffer athletes: one neutral base footballer and the Ara 3D Gen exports the identity system
// is built from. Every export shares the base's settings (same detail, garments and skeleton, so
// the same topology) and changes one thing:
//   * face targets   — one MakeHuman face slider (head shape, chin, jaw, cheeks, nose, mouth, lips,
//                      eyes, ears, brows, forehead), pushed to one side;
//   * heritage       — pure African, East Asian and European heritage (the base is an even mix);
//   * body and age   — more and less muscle and weight, older and younger;
//   * hairstyles     — MakeHuman's modelled hair (CC0) and Ara's procedural cornrows and mohawk.
// The difference between an export and the base becomes a morph target (add-morphs.mjs) or a
// hair mesh (hair-library.mjs). Usage: node athletes/variants.mjs [--force] [--only a,b]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const ARA = path.join(ROOT, 'FOOTBALL-RALISM-LAB', 'Ara3DGen');
export const RAW = path.join(ROOT, 'FOOTBALL-RALISM-LAB', 'outputs', 'gaffer-athletes');

const white = { pattern: 'solid', color: '#f2f2f2', color2: '#f2f2f2' };
export const BASE = {
  gender: 1, age: 0.42, muscle: 0.62, weight: 0.45, height: 0.5, proportions: 0.8,
  african: 0.34, asian: 0.33, caucasian: 0.33,
  eyes: 'brown', hair: 'none', hairColor: '#1a1410', facialHair: 'none', expression: 'neutral',
  outfit: 'none', top: 'football_shirt', bottom: 'resort_shorts', shoes: 'shoes06', accessories: ['sport_socks'],
  garmentStyles: { football_shirt: white, resort_shorts: white, sport_socks: white },
  detail: 'medium', rig: 'game', restPose: 'T', faceBones: false, faceShapes: false, speechShapes: false,
  teeth: 'none', tongue: false, animations: false, tattoos: [], earrings: 'none', modifiers: {},
};

// [id, change to the base]. Face sliders are MakeHuman modifiers (−1..1).
const m = mods => ({ modifiers: mods });
export const FACE = [
  ['headSquare', m({ 'head/head-square': 1 })], ['headRound', m({ 'head/head-round': 1 })], ['headVJaw', m({ 'head/head-invertedtriangular': 1 })],
  ['headWide', m({ 'head/head-scale-horiz': 0.8 })], ['headNarrow', m({ 'head/head-scale-horiz': -0.8 })],
  ['chinWide', m({ 'chin/chin-width': 0.9 })], ['chinNarrow', m({ 'chin/chin-width': -0.9 })],
  ['chinOut', m({ 'chin/chin-prominent': 0.9 })], ['chinIn', m({ 'chin/chin-prominent': -0.9 })],
  ['jawStrong', m({ 'chin/chin-bones': 0.9 })], ['cheekHigh', m({ 'cheek/cheek-bones': 0.9 })],
  ['noseWide', m({ 'nose/nose-scale-horiz': 0.9 })], ['noseNarrow', m({ 'nose/nose-scale-horiz': -0.9 })],
  ['noseLong', m({ 'nose/nose-scale-vert': 0.9 })], ['noseShort', m({ 'nose/nose-scale-vert': -0.9 })], ['noseHump', m({ 'nose/nose-hump': 0.9 })],
  ['mouthWide', m({ 'mouth/mouth-scale-horiz': 0.9 })], ['mouthNarrow', m({ 'mouth/mouth-scale-horiz': -0.9 })],
  ['lipsFull', m({ 'mouth/mouth-upperlip-volume': 0.9, 'mouth/mouth-lowerlip-volume': 0.9 })], ['lipsThin', m({ 'mouth/mouth-upperlip-volume': -0.9, 'mouth/mouth-lowerlip-volume': -0.9 })],
  ['eyesBig', m({ 'eyes/eye-scale': 0.8 })], ['eyesSmall', m({ 'eyes/eye-scale': -0.8 })],
  ['eyesWide', m({ 'eyes/eye-trans': 0.8 })], ['eyesClose', m({ 'eyes/eye-trans': -0.8 })],
  ['earsBig', m({ 'ears/ear-scale': 0.9 })], ['earsSmall', m({ 'ears/ear-scale': -0.9 })],
  ['browLow', m({ 'eyebrows/eyebrows-trans': -0.8 })], ['foreheadTall', m({ 'forehead/forehead-scale-vert': 0.9 })],
];
export const HERITAGE = [['afr', { african: 1, asian: 0, caucasian: 0 }], ['asi', { african: 0, asian: 1, caucasian: 0 }], ['cau', { african: 0, asian: 0, caucasian: 1 }]];
export const BODY = [['muscular', { muscle: 1 }], ['lean', { muscle: 0.3 }], ['heavy', { weight: 0.8 }], ['slim', { weight: 0.2 }], ['older', { age: 0.62 }], ['younger', { age: 0.3 }]];
export const HAIR = [['short01', { hair: 'short01' }], ['short02', { hair: 'short02' }], ['short03', { hair: 'short03' }], ['short04', { hair: 'short04' }],
  ['afro01', { hair: 'afro01' }], ['long01', { hair: 'long01' }], ['braid01', { hair: 'braid01' }], ['ponytail01', { hair: 'ponytail01' }],
  ['cornrows', { hair: 'cornrows' }], ['mohawk', { hair: 'mohawk' }], ['buzz', { hair: 'buzz' }]];
// Facial hair (geometry cards in Ara): only used to find where each style grows on the face; the
// game draws beards as its own lighter shells (hair-library.mjs).
export const BEARDS = [['b_goatee', { facialHair: 'goatee' }], ['b_short', { facialHair: 'short_beard' }], ['b_full', { facialHair: 'full_beard' }], ['b_mustache', { facialHair: 'mustache' }], ['b_stubble', { facialHair: 'stubble' }]];

export const ALL = [['base', {}], ...FACE, ...HERITAGE, ...BODY, ...HAIR, ...BEARDS];
export const rawFile = id => path.join(RAW, `ath-${id}.glb`);

function exportOne(id, change, force) {
  const out = rawFile(id), recipe = { ...BASE, ...change, modifiers: { ...BASE.modifiers, ...(change.modifiers || {}) }, name: `ath-${id}` };
  const rp = path.join(RAW, 'recipes', `ath-${id}.params.json`), text = JSON.stringify(recipe, null, 1);
  // An export is redone when its recipe changed, or when asked to.
  if (!force && fs.existsSync(out) && fs.existsSync(rp) && fs.readFileSync(rp, 'utf8') === text) return false;
  fs.writeFileSync(rp, text);
  execFileSync(process.execPath, [path.join(ARA, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/export-cli.ts', '--params', rp, '--formats', 'glb', '--detail', recipe.detail, '--no-animations', '--out', RAW], { cwd: ARA, stdio: 'pipe' });
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), force = args.includes('--force'), only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
  fs.mkdirSync(path.join(RAW, 'recipes'), { recursive: true });
  let done = 0; const t0 = Date.now();
  for (const [id, change] of ALL) {
    if (only && !only.has(id)) continue;
    const t = Date.now(), did = exportOne(id, change, force);
    if (did) { done++; console.log(`[variants] ${id}: ${((Date.now() - t) / 1000).toFixed(1)} s`); }
  }
  console.log(`[variants] ${done} exported in ${((Date.now() - t0) / 1000).toFixed(0)} s into ${RAW}`);
}
