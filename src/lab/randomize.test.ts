import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { LOWPASS_OPEN_HZ, normalizeProfile } from '../audio/types';
import { randomizeProfile } from './randomize';

/** Deterministic LCG so draws are reproducible. */
function seededRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('randomizeProfile', () => {
  it('is deterministic under a seeded rand', () => {
    const base = STATES.focus.buildProfile(0.5);
    expect(randomizeProfile(base, seededRand(42))).toEqual(
      randomizeProfile(base, seededRand(42)),
    );
  });

  it('never touches master volume and stays inside listenable bounds', () => {
    const base = STATES.focus.buildProfile(0.5);
    const rand = seededRand(7);
    for (let i = 0; i < 200; i++) {
      const p = randomizeProfile(base, rand);
      expect(p.masterVolume).toBe(base.masterVolume);
      expect(p.noise.level).toBeLessThanOrEqual(0.6);
      expect(p.binaural.level).toBeLessThanOrEqual(0.4);
      expect(p.isochronic.depth).toBeLessThanOrEqual(0.4);
      expect(p.tone.level).toBeLessThanOrEqual(0.2);
      expect(p.rhythm.bpm).toBeGreaterThanOrEqual(60);
      expect(p.rhythm.bpm).toBeLessThanOrEqual(140);
      expect(p.rhythm.complexity).toBeLessThanOrEqual(0.8);
      expect(p.harmony.level).toBeLessThanOrEqual(0.4);
      expect(p.harmony.rootHz).toBeGreaterThanOrEqual(60);
      expect(p.harmony.rootHz).toBeLessThanOrEqual(300);
      expect(p.bass).toBeLessThanOrEqual(0.6);
      expect(p.space.level).toBeLessThanOrEqual(0.35);
      expect(p.space.size).toBeGreaterThanOrEqual(0.2);
      expect(p.space.size).toBeLessThanOrEqual(0.9);
      expect(p.lowpassHz).toBeGreaterThanOrEqual(2000);
      expect(p.lowpassHz).toBeLessThanOrEqual(LOWPASS_OPEN_HZ);
      // Only synth ambience — a draw must not depend on shipped assets.
      expect(['rain', 'ocean', 'wind', 'space']).toContain(p.ambience.type);
      // Already in-range: the engine-facing sanitizer has nothing to fix.
      expect(normalizeProfile(p)).toEqual(p);
    }
  });

  it('does not mutate the base profile', () => {
    const base = STATES.relax.buildProfile(0.3);
    const copy = structuredClone(base);
    randomizeProfile(base, seededRand(1));
    expect(base).toEqual(copy);
  });
});
