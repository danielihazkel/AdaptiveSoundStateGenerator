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
  it('exposes exactly the 9 states in order', () => {
    expect(STATE_LIST.map((s) => s.id)).toEqual([
      'focus',
      'relax',
      'sleep',
      'energy',
      'meditation',
      'arousal',
      'flow',
      'calm',
      'creative',
    ]);
  });

  it('emits the rhythm block explicitly (fingerprint stability)', () => {
    for (const state of STATE_LIST) {
      if (state.id === 'energy') continue; // pattern rhythm, asserted below
      for (const t of [0, 0.5, 1]) {
        expect(state.buildProfile(t).rhythm).toEqual({
          mode: 'simple',
          bpm: 80,
          complexity: 0,
        });
      }
    }
  });

  it('gives energy a driving pattern rhythm', () => {
    const low = STATES.energy.buildProfile(0).rhythm;
    const high = STATES.energy.buildProfile(1).rhythm;
    expect(low).toEqual({ mode: 'pattern', bpm: 115, complexity: 0.3 });
    expect(high).toEqual({ mode: 'pattern', bpm: 140, complexity: 0.55 });
  });

  it('emits harmony explicitly — disabled block for the pad-free states', () => {
    const padFree = ['focus', 'sleep', 'energy', 'flow'];
    for (const state of STATE_LIST) {
      for (const t of [0, 0.5, 1]) {
        const p = state.buildProfile(t);
        if (padFree.includes(state.id)) {
          expect(p.harmony).toEqual({
            enabled: false,
            level: 0.25,
            richness: 0.5,
            movement: 0.3,
            rootHz: 110,
          });
        } else {
          expect(p.harmony.enabled).toBe(true);
        }
      }
    }
  });

  it('roots each harmony pad where the state lives', () => {
    expect(STATES.relax.buildProfile(0.5).harmony.rootHz).toBe(110);
    expect(STATES.meditation.buildProfile(0.5).harmony.rootHz).toBe(105);
    expect(STATES.arousal.buildProfile(0.5).harmony.rootHz).toBe(98);
    expect(STATES.calm.buildProfile(0.5).harmony.rootHz).toBe(110);
    expect(STATES.creative.buildProfile(0.5).harmony.rootHz).toBe(146.8);
  });

  it('keeps bass grounded per state', () => {
    for (const id of ['focus', 'flow', 'creative', 'arousal'] as const) {
      expect(STATES[id].buildProfile(0.5).bass).toBe(0);
    }
    expect(STATES.relax.buildProfile(0.5).bass).toBe(0.1);
    expect(STATES.meditation.buildProfile(0.5).bass).toBe(0.1);
    expect(STATES.calm.buildProfile(0.5).bass).toBe(0.15);
    expect(STATES.sleep.buildProfile(0).bass).toBe(0.1);
    expect(STATES.sleep.buildProfile(1).bass).toBe(0.2);
    expect(STATES.energy.buildProfile(0).bass).toBe(0.1);
    expect(STATES.energy.buildProfile(1).bass).toBe(0.25);
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
          p.harmony.level,
          p.bass,
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
    expect(STATES.arousal.buildProfile(0).binaural.beat).toBe(8);
    expect(STATES.arousal.buildProfile(1).binaural.beat).toBe(6);
    // flow rises into gamma; calm and creative settle toward theta.
    expect(STATES.flow.buildProfile(0).binaural.beat).toBe(18);
    expect(STATES.flow.buildProfile(1).binaural.beat).toBe(40);
    expect(STATES.calm.buildProfile(0).binaural.beat).toBe(10);
    expect(STATES.calm.buildProfile(1).binaural.beat).toBe(8);
    expect(STATES.creative.buildProfile(0).binaural.beat).toBe(9);
    expect(STATES.creative.buildProfile(1).binaural.beat).toBe(6);
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

  it('arousal fades gently with no chime and warm softened highs', () => {
    expect(STATES.arousal.end).toEqual({ fadeSeconds: 6, chime: 'none' });
    expect(STATES.arousal.buildProfile(0.5).lowpassHz).toBe(6000);
  });

  it('flow ends crisply with an optional chime', () => {
    expect(STATES.flow.end).toEqual({ fadeSeconds: 1.5, chime: 'optional' });
  });

  it('calm fades slowly with no chime and softened highs', () => {
    expect(STATES.calm.end).toEqual({ fadeSeconds: 6, chime: 'none' });
    expect(STATES.calm.buildProfile(0.5).lowpassHz).toBe(8000);
  });

  it('calm paces breathing at 6-9 breaths per minute, not the beat', () => {
    const low = STATES.calm.buildProfile(0).isochronic;
    const high = STATES.calm.buildProfile(1).isochronic;
    expect(low.rate).toBeCloseTo(0.15); // 9 breaths/min
    expect(high.rate).toBeCloseTo(0.1); // 6 breaths/min — resonance frequency
    expect(low.rate).not.toBe(STATES.calm.buildProfile(0).binaural.beat);
  });

  it('creative fades gently with no chime', () => {
    expect(STATES.creative.end).toEqual({ fadeSeconds: 4, chime: 'none' });
  });

  it('marks the drowsy states with the no-driving warning', () => {
    expect(STATE_LIST.filter((s) => s.noDrivingWarning).map((s) => s.id)).toEqual([
      'relax',
      'sleep',
      'meditation',
      'arousal',
      'calm',
      'creative',
    ]);
  });
});
