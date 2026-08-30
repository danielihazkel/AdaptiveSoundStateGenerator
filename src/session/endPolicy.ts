import { STATES, type MentalState } from '../audio/states';
import type { Program } from '../programs/types';

/**
 * Whether the end-of-run fade should finish with a chime. A program's
 * explicit endChime always wins (a sleep-based nap can wake with a chime);
 * otherwise the base state decides — only 'optional' states chime, and only
 * when the user has chimes enabled (PRD §4).
 */
export function resolveEndChime(
  state: MentalState,
  program: Program | undefined,
  chimeEnabled: boolean,
  /** A wake-up session always ends with the chime - that is the alarm. */
  wakeUp = false,
): boolean {
  return program?.endChime ?? (wakeUp || (STATES[state].end.chime === 'optional' && chimeEnabled));
}

/** A wake-up session has already risen - it ends with a short fade, not sleep's minute. */
export const WAKE_FADE_SECONDS = 3;

export function resolveEndFadeSeconds(state: MentalState, wakeUp = false): number {
  return wakeUp ? WAKE_FADE_SECONDS : STATES[state].end.fadeSeconds;
}
