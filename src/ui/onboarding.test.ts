import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../storage/types';
import { shouldAutoCompleteTour, shouldShowTour } from './onboarding';

const acknowledged: Settings = { ...defaultSettings, disclaimerAcknowledgedAt: '2026-09-01T00:00:00.000Z' };

describe('onboarding tour gating', () => {
  it('waits for the disclaimer', () => {
    expect(shouldShowTour(defaultSettings, false)).toBe(false);
    expect(shouldAutoCompleteTour(defaultSettings, true)).toBe(false);
  });

  it('shows once to a new user', () => {
    expect(shouldShowTour(acknowledged, false)).toBe(true);
    expect(shouldShowTour({ ...acknowledged, onboardingCompletedAt: '2026-09-01T00:01:00.000Z' }, false)).toBe(
      false,
    );
  });

  it('never interrupts someone who already has sessions, and marks it seen for them', () => {
    expect(shouldShowTour(acknowledged, true)).toBe(false);
    expect(shouldAutoCompleteTour(acknowledged, true)).toBe(true);
    expect(shouldAutoCompleteTour({ ...acknowledged, onboardingCompletedAt: 'x' }, true)).toBe(false);
    expect(shouldAutoCompleteTour(acknowledged, false)).toBe(false);
  });
});
