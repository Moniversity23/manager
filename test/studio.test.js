import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createProfile, validateProfile } = require('../src/studio/profileSchema');
const { generateFromDescription, deterministicAppearance } = require('../src/studio/characterService');

describe('Player Studio character generation', () => {
  it('parses the acceptance-test Nigerian striker description', () => {
    const p = generateFromDescription('Create a 17-year-old Nigerian striker, 183 cm tall, approximately 78 kg, athletic muscular build, dark skin, short curly low-fade black hairstyle, realistic face, brown eyes, broad shoulders, strong legs, clean-shaven, wearing a red and white football kit.', { playerId: 123 });
    expect(p.schemaVersion).toBe(1);
    expect(p.appearance.age).toBe(17);
    expect(p.appearance.heightCm).toBe(183);
    expect(p.appearance.weightKg).toBe(78);
    expect(p.appearance.skinTone).toBe('dark');
    expect(p.appearance.hairStyle).toBe('short-curly-fade');
    expect(p.appearance.eyeColour).toBe('brown');
    expect(p.appearance.beardStyle).toBe('none');
    expect(p.appearance.kit.primary).toBe('#c62828');
  });

  it('is deterministic for the same player and seed version', () => {
    const a = deterministicAppearance({ playerId: 42, nation: 'Nigeria', position: 'ST' });
    const b = deterministicAppearance({ playerId: 42, nation: 'Nigeria', position: 'ST' });
    expect(a.appearance).toEqual(b.appearance);
  });

  it('validates profiles and rejects unsupported versions', () => {
    const p = createProfile({ appearance: { heightCm: 183, weightKg: 78 } });
    expect(validateProfile(p).schemaVersion).toBe(1);
    expect(() => validateProfile({ ...p, schemaVersion: 99 })).toThrow(/version/);
  });

  it('keeps legacy appearance separate from Studio profiles', () => {
    const p = createProfile({ playerId: 7, appearance: { skinTone: 'dark' } });
    expect(p.playerId).toBe(7);
    expect(p.model.rigId).toBe('gaffer-default-v1');
  });
});
