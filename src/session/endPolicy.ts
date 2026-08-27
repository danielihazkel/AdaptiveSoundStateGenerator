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
): boolean {
  return program?.endChime ?? (STATES[state].end.chime === 'optional' && chimeEnabled);
}
