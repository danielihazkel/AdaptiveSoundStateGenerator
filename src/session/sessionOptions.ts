import type { BreathingPatternId } from '../audio/breathing';
import type { MentalState } from '../audio/states';
import { DEFAULT_WAKE_UP, MAX_WAKE_RISE_MINUTES, MIN_WAKE_RISE_MINUTES, type Settings } from '../storage/types';
import type { WakeUp } from './evolution';

/** States whose sessions can follow a guided breathing pattern. */
export const BREATH_STATES: ReadonlySet<MentalState> = new Set<MentalState>([
  'calm',
  'relax',
  'meditation',
]);

/** States that can end with a wake-up rise. */
export const WAKE_UP_STATES: ReadonlySet<MentalState> = new Set<MentalState>(['sleep']);

/**
 * The guided-breathing pattern a plain session in `state` should follow,
 * or null: 'pulse' (the default) means "follow the state's own slow pulse",
 * which the pacer derives from the profile and needs no engine side channel.
 */
export function breathingFor(
  state: MentalState,
  setting: BreathingPatternId | undefined,
): Exclude<BreathingPatternId, 'pulse'> | null {
  if (!BREATH_STATES.has(state)) return null;
  if (!setting || setting === 'pulse') return null;
  return setting;
}

/**
 * Wake-up rise for a plain session, or null. The rise never exceeds half
 * the session: a 10-minute nap with a 10-minute rise would be all rise.
 */
export function wakeUpFor(
  state: MentalState,
  setting: Settings['wakeUp'] | undefined,
  durationSec: number,
): WakeUp | null {
  if (!WAKE_UP_STATES.has(state) || !setting?.enabled) return null;
  const riseMinutes = Math.min(
    MAX_WAKE_RISE_MINUTES,
    Math.max(MIN_WAKE_RISE_MINUTES, setting.riseMinutes || DEFAULT_WAKE_UP.riseMinutes),
  );
  return { riseSec: Math.min(riseMinutes * 60, Math.floor(durationSec / 2)) };
}
