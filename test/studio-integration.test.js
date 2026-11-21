import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { mergeForRenderer } = require('../src/studio/appearanceService');
const LOOK = require('../src/look');

describe('Studio match integration', () => {
  it('merges Studio visual fields while preserving legacy fallback', () => {
    const player = { id: 44, nation: 'Nigeria', position: 'ST', age: 17, look: LOOK.makeLook(44, 'Nigeria', 'ST'), studioProfile: { schemaVersion: 1, assetId: 'character_test', appearance: { skinTone: 'dark', hairStyle: 'short-curly-fade', eyeColour: 'brown', beardStyle: 'none', heightCm: 183, muscularity: 0.72 } } };
    const look = mergeForRenderer(player);
    expect(look.skin).toBe(5);
    expect(look.hairStyle).toBe('fade');
    expect(look.heightCm).toBe(183);
    expect(look.build).toBeGreaterThanOrEqual(10);
  });

  it('falls back safely without a Studio profile', () => {
    const player = { id: 45, nation: 'England', position: 'CM', age: 24, look: LOOK.makeLook(45, 'England', 'CM') };
    expect(mergeForRenderer(player)).toMatchObject({ age: 24 });
  });
});
