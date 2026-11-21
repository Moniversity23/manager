'use strict';
// Player identity, football attributes and appearance are kept apart: this only builds the look the
// match renderer draws. The legacy look (src/look.js, permanent per player) is always the base; a
// valid Player Studio profile overrides the fields it sets. A missing, corrupt or unsupported
// profile simply gives the legacy look — it can never break a match or change the player.
const LOOK = require('../look');
const { studioToLook } = require('../../public/appearance.js');

function legacyLook(player) {
  return LOOK.describe(player.look ?? LOOK.makeLook(player.id, player.nation, player.position), player.age);
}

function mergeForRenderer(player) {
  const legacy = { ...legacyLook(player), faceSeed: player.id };      // a face of his own, the same every match
  const studio = player.studioProfile;
  if (!studio || typeof studio !== 'object' || studio.schemaVersion !== 1 || !studio.appearance || typeof studio.appearance !== 'object') return legacy;
  try {
    return { ...studioToLook(studio.appearance, legacy), studioAssetId: typeof studio.assetId === 'string' ? studio.assetId : null };
  } catch {
    return legacy;
  }
}

module.exports = { mergeForRenderer, legacyLook };
