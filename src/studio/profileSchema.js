'use strict';
// Player Studio appearance profiles (schema version 1). A profile describes how a player LOOKS —
// never his football attributes, contract, statistics or history. Unknown fields are dropped and
// every value is checked, so a profile can be stored and rendered safely.

const DEFAULTS = Object.freeze({
  skinTone: 'medium', skinVariant: 2, faceShape: 'oval', forehead: 0.5, jaw: 0.5,
  chin: 0.5, cheekbones: 0.5, noseWidth: 0.5, eyeShape: 'almond', eyeColour: 'brown',
  eyebrowShape: 'natural', earSize: 0.5, lipShape: 'natural', hairStyle: 'crop', hairColour: 'black',
  hairline: 0.5, beardStyle: 'none', moustacheStyle: 'none', heightCm: 180, weightKg: 75,
  bodyType: 'athletic', muscularity: 0.55, shoulderWidth: 0.55, chest: 0.55, waist: 0.5,
  hipProportion: 0.5, armLength: 0.5, legLength: 0.5, kit: { primary: '#c62828', secondary: '#ffffff', accent: '#111111', pattern: 'plain' }
});

const ENUMS = {
  skinTone: ['very-light', 'light', 'medium', 'tan', 'brown', 'dark', 'deep', 'very-dark'],
  faceShape: ['oval', 'round', 'square', 'long', 'diamond', 'heart'], eyeShape: ['almond', 'round', 'hooded', 'deep-set', 'upturned'],
  eyeColour: ['brown', 'dark-brown', 'hazel', 'green', 'blue', 'grey', 'black'],
  hairStyle: ['crop', 'buzz', 'afro', 'curly', 'short-curly-fade', 'swept', 'long', 'mohawk', 'bald', 'fade', 'twists', 'receding'],
  hairColour: ['black', 'dark-brown', 'brown', 'light-brown', 'blond', 'ginger', 'grey'],
  beardStyle: ['none', 'stubble', 'goatee', 'full', 'moustache', 'chin-strap'], moustacheStyle: ['none', 'pencil', 'chevron', 'natural'],
  bodyType: ['lean', 'athletic', 'muscular', 'stocky', 'broad', 'slim'],
  lipShape: ['thin', 'natural', 'full'], eyebrowShape: ['natural', 'straight', 'arched', 'thick'],
};
const SLIDERS = ['forehead', 'jaw', 'chin', 'cheekbones', 'noseWidth', 'earSize', 'hairline', 'muscularity', 'shoulderWidth', 'chest', 'waist', 'hipProportion', 'armLength', 'legLength'];
const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST', 'CF'];
const KIT_PATTERNS = ['plain', 'vertical-stripes', 'horizontal-stripes', 'yoke', 'sash', 'hoops', 'stripes'];
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_PROFILE_BYTES = 16_000;

function deepMerge(base, patch) { const out = { ...base }; for (const k of Object.keys(patch || {})) { if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) out[k] = deepMerge(base[k] || {}, patch[k]); else out[k] = patch[k]; } return out; }

function clamp01(v, fallback) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }

// Keeps only known appearance fields (and the Studio's identity labels), checks every value.
function cleanAppearance(a) {
  const out = {};
  for (const key of SLIDERS) if (a[key] != null) out[key] = clamp01(a[key], DEFAULTS[key]);
  for (const [key, values] of Object.entries(ENUMS)) if (a[key] != null) { if (!values.includes(a[key])) throw new Error(`invalid ${key}`); out[key] = a[key]; }
  if (a.heightCm != null) { const h = Number(a.heightCm); if (!Number.isFinite(h) || h < 150 || h > 215) throw new Error('invalid heightCm'); out.heightCm = Math.round(h); }
  if (a.weightKg != null) { const w = Number(a.weightKg); if (!Number.isFinite(w) || w < 45 || w > 140) throw new Error('invalid weightKg'); out.weightKg = Math.round(w); }
  if (a.skinVariant != null) out.skinVariant = Math.max(0, Math.min(7, Math.round(Number(a.skinVariant) || 0)));
  if (a.age != null) { const n = Math.round(Number(a.age)); if (Number.isFinite(n)) out.age = Math.max(15, Math.min(45, n)); }
  if (typeof a.nationality === 'string') out.nationality = a.nationality.replace(/[<>]/g, '').slice(0, 40);
  if (typeof a.position === 'string' && POSITIONS.includes(a.position)) out.position = a.position;
  if (typeof a.seed === 'string') out.seed = a.seed.slice(0, 32);
  if (a.kit && typeof a.kit === 'object') {
    const k = {};
    for (const f of ['primary', 'secondary', 'accent']) if (a.kit[f] != null) { if (typeof a.kit[f] !== 'string' || !HEX.test(a.kit[f])) throw new Error(`invalid kit ${f}`); k[f] = a.kit[f].toLowerCase(); }
    if (a.kit.pattern != null) { if (!KIT_PATTERNS.includes(a.kit.pattern)) throw new Error('invalid kit pattern'); k.pattern = a.kit.pattern; }
    out.kit = k;
  }
  return out;
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('appearance profile required');
  if (profile.schemaVersion !== 1) throw new Error('unsupported appearance profile version');
  if (JSON.stringify(profile).length > MAX_PROFILE_BYTES) throw new Error('appearance profile too large');
  const a = profile.appearance;
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('appearance required');
  const appearance = cleanAppearance(a);
  if (appearance.heightCm == null) appearance.heightCm = DEFAULTS.heightCm;
  if (appearance.weightKg == null) appearance.weightKg = DEFAULTS.weightKg;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
  return {
    schemaVersion: 1,
    playerId: Number.isInteger(profile.playerId) ? profile.playerId : null,
    assetId: typeof profile.assetId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(profile.assetId) ? profile.assetId : null,
    appearance,
    model: { format: 'glb', path: '/models/footballer.glb', rigId: 'gaffer-default-v1' },
    locks: Array.isArray(profile.locks) ? profile.locks.filter(x => typeof x === 'string').slice(0, 12).map(x => x.slice(0, 20)) : [],
    createdAt: str(profile.createdAt, 40) || new Date().toISOString(),
    updatedAt: str(profile.updatedAt, 40) || new Date().toISOString(),
  };
}

function createProfile({ playerId = null, assetId = null, appearance = {}, locks = [] } = {}) {
  const now = new Date().toISOString();
  const merged = deepMerge(DEFAULTS, appearance);
  return validateProfile({ schemaVersion: 1, playerId, assetId, appearance: merged, locks, createdAt: now, updatedAt: now });
}

module.exports = { DEFAULTS, ENUMS, SLIDERS, POSITIONS, createProfile, validateProfile, cleanAppearance, deepMerge, MAX_PROFILE_BYTES };
