import type { SoundProfile } from '../audio/types';

/**
 * Pulses slower than this are perceived as a breathing pacer rather than a
 * rhythm (calm runs 0.1–0.15 Hz ≈ 6–9 breaths/min). Pattern-mode rhythms are
 * musical tempi and never qualify.
 */
export const MAX_BREATHING_RATE_HZ = 0.5;

/** The breath rate (Hz) the pacer should show for this profile, or null. */
export function pacerRateFor(profile: SoundProfile): number | null {
  const { isochronic, rhythm } = profile;
  if (!isochronic.enabled || isochronic.depth <= 0) return null;
  if (rhythm.mode !== 'simple') return null;
  if (!(isochronic.rate > 0) || isochronic.rate > MAX_BREATHING_RATE_HZ) return null;
  return isochronic.rate;
}

export function breathsPerMinute(rateHz: number): number {
  return Math.round(rateHz * 60);
}
