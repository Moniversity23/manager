// src/look.js — every player's permanent appearance.
//
// A player's look is fixed when he is created and saved with him as one packed integer, so the
// same face, hair, height and build appear in every match, every season, after transfers and on
// any device that loads the career. It is derived from his id, nation and position with a hash
// (no RNG), so creating it never changes how the rest of the world is generated.
// Age is applied when he is drawn (beards fill in, hair greys and thins), not stored.
//
// Packed fields (bits): skin 3 · hair style 4 · hair colour 3 · beard 3 · head shape 2 · eye colour 2 ·
// brows 2 · height (165 + 0..39 cm) 6 · build 4 · celebration 2

const { hashString } = require('./utils');

const FIELDS = [['skin', 3], ['hair', 4], ['hairCol', 3], ['beard', 3], ['head', 2], ['eyes', 2], ['brows', 2], ['height', 6], ['build', 4], ['cel', 2]];
const HAIR = ['crop', 'buzz', 'afro', 'curly', 'swept', 'long', 'mohawk', 'bald', 'fade', 'twists'];
const BEARD = ['none', 'stubble', 'goatee', 'full', 'moustache', 'chin strap'];
const HAIR_COLS = ['black', 'dark brown', 'brown', 'light brown', 'blond', 'ginger'];

// Skin index 0 (lightest) … 7 (darkest), weighted by nation; hair follows.
const NATION = {
  Nigeria: { skin: [0, 0, 0, 0, 1, 3, 4, 3], hairCol: [9, 1, 0, 0, 0, 0], hair: [3, 5, 4, 1, 0, 0, 1, 1, 4, 3] },
  Ghana: { skin: [0, 0, 0, 0, 1, 3, 4, 3], hairCol: [9, 1, 0, 0, 0, 0], hair: [3, 5, 4, 1, 0, 0, 1, 1, 4, 3] },
  Japan: { skin: [3, 4, 2, 1, 0, 0, 0, 0], hairCol: [8, 2, 1, 0, 0, 0], hair: [4, 2, 0, 1, 4, 2, 1, 0, 2, 0], h: -3 },
  Brazil: { skin: [1, 2, 3, 3, 3, 2, 2, 1], hairCol: [5, 3, 1, 1, 1, 0], hair: [3, 3, 2, 3, 2, 2, 1, 1, 3, 1] },
  Argentina: { skin: [2, 3, 4, 2, 1, 1, 0, 0], hairCol: [4, 4, 2, 1, 1, 0], hair: [3, 2, 0, 2, 3, 3, 1, 1, 2, 0] },
  Spain: { skin: [2, 4, 4, 2, 1, 1, 1, 0], hairCol: [4, 4, 2, 1, 1, 0], hair: [3, 2, 0, 2, 4, 2, 1, 1, 3, 0] },
  Germany: { skin: [4, 4, 2, 1, 1, 1, 1, 1], hairCol: [1, 3, 3, 3, 3, 1], hair: [4, 3, 0, 1, 4, 1, 1, 2, 3, 0], h: 2 },
  England: { skin: [4, 3, 2, 1, 1, 1, 2, 1], hairCol: [2, 3, 3, 2, 2, 2], hair: [4, 3, 1, 2, 3, 1, 1, 2, 3, 1] },
  USA: { skin: [3, 3, 2, 2, 2, 2, 2, 1], hairCol: [3, 3, 3, 2, 2, 1], hair: [4, 3, 1, 2, 3, 1, 1, 2, 3, 1] },
  Australia: { skin: [4, 4, 2, 2, 1, 1, 1, 0], hairCol: [1, 3, 3, 3, 3, 2], hair: [4, 3, 0, 2, 3, 2, 1, 1, 3, 0] },
};
const DEFAULT = { skin: [2, 2, 2, 2, 2, 2, 2, 1], hairCol: [4, 3, 2, 1, 1, 1], hair: [3, 3, 1, 2, 3, 1, 1, 1, 3, 1] };
const BASE_HEIGHT = { GK: 189, CB: 187, CDM: 182, CM: 179, CAM: 176, LB: 177, RB: 177, LW: 174, RW: 174, ST: 183, CF: 179 };
const HEAVY = { CB: 3, CDM: 2, ST: 2, GK: 2, CF: 1, CM: 1, LB: 0, RB: 0, CAM: 0, LW: -1, RW: -1 };

function weighted(w, r) {
  const t = w.reduce((a, b) => a + b, 0);
  let x = r * t;
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; }
  return w.length - 1;
}

function pack(o) { let v = 0, sh = 0; for (const [k, bits] of FIELDS) { v += (o[k] & ((1 << bits) - 1)) * 2 ** sh; sh += bits; } return v; }
function unpack(v) {
  const o = {}; let x = Number(v) || 0;
  for (const [k, bits] of FIELDS) { o[k] = x % (1 << bits); x = Math.floor(x / (1 << bits)); }
  o.heightCm = 165 + o.height;
  return o;
}

function makeLook(id, nation, position) {
  let h = hashString(`look:${id}:${nation}`);
  const r = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; h = (h ^ (h >>> 16)) >>> 0; return h / 4294967296; };
  const n = NATION[nation] || DEFAULT;
  const skin = weighted(n.skin, r());
  const hairCol = skin >= 5 ? (r() < 0.93 ? 0 : 1) : weighted(n.hairCol, r());
  const hair = weighted(n.hair, r());
  const beard = weighted([5, 3, 1, 2, 1, 1], r());
  const tall = (BASE_HEIGHT[position] || 179) + (n.h || 0) + Math.round((r() + r() + r() - 1.5) * 8);
  const build = Math.max(0, Math.min(15, Math.round(7 + (HEAVY[position] || 0) * 1.3 + (r() - 0.5) * 7)));
  return pack({ skin, hair, hairCol, beard, head: Math.floor(r() * 4), eyes: skin >= 4 ? 0 : weighted([5, 3, 2, 1], r()), brows: Math.floor(r() * 4),
    height: Math.max(0, Math.min(39, tall - 165)), build, cel: Math.floor(r() * 4) });
}

// What the UI draws: the stored look with his age applied.
function describe(v, age = 25) {
  const o = unpack(v);
  o.hairStyle = HAIR[o.hair] || 'crop';
  o.beardStyle = age < 19 ? 'none' : age < 22 && o.beard === 3 ? 'stubble' : BEARD[o.beard] || 'none';
  o.grey = age >= 36 ? 0.55 : age >= 33 ? 0.3 : age >= 31 ? 0.12 : 0;
  if (age >= 34 && ['crop', 'swept', 'curly'].includes(o.hairStyle) && o.head % 2 === 0) o.hairStyle = 'receding';
  o.hairColour = HAIR_COLS[o.hairCol] || 'black';
  o.age = age;
  return o;
}

module.exports = { makeLook, pack, unpack, describe, HAIR, BEARD, HAIR_COLS };
