import { describe, expect, it } from 'vitest';
import { clamp01, lerp, MAX_PULSE_RATE_HZ, STATE_LIST, STATES } from './states';

describe('helpers', () => {
  it('clamp01 clamps out-of-range input', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });

  it('lerp interpolates in both directions', () => {
    expect(lerp(10, 18, 0)).toBe(10);
    expect(lerp(10, 18, 1)).toBe(18);
    expect(lerp(10, 6, 0.5)).toBe(8);
  });
});

describe('state profiles', () => {
  it('exposes exactly the 5 MVP states in order', () => {
    expect(STATE_LIST.map((s) => s.id)).toEqual([
      'focus',
      'relax',
      'sleep',
      'energy',
      'meditation',
    ]);
  });

  it('emits the legacy simple rhythm explicitly (fingerprint stability)', () => {
    for (const state of STATE_LIST) {
      for (const t of [0, 0.5, 1]) {
        expect(state.buildProfile(t).rhythm).toEqual({
          mode: 'simple',
          bpm: 80,
          complexity: 0,
        });
      }
    }
  });

  it('emits disabled harmony and zero bass explicitly (fingerprint stability)', () => {
    for (const state of STATE_LIST) {
      for (const t of [0, 0.5, 1]) {
        const p = state.buildProfile(t);
        expect(p.harmony).toEqual({
          enabled: false,
          level: 0.25,
          richness: 0.5,
          movement: 0.3,
          rootHz: 110,
        });
        expect(p.bass).toBe(0);
      }
    }
  });

  it('clamps intensity outside 0..1', () => {
    for (const state of STATE_LIST) {
      expect(state.buildProfile(-1)).toEqual(state.buildProfile(0));
      expect(state.buildProfile(2)).toEqual(state.buildProfile(1));
    }
  });

  it('keeps every level parameter within 0..1', () => {
    for (const state of STATE_LIST) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const p = state.buildProfile(t);
        for (const level of [
          p.masterVolume,
          p.tone.level,
          p.tone.warmth,
          p.binaural.level,
          p.noise.level,
          p.isochronic.depth,
          p.ambience.level,
          p.stereoWidth,
        ]) {
          expect(level).toBeGreaterThanOrEqual(0);
          expect(level).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('keeps beats within each state PRD range and correct direction', () => {
    // PRD §8: focus 10-18 rising, relaxation 6-10 falling, sleep 1-6 falling.
    expect(STATES.focus.buildProfile(0).binaural.beat).toBe(10);
    expect(STATES.focus.buildProfile(1).binaural.beat).toBe(18);
    expect(STATES.relax.buildProfile(0).binaural.beat).toBe(10);
    expect(STATES.relax.buildProfile(1).binaural.beat).toBe(6);
    expect(STATES.sleep.buildProfile(0).binaural.beat).toBe(6);
    expect(STATES.sleep.buildProfile(1).binaural.beat).toBe(2);
    expect(STATES.energy.buildProfile(1).binaural.beat).toBeGreaterThan(
      STATES.energy.buildProfile(0).binaural.beat,
    );
    expect(STATES.meditation.buildProfile(1).binaural.beat).toBeLessThan(
      STATES.meditation.buildProfile(0).binaural.beat,
    );
  });

  it('never asks for an isochronic rate above the perceptual cap', () => {
    for (const state of STATE_LIST) {
      for (const t of [0, 0.5, 1]) {
        expect(state.buildProfile(t).isochronic.rate).toBeLessThanOrEqual(MAX_PULSE_RATE_HZ);
      }
    }
  });

  it('sleep fades to silence with no chime and reduced highs', () => {
    expect(STATES.sleep.end).toEqual({ fadeSeconds: 60, chime: 'none' });
    expect(STATES.sleep.buildProfile(0.5).lowpassHz).toBe(2000);
  });

  it('marks the drowsy states with the no-driving warning', () => {
    expect(STATE_LIST.filter((s) => s.noDrivingWarning).map((s) => s.id)).toEqual([
      'relax',
      'sleep',
      'meditation',
    ]);
  });
});
