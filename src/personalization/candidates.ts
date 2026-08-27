import {
  MAX_PULSE_RATE_HZ,
  STATES,
  type MentalState,
} from '../audio/states';
import { cloneProfile, type NoiseType, type SoundProfile } from '../audio/types';

/**
 * Bandit arms for the Phase 2 optimizer (PRD §9/§16).
 *
 * Arms are perturbation *recipes*, not concrete profiles: each is applied to
 * the state's default `buildProfile(intensity)` at serve time. That keeps arm
 * identity stable while the intensity slider varies, so rewards generalize
 * across intensities instead of fragmenting into per-intensity arms.
 *
 * IMPORTANT: any change to a recipe's math or meaning MUST bump
 * CANDIDATE_SET_VERSION — stored arm statistics are keyed by arm id, and stale
 * stats under a changed recipe would silently corrupt the posterior. A bump
 * resets learning, which is the safe failure mode.
 *
 * masterVolume is never perturbed: it is the user's safety/comfort control.
 */
// v2: priors gained ambience + tone warmth defaults (every arm now sits on a
// different base sound) and the ambience-up/ambience-off arms were added.
// 2026-08 state-prior retuning (harmony/bass/pattern-rhythm defaults) and the
// flow/calm/creative additions deliberately did NOT bump the version: recipe
// math is unchanged, and arm stats measure relative preference against the
// prior, which shifts with it.
export const CANDIDATE_SET_VERSION = 2;

export interface CandidateSpec {
  /** Stable across releases — persisted in SessionRecord.servedArmId. */
  id: string;
  /** Human label for the insights screen. */
  label: string;
  /** Pure: clones the prior, perturbs, clamps. */
  apply(prior: SoundProfile): SoundProfile;
}

/** The identity arm — always present, serves the untouched state default. */
export const PRIOR_ARM_ID = 'prior';

/** Beat perturbations stay inside a per-state band so a state keeps its character. */
const BEAT_BANDS: Record<MentalState, [number, number]> = {
  focus: [8, 20],
  relax: [4, 12],
  sleep: [1, 8],
  energy: [10, 32],
  meditation: [3, 10],
  arousal: [4, 10],
  flow: [14, 40],
  calm: [6, 12],
  creative: [4, 10],
};

const NOISE_SWAP: Partial<Record<NoiseType, NoiseType>> = {
  brown: 'pink',
  pink: 'brown',
  blue: 'white',
  white: 'blue',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scaleBeat(state: MentalState, factor: number) {
  return (prior: SoundProfile): SoundProfile => {
    const next = cloneProfile(prior);
    const [min, max] = BEAT_BANDS[state];
    // Was the prior's pulse rate tracking the beat (states.ts coherence rule)?
    const tracking =
      prior.isochronic.rate === Math.min(prior.binaural.beat, MAX_PULSE_RATE_HZ);
    next.binaural.beat = clamp(prior.binaural.beat * factor, min, max);
    if (tracking) {
      next.isochronic.rate = Math.min(next.binaural.beat, MAX_PULSE_RATE_HZ);
    }
    return next;
  };
}

function shiftCarrier(deltaHz: number) {
  return (prior: SoundProfile): SoundProfile => {
    const next = cloneProfile(prior);
    next.binaural.carrier = clamp(prior.binaural.carrier + deltaHz, 100, 400);
    return next;
  };
}

/**
 * Arm menu per state: the identity prior plus 10 perturbations — 11 total.
 * Deliberately small: Thompson sampling needs a handful of pulls per arm to
 * differentiate, and the data rate is roughly one session a day.
 * carrier-low only (no carrier-high): lower carriers read as warmer/deeper,
 * the direction users most plausibly prefer over the §8 defaults.
 */
export function candidatesFor(state: MentalState): CandidateSpec[] {
  const specs: CandidateSpec[] = [
    { id: PRIOR_ARM_ID, label: 'State default', apply: cloneProfile },
    { id: 'beat-down', label: 'Slower beat', apply: scaleBeat(state, 0.75) },
    { id: 'beat-up', label: 'Faster beat', apply: scaleBeat(state, 1.25) },
    { id: 'carrier-low', label: 'Deeper tone', apply: shiftCarrier(-40) },
    {
      id: 'binaural-soft',
      label: 'Softer beat layer',
      apply: (prior) => {
        const next = cloneProfile(prior);
        next.binaural.level = clamp(prior.binaural.level - 0.07, 0.05, 0.4);
        return next;
      },
    },
    {
      id: 'noise-alt',
      label: 'Alternate noise color',
      apply: (prior) => {
        const next = cloneProfile(prior);
        next.noise.type = NOISE_SWAP[prior.noise.type] ?? prior.noise.type;
        return next;
      },
    },
    {
      id: 'noise-up',
      label: 'More noise',
      apply: (prior) => {
        const next = cloneProfile(prior);
        next.noise.level = clamp(prior.noise.level + 0.1, 0.05, 0.6);
        return next;
      },
    },
  ];

  if (state === 'sleep') {
    // Deeper pulses fight sleep; instead offer an even darker soundscape.
    specs.push({
      id: 'darker',
      label: 'Darker sound',
      apply: (prior) => {
        const next = cloneProfile(prior);
        next.lowpassHz = Math.min(prior.lowpassHz, 1200);
        return next;
      },
    });
  } else {
    specs.push({
      id: 'pulse-deep',
      label: 'Stronger pulse',
      apply: (prior) => {
        const next = cloneProfile(prior);
        next.isochronic.depth = Math.min(prior.isochronic.depth * 1.5, 0.4);
        return next;
      },
    });
  }

  specs.push({
    id: 'iso-off',
    label: 'No pulsing',
    apply: (prior) => {
      const next = cloneProfile(prior);
      next.isochronic.enabled = false;
      return next;
    },
  });

  // Ambience contrast pair (PRD §6E/§10): a clean on/off plus a stronger bed
  // gives componentEffectiveness real signal on whether nature sounds help.
  specs.push({
    id: 'ambience-up',
    label: 'More ambience',
    apply: (prior) => {
      const next = cloneProfile(prior);
      next.ambience.enabled = true;
      next.ambience.level = clamp(prior.ambience.level + 0.15, 0.05, 0.5);
      return next;
    },
  });
  specs.push({
    id: 'ambience-off',
    label: 'No ambience',
    apply: (prior) => {
      const next = cloneProfile(prior);
      next.ambience.enabled = false;
      return next;
    },
  });

  return specs;
}

/**
 * Serve-time composition: state prior at this intensity, then the arm's
 * perturbation. An unknown arm id (stats from a retired recipe) falls back to
 * the prior rather than crashing.
 */
export function buildCandidateProfile(
  state: MentalState,
  intensity: number,
  armId: string,
): SoundProfile {
  const prior = STATES[state].buildProfile(intensity);
  const spec = candidatesFor(state).find((c) => c.id === armId);
  return spec ? spec.apply(prior) : prior;
}
