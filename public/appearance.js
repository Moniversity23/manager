// public/appearance.js — turns a Player Studio appearance profile into the look the match renderer
// draws (public/match3d.js), on top of the player's permanent legacy look. Shared by the server
// (src/studio/appearanceService.js) and the browser (Studio preview), so both always agree.
//
// The renderer's look has the legacy fields (skin 0–7, hairStyle, hairCol 0–5, beardStyle, head 0–3,
// eyes 0–3, brows 0–3, heightCm, build 0–15, grey) plus two optional groups:
//   face: { shape, jaw, chin, cheek, brow, nose, noseLen, ear, lip, eye, hairline }  (0–1 sliders)
//   body: { shoulders, chest, waist, arms, legs, muscle }                            (0–1, 0.5 = average)
// Anything missing or invalid in a profile falls back to the legacy look, so a corrupt profile can
// never break a match.
(function (root) {
  const SKIN = { 'very-light': 0, light: 1, medium: 2, tan: 3, brown: 4, dark: 5, deep: 6, 'very-dark': 7 };
  const HAIR = { crop: 'crop', buzz: 'buzz', afro: 'afro', curly: 'curly', 'short-curly-fade': 'fade', swept: 'swept', long: 'long', mohawk: 'mohawk', bald: 'bald', fade: 'fade', twists: 'twists', receding: 'receding' };
  const HAIR_COL = { black: 0, 'dark-brown': 1, brown: 2, 'light-brown': 3, blond: 4, ginger: 5, grey: 0 };
  const EYES = { brown: 0, 'dark-brown': 0, black: 0, hazel: 1, blue: 2, grey: 2, green: 3 };
  const BEARD = { none: 'none', stubble: 'stubble', goatee: 'goatee', full: 'full', moustache: 'moustache', 'chin-strap': 'chin strap' };
  const BROWS = { natural: 1, straight: 1, arched: 0, thick: 3 };
  const FACE_SHAPES = ['oval', 'round', 'square', 'long', 'diamond', 'heart'];
  const EYE_SIZE = { almond: 0.5, round: 0.7, hooded: 0.35, 'deep-set': 0.3, upturned: 0.55 };
  const LIP_SIZE = { thin: 0.25, natural: 0.5, full: 0.8 };

  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
  const unit = v => num(v, 0, 1);

  // Studio appearance → renderer look. `base` is the legacy look (LOOK.describe), always complete.
  function studioToLook(a, base) {
    const out = { ...(base || {}) };
    if (!a || typeof a !== 'object') return out;
    if (SKIN[a.skinTone] != null) out.skin = SKIN[a.skinTone];
    if (HAIR[a.hairStyle]) out.hairStyle = HAIR[a.hairStyle];
    if (HAIR_COL[a.hairColour] != null) { out.hairCol = HAIR_COL[a.hairColour]; out.grey = a.hairColour === 'grey' ? 0.65 : Math.min(out.grey || 0, 0.12); }
    if (EYES[a.eyeColour] != null) out.eyes = EYES[a.eyeColour];
    if (BEARD[a.beardStyle]) out.beardStyle = BEARD[a.beardStyle];
    if (BROWS[a.eyebrowShape] != null) out.brows = BROWS[a.eyebrowShape];
    const h = num(a.heightCm, 150, 215);
    if (h != null) { out.heightCm = h; out.height = Math.max(0, Math.min(39, Math.round(h) - 165)); }
    // Build from muscularity, nudged by weight for the height (BMI around 23 is average for a footballer).
    const mus = unit(a.muscularity), kg = num(a.weightKg, 45, 140);
    if (mus != null || kg != null) {
      const m0 = mus != null ? mus : (out.build ?? 7) / 15;
      const b = kg == null ? m0 : m0 * 0.75 + Math.max(0, Math.min(1, (kg / ((out.heightCm / 100) ** 2) - 20) / 7)) * 0.25;
      out.build = Math.max(0, Math.min(15, Math.round(b * 15)));
    }
    const face = {};
    if (FACE_SHAPES.includes(a.faceShape)) face.shape = a.faceShape;
    for (const [k, src] of [['jaw', 'jaw'], ['chin', 'chin'], ['cheek', 'cheekbones'], ['brow', 'forehead'], ['nose', 'noseWidth'], ['ear', 'earSize'], ['hairline', 'hairline']]) {
      const v = unit(a[src]); if (v != null) face[k] = v;
    }
    if (EYE_SIZE[a.eyeShape] != null) face.eye = EYE_SIZE[a.eyeShape];
    if (LIP_SIZE[a.lipShape] != null) face.lip = LIP_SIZE[a.lipShape];
    if (Object.keys(face).length) out.face = { ...(out.face || {}), ...face };
    const body = {};
    for (const [k, src] of [['shoulders', 'shoulderWidth'], ['chest', 'chest'], ['waist', 'waist'], ['arms', 'armLength'], ['legs', 'legLength'], ['muscle', 'muscularity']]) {
      const v = unit(a[src]); if (v != null) body[k] = v;
    }
    if (Object.keys(body).length) out.body = { ...(out.body || {}), ...body };
    return out;
  }

  const api = { studioToLook, SKIN, HAIR, HAIR_COL, EYES, BEARD, FACE_SHAPES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GafferAppearance = api;
})(typeof self !== 'undefined' ? self : this);
