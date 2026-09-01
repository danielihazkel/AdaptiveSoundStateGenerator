import type { Settings } from '../storage/types';

/**
 * The tour shows once, right after the safety disclaimer, to people who
 * have not run a session yet. Anyone who already has sessions predates the
 * tour and is not interrupted by it — the app marks it seen for them.
 */
export function shouldShowTour(settings: Settings, hasSessions: boolean): boolean {
  if (!settings.disclaimerAcknowledgedAt) return false;
  if (settings.onboardingCompletedAt) return false;
  return !hasSessions;
}

/** Existing users skip the tour silently — stamp it so the check stops running. */
export function shouldAutoCompleteTour(settings: Settings, hasSessions: boolean): boolean {
  return Boolean(settings.disclaimerAcknowledgedAt) && !settings.onboardingCompletedAt && hasSessions;
}
