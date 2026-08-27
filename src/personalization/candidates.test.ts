import { describe, expect, it } from 'vitest';
import { MAX_PULSE_RATE_HZ, STATE_LIST, STATES } from '../audio/states';
import { MAX_MASTER_VOLUME } from '../ui/AdvancedPanel';
import {
  buildCandidateProfile,
  candidatesFor,
  PRIOR_ARM_ID,
} from './candidates';

const INTENSITIES = [0, 0.5, 1];

/** Per-state beat bands the recipes promise to respect (see candidates.ts). */
const BEAT_BANDS = {
  focus: [8, 20],
  relax: [4, 12],
  sleep: [1, 8],
  energy: [10, 32],
  meditation: [3, 10],
  arousal: [4, 10],
  flow: [14, 40],
  calm: [6, 12],
  creative: [4, 10],
} as const;

describe('candidate sets', () => {
  it('every state has 11 arms with unique stable ids, prior first', () => {
    for (const { id: state } of STATE_LIST) {
      const specs = candidatesFor(state);
      expect(specs).toHaveLength(11);
      expect(specs[0].id).toBe(PRIOR_ARM_ID);
      expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
      for (const spec of specs) expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  it('sleep swaps pulse-deep for darker', () => {
    const sleepIds = candidatesFor('sleep').map((s) => s.id);
    expect(sleepIds).toContain('darker');
    expect(sleepIds).not.toContain('pulse-deep');
    const focusIds = candidatesFor('focus').map((s) => s.id);
    expect(focusIds).toContain('pulse-deep');
    expect(focusIds).not.toContain('darker');
  });

  it('the prior arm is the identity over buildProfile', () => {
    for (const { id: state } of STATE_LIST) {
      for (const t of INTENSITIES) {
        expect(buildCandidateProfile(state, t, PRIOR_ARM_ID)).toEqual(
          STATES[state].buildProfile(t),
        );
      }
    }
  });

  it('unknown arm ids fall back to the prior', () => {
    expect(buildCandidateProfile('focus', 0.5, 'retired-arm')).toEqual(
      STATES.focus.buildProfile(0.5),
    );
  });

  it('ambience arms form a clean on/off contrast within level bounds', () => {
    for (const { id: state } of STATE_LIST) {
      for (const t of INTENSITIES) {
        const prior = STATES[state].buildProfile(t);
        const up = buildCandidateProfile(state, t, 'ambience-up');
        expect(up.ambience.enabled).toBe(true);
        expect(up.ambience.level).toBeGreaterThanOrEqual(0.05);
        expect(up.ambience.level).toBeLessThanOrEqual(0.5);
        expect(up.ambience.level).toBeGreaterThanOrEqual(
          Math.min(prior.ambience.level, 0.5),
        );
        const off = buildCandidateProfile(state, t, 'ambience-off');
        expect(off.ambience.enabled).toBe(false);
      }
    }
  });
});

describe('safety invariants for every state × arm × intensity', () => {
  for (const { id: state } of STATE_LIST) {
    for (const spec of candidatesFor(state)) {
      for (const t of INTENSITIES) {
        it(`${state}/${spec.id}@${t}`, () => {
          const prior = STATES[state].buildProfile(t);
          const profile = buildCandidateProfile(state, t, spec.id);

          // masterVolume is the user's safety control — never perturbed.
          expect(profile.masterVolume).toBe(prior.masterVolume);
          expect(profile.masterVolume).toBeLessThanOrEqual(MAX_MASTER_VOLUME);

          const [beatMin, beatMax] = BEAT_BANDS[state];
          expect(profile.binaural.beat).toBeGreaterThanOrEqual(beatMin);
          expect(profile.binaural.beat).toBeLessThanOrEqual(beatMax);
          expect(profile.binaural.carrier).toBeGreaterThanOrEqual(100);
          expect(profile.binaural.carrier).toBeLessThanOrEqual(400);
          expect(profile.binaural.level).toBeGreaterThanOrEqual(0.05);
          expect(profile.binaural.level).toBeLessThanOrEqual(0.4);

          expect(profile.noise.level).toBeGreaterThanOrEqual(0.05);
          expect(profile.noise.level).toBeLessThanOrEqual(0.6);

          expect(profile.isochronic.rate).toBeLessThanOrEqual(MAX_PULSE_RATE_HZ);
          expect(profile.isochronic.depth).toBeLessThanOrEqual(0.4);

          // Recipes never mutate their input.
          expect(prior).toEqual(STATES[state].buildProfile(t));
        });
      }
    }
  }
});
