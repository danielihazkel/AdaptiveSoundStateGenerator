import type { MentalState } from '../audio/states';
import { cloneProfile, type SoundProfile } from '../audio/types';
import { sampleArm } from '../personalization/bandit';
import { PRIOR_ARM_ID } from '../personalization/candidates';
import type { ServeContext } from '../personalization/context';
import type { PersonalizationMode, PersonalizationState } from '../storage/types';
import type { AdaptationAction, HrTrend, SegmentObservation } from './types';

/**
 * Mid-session adaptation policy (PRD §17): pure decision logic over one
 * segment's observations — no storage, no audio, rng injected (bandit.ts
 * style). All bandit *credit* still happens post-session in resolveOutcome;
 * this module only decides what to play next.
 */

/** PRD §17 sketches a ~10-minute loop. Sessions ≤ 15 min never adapt. */
export const ADAPT_INTERVAL_SEC = 600;
/** A new arm needs ≥ 5 min to be judged; also clears sleep's 60 s end fade. */
export const END_GUARD_SEC = 300;
/** Micro-prompt auto-dismisses after this long (dismissal = neutral). */
export const PROMPT_TIMEOUT_SEC = 30;
/** Anti-thrash cap; reverts to a liked arm are exempt. */
export const MAX_SWITCHES_PER_SESSION = 2;
/** Two volume tweaks in one segment read as "this sound is wrong" (reward.ts: first tweak is settling in). */
export const IMPLICIT_SWITCH_VOLUME_TWEAKS = 2;
/** Bounded Thompson re-rolls when excluding already-tried arms. */
const RESAMPLE_ATTEMPTS = 6;

/** Sleep soften nudge (one per session): quieter noise, shallower pulse. */
export const SOFTEN_NOISE_FACTOR = 0.85;
export const SOFTEN_PULSE_DEPTH_FACTOR = 0.7;

export interface AdaptationInput {
  state: MentalState;
  mode: PersonalizationMode;
  currentArmId: string;
  /** Arms served earlier this session, oldest first (excluding current). */
  previousArmIds: string[];
  /** Previously served arms whose segment got a 'better' or 'same' answer. */
  likedArmIds: string[];
  switchesSoFar: number;
  softenedAlready: boolean;
  observation: SegmentObservation;
  personalization: PersonalizationState;
  /** Serving context of the running session (time of day × mono), if known. */
  context?: ServeContext;
  rng?: () => number;
}

/**
 * HR only informs adaptation where rising is unambiguously adverse
 * (relax/sleep/meditation/calm/creative). For focus/energy/flow a rising HR
 * could just as well be engagement, and for arousal it is expected, so it is
 * ignored (v1).
 */
function isAdverseHr(state: MentalState, trend: HrTrend | null): boolean {
  if (trend !== 'rising') return false;
  return (
    state === 'relax' ||
    state === 'sleep' ||
    state === 'meditation' ||
    state === 'calm' ||
    state === 'creative'
  );
}

/** Apply the soften nudge to the currently playing profile (arm unchanged). */
export function softenProfile(profile: SoundProfile): SoundProfile {
  const next = cloneProfile(profile);
  next.noise.level *= SOFTEN_NOISE_FACTOR;
  next.isochronic.depth *= SOFTEN_PULSE_DEPTH_FACTOR;
  return next;
}

export function decideAdaptation(input: AdaptationInput): AdaptationAction {
  const { state, mode, observation } = input;

  // Sleep never prompts and never switches arms in v1 — a mid-sleep timbre
  // jump risks waking the user. Biometrics-only: one soften nudge per session.
  if (state === 'sleep') {
    if (observation.hrTrend === 'rising' && !input.softenedAlready) {
      return { kind: 'soften' };
    }
    return { kind: 'stay' };
  }

  // The user took manual control this segment — don't fight their edits.
  if (observation.customizedInSegment) return { kind: 'stay' };

  const response = observation.response;
  if (response === 'better' || response === 'same') return { kind: 'stay' };

  const adverseHr = isAdverseHr(state, observation.hrTrend);
  const implicitBad =
    observation.volumeTweaksInSegment >= IMPLICIT_SWITCH_VOLUME_TWEAKS || adverseHr;

  // Locked mode never explores: only an explicit 'worse' moves anything.
  if (mode === 'locked') {
    if (response !== 'worse') return { kind: 'stay' };
    const revertTo = findRevert(input);
    if (revertTo) return { kind: 'revert', armId: revertTo };
    return input.currentArmId === PRIOR_ARM_ID
      ? { kind: 'stay' }
      : { kind: 'switch', armId: PRIOR_ARM_ID, trigger: 'explicit' };
  }

  const wantsChange = response === 'worse' || (response === null && implicitBad);
  if (!wantsChange) return { kind: 'stay' };

  // Prefer going back to something this session already liked (cap-exempt).
  const revertTo = findRevert(input);
  if (revertTo) return { kind: 'revert', armId: revertTo };

  if (input.switchesSoFar >= MAX_SWITCHES_PER_SESSION) return { kind: 'stay' };

  const trigger = response === 'worse' ? 'explicit' : adverseHr ? 'biometric' : 'implicit';
  const armId = resampleExcluding(input);
  if (!armId) return { kind: 'stay' };
  return { kind: 'switch', armId, trigger };
}

/** Most recent previously-liked arm that isn't what's playing now. */
function findRevert(input: AdaptationInput): string | undefined {
  return [...input.likedArmIds].reverse().find((id) => id !== input.currentArmId);
}

/**
 * Fresh Thompson draw excluding arms already tried this session; bounded
 * retries, then the state default as fallback (or nothing if even that was
 * tried — better to hold steady than repeat a rejected sound).
 */
function resampleExcluding(input: AdaptationInput): string | undefined {
  const tried = new Set([input.currentArmId, ...input.previousArmIds]);
  const rng = input.rng ?? Math.random;
  for (let i = 0; i < RESAMPLE_ATTEMPTS; i++) {
    const draw = sampleArm(input.personalization, input.state, rng, input.context);
    if (!tried.has(draw)) return draw;
  }
  return tried.has(PRIOR_ARM_ID) ? undefined : PRIOR_ARM_ID;
}
