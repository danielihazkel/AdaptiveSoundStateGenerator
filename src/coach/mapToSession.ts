import { clamp01, type MentalState } from '../audio/states';
import type { CoachGoal, CoachRequest } from './types';

/**
 * Maps a parsed CoachRequest onto the existing setup controls (PRD §11).
 * Deliberately thin: the coach only *fills the controls* — the session then
 * flows through the normal begin() → chooseProfile pipeline so bandit
 * attribution is untouched.
 */
export const COACH_CONFIDENCE_THRESHOLD = 0.5;

const GOAL_TO_STATE: Record<CoachGoal, MentalState> = {
  study: 'focus',
  work: 'focus',
  relax: 'relax',
  sleep: 'sleep',
  meditate: 'meditation',
  energize: 'energy',
  intimacy: 'arousal',
  flow: 'flow',
  calm: 'calm',
  create: 'creative',
};

/** Focus base matches the PRD §11 example's desired_arousal of 0.55. */
const BASE_INTENSITY: Record<MentalState, number> = {
  focus: 0.55,
  relax: 0.5,
  sleep: 0.6,
  energy: 0.7,
  meditation: 0.5,
  arousal: 0.5,
  flow: 0.6,
  calm: 0.5,
  creative: 0.5,
};

const DEFAULT_MINUTES: Record<MentalState, number> = {
  focus: 60,
  relax: 30,
  sleep: 45,
  energy: 20,
  meditation: 20,
  arousal: 30,
  flow: 90, // one ultradian work block
  calm: 15,
  creative: 45,
};

/** When the stated energy pushes against the goal, lean the session deeper. */
export const ENERGY_MISMATCH_INTENSITY_BUMP = 0.15;

export interface CoachPlan {
  state: MentalState;
  intensity: number;
  minutes: number;
}

export function coachPlan(request: CoachRequest): CoachPlan | null {
  if (!request.goal) return null;
  const state = GOAL_TO_STATE[request.goal];

  let intensity = request.desiredArousal ?? BASE_INTENSITY[state];
  const mismatch =
    (request.energy === 'low' && (state === 'focus' || state === 'energy' || state === 'flow')) ||
    (request.energy === 'high' &&
      (state === 'relax' ||
        state === 'sleep' ||
        state === 'meditation' ||
        state === 'arousal' ||
        state === 'calm' ||
        state === 'creative'));
  if (mismatch) intensity += ENERGY_MISMATCH_INTENSITY_BUMP;

  return {
    state,
    intensity: clamp01(intensity),
    minutes: request.durationMin ?? DEFAULT_MINUTES[state],
  };
}
