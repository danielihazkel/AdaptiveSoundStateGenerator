import { describe, expect, it } from 'vitest';
import { STATES } from './states';
import { defaultProfile, normalizeProfile, type SoundProfile } from './types';

describe('normalizeProfile', () => {
  it('completes a legacy profile that predates ambience and warmth', () => {
    const legacy = structuredClone(STATES.relax.buildProfile(0.5)) as unknown as Record<
      string,
      unknown
    >;
    delete legacy.ambience;
    delete (legacy.tone as Record<string, unknown>).warmth;

    const normalized = normalizeProfile(legacy);
    expect(normalized.ambience).toEqual(defaultProfile.ambience);
    expect(normalized.tone.warmth).toBe(defaultProfile.tone.warmth);
    // Untouched fields survive verbatim.
    expect(normalized.binaural).toEqual(STATES.relax.buildProfile(0.5).binaural);
    expect(normalized.noise).toEqual(STATES.relax.buildProfile(0.5).noise);
  });

  it('is the identity on modern profiles', () => {
    for (const state of Object.values(STATES)) {
      const p = state.buildProfile(0.5);
      expect(normalizeProfile(p)).toEqual(p);
    }
    expect(normalizeProfile(defaultProfile)).toEqual(defaultProfile);
  });

  it('clamps out-of-range numbers and coerces unknown enum values', () => {
    const garbage = {
      masterVolume: 7,
      tone: { enabled: true, frequency: -100, level: Number.NaN, warmth: 3 },
      noise: { enabled: true, type: 'purple', level: 0.4 },
      ambience: { enabled: 'yes', type: 'lava', level: -2 },
      lowpassHz: 1e9,
    };
    const p = normalizeProfile(garbage);
    expect(p.masterVolume).toBe(1);
    expect(p.tone.frequency).toBe(20);
    expect(p.tone.level).toBe(defaultProfile.tone.level); // NaN → default
    expect(p.tone.warmth).toBe(1);
    expect(p.noise.type).toBe(defaultProfile.noise.type);
    expect(p.noise.level).toBe(0.4);
    expect(p.ambience.enabled).toBe(defaultProfile.ambience.enabled); // non-boolean → default
    expect(p.ambience.type).toBe('rain');
    expect(p.ambience.level).toBe(0);
    expect(p.lowpassHz).toBe(defaultProfile.lowpassHz);
  });

  it('gives profiles that predate rhythm the legacy simple mode', () => {
    const legacy = structuredClone(STATES.focus.buildProfile(0.5)) as unknown as Record<
      string,
      unknown
    >;
    delete legacy.rhythm;
    const p = normalizeProfile(legacy);
    // Simple mode = the original sine-LFO path: identical sound to before.
    expect(p.rhythm).toEqual({ mode: 'simple', bpm: 80, complexity: 0 });
  });

  it('clamps garbage rhythm values', () => {
    const p = normalizeProfile({
      rhythm: { mode: 'polka', bpm: 999, complexity: -1 },
    });
    expect(p.rhythm.mode).toBe('simple');
    expect(p.rhythm.bpm).toBe(200);
    expect(p.rhythm.complexity).toBe(0);
  });

  it('gives profiles that predate harmony/bass the silent defaults', () => {
    const legacy = structuredClone(STATES.focus.buildProfile(0.5)) as unknown as Record<
      string,
      unknown
    >;
    delete legacy.harmony;
    delete legacy.bass;
    const p = normalizeProfile(legacy);
    // Disabled pad + 0 dB shelf = identical sound to before the fields existed.
    expect(p.harmony).toEqual(defaultProfile.harmony);
    expect(p.harmony.enabled).toBe(false);
    expect(p.bass).toBe(0);
  });

  it('clamps garbage harmony and bass values', () => {
    const p = normalizeProfile({
      harmony: { enabled: true, level: 5, richness: 9, movement: -2, rootHz: -5 },
      bass: 3,
    });
    expect(p.harmony.level).toBe(1);
    expect(p.harmony.richness).toBe(1);
    expect(p.harmony.movement).toBe(0);
    expect(p.harmony.rootHz).toBe(30);
    expect(p.bass).toBe(1);
  });

  it('turns non-objects into the default profile', () => {
    for (const raw of [null, undefined, 42, 'profile']) {
      expect(normalizeProfile(raw)).toEqual(defaultProfile);
    }
  });

  it('produces a complete SoundProfile the engine can always ramp', () => {
    const p: SoundProfile = normalizeProfile({});
    const numbers = [
      p.masterVolume,
      p.tone.frequency,
      p.tone.level,
      p.tone.warmth,
      p.binaural.carrier,
      p.binaural.beat,
      p.binaural.level,
      p.noise.level,
      p.isochronic.rate,
      p.isochronic.depth,
      p.ambience.level,
      p.ambience2.level,
      p.stereoWidth,
      p.lowpassHz,
    ];
    for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
  });

  it('profiles saved before the second ambience bed come back with it disabled', () => {
    const legacy = structuredClone(defaultProfile) as Partial<SoundProfile>;
    delete legacy.ambience2;
    const p = normalizeProfile(legacy);
    expect(p.ambience2).toEqual(defaultProfile.ambience2);
    expect(p.ambience2.enabled).toBe(false);
  });

  it('clamps and completes an invalid second ambience', () => {
    const p = normalizeProfile({
      ...defaultProfile,
      ambience2: { enabled: true, type: 'volcano', level: 7 },
    });
    expect(p.ambience2).toEqual({ enabled: true, type: defaultProfile.ambience2.type, level: 1 });
  });
});
