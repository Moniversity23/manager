'use strict';
// Player Studio character generation. Runs entirely offline: a rule-based reader of the description
// plus a deterministic procedural generator — no paid AI service, no network. The same description
// and seed always give the same footballer.
const { hashString } = require('../utils');
const LOOK = require('../look');
const { createProfile, DEFAULTS } = require('./profileSchema');

function seedFrom(seedInput) { return hashString(String(seedInput)); }
function mulberry32(seed) { return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Feature groups that can be locked while the rest is regenerated.
const GROUPS = {
  skin: ['skinTone', 'skinVariant'],
  face: ['faceShape', 'forehead', 'jaw', 'chin', 'cheekbones', 'noseWidth', 'eyeShape', 'earSize', 'lipShape', 'eyebrowShape'],
  eyes: ['eyeColour'],
  hair: ['hairStyle', 'hairColour', 'hairline'],
  beard: ['beardStyle', 'moustacheStyle'],
  body: ['heightCm', 'weightKg', 'bodyType', 'muscularity', 'shoulderWidth', 'chest', 'waist', 'hipProportion', 'armLength', 'legLength'],
  kit: ['kit'],
};

const NATIONS = [['nigeria', 'Nigeria'], ['ghana', 'Ghana'], ['senegal', 'Senegal'], ['cameroon', 'Cameroon'], ['ivory coast', 'Ivory Coast'], ['brazil', 'Brazil'], ['argentin', 'Argentina'],
  ['england', 'England'], ['english', 'England'], ['german', 'Germany'], ['spain', 'Spain'], ['spanish', 'Spain'], ['japan', 'Japan'], ['usa', 'USA'], ['american', 'USA'], ['united states', 'USA'],
  ['france', 'France'], ['french', 'France'], ['ital', 'Italy'], ['portug', 'Portugal'], ['dutch', 'Netherlands'], ['netherlands', 'Netherlands'], ['australia', 'Australia']];
const POSITIONS = [['goalkeeper', 'GK'], ['keeper', 'GK'], ['defensive midfielder', 'CDM'], ['holding midfielder', 'CDM'], ['attacking midfielder', 'CAM'], ['playmaker', 'CAM'], ['number 10', 'CAM'],
  ['left back', 'LB'], ['left-back', 'LB'], ['right back', 'RB'], ['right-back', 'RB'], ['centre back', 'CB'], ['center back', 'CB'], ['centre-back', 'CB'], ['center-back', 'CB'], ['defender', 'CB'],
  ['left wing', 'LW'], ['right wing', 'RW'], ['winger', 'LW'], ['centre forward', 'CF'], ['center forward', 'CF'], ['striker', 'ST'], ['forward', 'ST'], ['midfielder', 'CM']];
const COLOURS = { 'sky blue': '#5fa8dc', navy: '#1b2a4a', maroon: '#7a1f2b', claret: '#7a1f2b', red: '#c62828', blue: '#1f5fbf', white: '#ffffff', black: '#111111', yellow: '#f2c614', gold: '#d4a017',
  green: '#1e8a3c', orange: '#ef6c00', purple: '#6a1b9a', pink: '#e86aa0', grey: '#8a8f98', gray: '#8a8f98' };

// Reads what the description says; anything it does not mention is left to the generator.
function parseDescription(text, context = {}) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const has = re => re.test(s);
  const a = {};
  const age = s.match(/(\d{1,2})[- ]year[- ]old|aged (\d{1,2})|(\d{1,2}) years? old/);
  if (age) a.age = Number(age[1] || age[2] || age[3]);
  const cm = s.match(/(\d{3}) ?(?:cm|centimet)/), ft = s.match(/(\d)'(\d{1,2})"?|(\d) ?f(?:ee)?t ?(\d{1,2})/);
  if (cm) a.heightCm = Number(cm[1]);
  else if (ft) a.heightCm = Math.round(((Number(ft[1] || ft[3])) * 12 + Number(ft[2] || ft[4])) * 2.54);
  else if (has(/\bvery tall\b|towering/)) a.heightCm = 196; else if (has(/\btall\b/)) a.heightCm = 190; else if (has(/\bshort\b|small/)) a.heightCm = 170;
  const kg = s.match(/(\d{2,3}) ?(?:kg|kilo)/); if (kg) a.weightKg = Number(kg[1]);
  a.nationality = (NATIONS.find(([n]) => s.includes(n)) || [])[1] || context.nation || null;
  a.position = (POSITIONS.find(([n]) => s.includes(n)) || [])[1] || context.position || null;
  // Skin.
  if (has(/very dark|deep (?:dark|brown|black)|ebony/)) a.skinTone = 'very-dark';
  else if (has(/dark[- ]skin|dark complexion|dark-skinned|black skin/)) a.skinTone = 'dark';
  else if (has(/brown skin|medium[- ]brown|brown complexion/)) a.skinTone = 'brown';
  else if (has(/olive|tanned|tan skin|light brown skin/)) a.skinTone = 'tan';
  else if (has(/very (?:pale|fair|light)/)) a.skinTone = 'very-light';
  else if (has(/pale|fair|light[- ]skin|light complexion/)) a.skinTone = 'light';
  else if (has(/medium skin|medium complexion/)) a.skinTone = 'medium';
  // Face.
  if (has(/square (?:jaw|face)|chiselled|chiseled/)) { a.faceShape = 'square'; a.jaw = 0.82; }
  else if (has(/round face/)) a.faceShape = 'round'; else if (has(/long face|narrow face/)) a.faceShape = 'long';
  else if (has(/heart[- ]shaped face/)) a.faceShape = 'heart'; else if (has(/diamond face/)) a.faceShape = 'diamond'; else if (has(/oval face/)) a.faceShape = 'oval';
  if (has(/(?:high|sharp|prominent) cheekbones/)) a.cheekbones = 0.82;
  if (has(/(?:strong|prominent|pointed) chin/)) a.chin = 0.8; else if (has(/soft chin|small chin/)) a.chin = 0.3;
  if (has(/(?:broad|wide|flat) nose/)) a.noseWidth = 0.82; else if (has(/(?:narrow|thin|pointed|straight) nose/)) a.noseWidth = 0.28;
  if (has(/full lips|thick lips/)) a.lipShape = 'full'; else if (has(/thin lips/)) a.lipShape = 'thin';
  if (has(/(?:big|large|prominent) ears/)) a.earSize = 0.8; else if (has(/small ears/)) a.earSize = 0.3;
  if (has(/hooded eyes/)) a.eyeShape = 'hooded'; else if (has(/round eyes|big eyes/)) a.eyeShape = 'round'; else if (has(/deep[- ]set eyes/)) a.eyeShape = 'deep-set';
  if (has(/thick (?:eye)?brows|bushy (?:eye)?brows/)) a.eyebrowShape = 'thick'; else if (has(/arched (?:eye)?brows/)) a.eyebrowShape = 'arched';
  if (has(/(?:high|big) forehead/)) a.forehead = 0.8;
  // Eyes.
  if (has(/blue eyes/)) a.eyeColour = 'blue'; else if (has(/green eyes/)) a.eyeColour = 'green'; else if (has(/hazel eyes/)) a.eyeColour = 'hazel';
  else if (has(/gr[ae]y eyes/)) a.eyeColour = 'grey'; else if (has(/dark[- ]brown eyes|dark eyes/)) a.eyeColour = 'dark-brown'; else if (has(/brown eyes/)) a.eyeColour = 'brown';
  // Hair.
  if (has(/bald|shaved head|clean[- ]shaven head/)) a.hairStyle = 'bald';
  else if (has(/short curly|low[- ]fade|curly fade|taper fade/)) a.hairStyle = 'short-curly-fade';
  else if (has(/dreadlock|dreads|twists|braids|cornrow/)) a.hairStyle = 'twists';
  else if (has(/afro/)) a.hairStyle = 'afro'; else if (has(/mohawk|mohican/)) a.hairStyle = 'mohawk';
  else if (has(/long hair|shoulder[- ]length|ponytail|man bun/)) a.hairStyle = 'long';
  else if (has(/buzz ?cut|crew cut|shaved/)) a.hairStyle = 'buzz'; else if (has(/receding/)) a.hairStyle = 'receding';
  else if (has(/swept|side part|slicked/)) a.hairStyle = 'swept'; else if (has(/curly|curls/)) a.hairStyle = 'curly';
  else if (has(/\bfade\b/)) a.hairStyle = 'fade'; else if (has(/short hair|crop/)) a.hairStyle = 'crop';
  if (has(/blond/)) a.hairColour = 'blond'; else if (has(/ginger|red hair|auburn/)) a.hairColour = 'ginger'; else if (has(/gr[ae]y hair|silver hair/)) a.hairColour = 'grey';
  else if (has(/light[- ]brown hair/)) a.hairColour = 'light-brown'; else if (has(/dark[- ]brown hair/)) a.hairColour = 'dark-brown'; else if (has(/brown hair|brunette/)) a.hairColour = 'brown';
  else if (has(/black hair|black hairstyle/)) a.hairColour = 'black';
  // Facial hair.
  if (has(/clean[- ]shaven|no beard/)) a.beardStyle = 'none';
  else if (has(/full beard|thick beard|bearded/)) a.beardStyle = 'full'; else if (has(/goatee/)) a.beardStyle = 'goatee';
  else if (has(/stubble|five o'clock/)) a.beardStyle = 'stubble'; else if (has(/chin[- ]strap/)) a.beardStyle = 'chin-strap'; else if (has(/moustache|mustache/)) a.beardStyle = 'moustache';
  // Body.
  if (has(/muscular|powerful build|strong build|well-built|bulky/)) { a.bodyType = 'muscular'; a.muscularity = 0.82; }
  else if (has(/athletic/)) { a.bodyType = 'athletic'; a.muscularity = 0.66; }
  else if (has(/stocky|thickset/)) { a.bodyType = 'stocky'; a.muscularity = 0.7; a.waist = 0.68; }
  else if (has(/slim|lean|wiry|skinny|slender/)) { a.bodyType = 'lean'; a.muscularity = 0.32; a.waist = 0.38; }
  if (has(/broad shoulders|wide shoulders/)) a.shoulderWidth = 0.82; else if (has(/narrow shoulders/)) a.shoulderWidth = 0.28;
  if (has(/long legs|leggy/)) a.legLength = 0.78; else if (has(/short legs/)) a.legLength = 0.28;
  if (has(/strong legs|powerful legs|big thighs/)) { a.legLength = a.legLength ?? 0.6; a.muscularity = Math.max(a.muscularity ?? 0.6, 0.72); }
  if (has(/long arms/)) a.armLength = 0.78;
  if (has(/broad chest|barrel chest|big chest/)) a.chest = 0.8;
  // Kit: "a red and white kit", "wearing blue".
  const kitPart = (s.match(/(?:wearing|in) (?:a |an |the )?([a-z ]+?)(?: football)? (?:kit|shirt|strip|jersey)/) || [])[1] || '';
  const named = Object.keys(COLOURS).filter(c => kitPart.includes(c)).sort((x, y) => kitPart.indexOf(x) - kitPart.indexOf(y));
  if (named.length) a.kit = { primary: COLOURS[named[0]], secondary: COLOURS[named[1] || 'white'], accent: '#111111', pattern: has(/stripe/) ? 'vertical-stripes' : has(/hoop/) ? 'horizontal-stripes' : 'plain' };
  for (const k of Object.keys(a)) if (a[k] == null) delete a[k];
  return a;
}

// A complete, plausible footballer from a seed: his nation and position shape the base (via the
// same generator that gives every game player his look), the rest comes from the seed.
const SKIN_NAMES = ['very-light', 'light', 'medium', 'tan', 'brown', 'dark', 'deep', 'very-dark'];
const HAIR_NAMES = { crop: 'crop', buzz: 'buzz', afro: 'afro', curly: 'curly', swept: 'swept', long: 'long', mohawk: 'mohawk', bald: 'bald', fade: 'fade', twists: 'twists', receding: 'receding' };
const HAIR_COLOURS = ['black', 'dark-brown', 'brown', 'light-brown', 'blond', 'ginger'];
const BEARDS = { none: 'none', stubble: 'stubble', goatee: 'goatee', full: 'full', moustache: 'moustache', 'chin strap': 'chin-strap' };
function deterministicAppearance({ playerId = null, nation = 'Nigeria', position = 'ST', seedVersion = 1, seed = null } = {}) {
  const key = seed != null ? `seed:${seed}` : `gaffer-appearance-v${seedVersion}:${playerId}:${nation}:${position}`;
  const rng = mulberry32(seedFrom(key));
  const lk = LOOK.describe(LOOK.makeLook(seedFrom(key) % 1_000_000, nation, position), 24);
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const u = (lo = 0.25, hi = 0.75) => +(lo + rng() * (hi - lo)).toFixed(2);
  const appearance = {
    nationality: nation, position,
    skinTone: SKIN_NAMES[lk.skin] || 'medium', skinVariant: Math.floor(rng() * 8),
    faceShape: pick(['oval', 'oval', 'square', 'round', 'long', 'diamond', 'heart']), forehead: u(), jaw: u(), chin: u(), cheekbones: u(), noseWidth: u(0.2, 0.8),
    eyeShape: pick(['almond', 'almond', 'round', 'hooded', 'deep-set', 'upturned']), eyeColour: ['brown', 'hazel', 'blue', 'green'][lk.eyes] || 'brown',
    eyebrowShape: pick(['natural', 'natural', 'straight', 'arched', 'thick']), earSize: u(0.3, 0.7), lipShape: pick(['thin', 'natural', 'natural', 'full']),
    hairStyle: HAIR_NAMES[lk.hairStyle] || 'crop', hairColour: HAIR_COLOURS[lk.hairCol] || 'black', hairline: u(0.3, 0.7),
    beardStyle: BEARDS[lk.beardStyle] || 'none', moustacheStyle: 'none',
    heightCm: lk.heightCm, weightKg: Math.round(((lk.heightCm / 100) ** 2) * (21.5 + lk.build / 15 * 4)),
    bodyType: lk.build >= 11 ? 'muscular' : lk.build <= 4 ? 'lean' : 'athletic', muscularity: +(lk.build / 15).toFixed(2),
    shoulderWidth: u(0.35, 0.75), chest: u(0.35, 0.75), waist: u(0.35, 0.65), hipProportion: u(0.4, 0.6), armLength: u(0.35, 0.65), legLength: u(0.35, 0.65),
    kit: { ...DEFAULTS.kit },
  };
  return createProfile({ playerId, appearance });
}

function generateFromDescription(description, context = {}) {
  const parsed = parseDescription(description, context);
  const seedInput = context.playerId != null ? `player:${context.playerId}` : `${description}:${context.seed || 'studio'}`;
  const base = deterministicAppearance({ playerId: context.playerId, nation: parsed.nationality || 'Nigeria', position: parsed.position || 'ST', seed: seedInput });
  const appearance = { ...base.appearance, ...parsed, kit: { ...base.appearance.kit, ...(parsed.kit || {}) } };
  if (parsed.heightCm && !parsed.weightKg) appearance.weightKg = Math.round(((parsed.heightCm / 100) ** 2) * (21.5 + (appearance.muscularity || 0.55) * 4));
  return createProfile({ playerId: context.playerId ?? null, assetId: context.assetId ?? null, appearance });
}

// A new variation of a footballer that keeps the locked feature groups exactly as they are.
function regenerate(profile, locks = [], seed = Date.now()) {
  const a = profile.appearance || {};
  const fresh = deterministicAppearance({ nation: a.nationality || 'Nigeria', position: a.position || 'ST', seed: `${seed}` }).appearance;
  const out = { ...fresh, age: a.age, nationality: a.nationality, position: a.position };
  for (const g of locks) for (const k of GROUPS[g] || []) if (a[k] !== undefined) out[k] = a[k];
  if (!locks.includes('kit')) out.kit = a.kit || fresh.kit;      // the kit is the user's choice, not random
  return createProfile({ playerId: profile.playerId ?? null, assetId: profile.assetId ?? null, appearance: out, locks });
}

module.exports = { parseDescription, deterministicAppearance, generateFromDescription, regenerate, seedFrom, GROUPS };
