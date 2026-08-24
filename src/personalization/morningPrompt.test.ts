import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import type { SessionRecord } from '../storage/types';
import {
  findPendingMorningPrompt,
  ratingWindowExpired,
  sessionEndMs,
} from './morningPrompt';

/** "Now" for all tests: the morning of Aug 23. */
const NOW = new Date('2026-08-23T07:00:00.000Z');

function sleepSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    startedAt: '2026-08-22T22:00:00.000Z', // ended 23:00 — 8h before NOW
    state: 'sleep',
    intensity: 0.7,
    plannedDurationSec: 3600,
    actualDurationSec: 3600,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.sleep.buildProfile(0.7),
    servedArmId: 'prior',
    servedBy: 'prior',
    ...overrides,
  };
}

describe('findPendingMorningPrompt', () => {
  it('returns last night’s completed sleep session', () => {
    const session = sleepSession();
    expect(findPendingMorningPrompt([session], NOW)?.id).toBe(session.id);
  });

  it('excludes sessions outside the 18h window', () => {
    const old = sleepSession({ startedAt: '2026-08-21T22:00:00.000Z' }); // 33h ago
    expect(findPendingMorningPrompt([old], NOW)).toBeNull();
  });

  it('excludes rated, skipped, early-stopped, and non-sleep sessions', () => {
    const rated = sleepSession({
      feedback: { rating: 4, ratedAt: '2026-08-23T06:00:00.000Z' },
    });
    const skipped = sleepSession({ feedbackSkipped: true });
    const earlyStopped = sleepSession({ completed: false, actualDurationSec: 900 });
    const focus = sleepSession({ state: 'focus' });
    expect(
      findPendingMorningPrompt([rated, skipped, earlyStopped, focus], NOW),
    ).toBeNull();
  });

  it('picks the most recent when several qualify', () => {
    const earlier = sleepSession({ startedAt: '2026-08-22T20:00:00.000Z' });
    const later = sleepSession({ startedAt: '2026-08-22T23:00:00.000Z' });
    expect(findPendingMorningPrompt([later, earlier], NOW)?.id).toBe(later.id);
    expect(findPendingMorningPrompt([earlier, later], NOW)?.id).toBe(later.id);
  });
});

describe('ratingWindowExpired', () => {
  it('flips exactly past the window from session end', () => {
    const session = sleepSession(); // ends 22:00 + 1h = 23:00 on Aug 22
    expect(sessionEndMs(session)).toBe(Date.parse('2026-08-22T23:00:00.000Z'));
    const justInside = new Date('2026-08-23T16:59:00.000Z');
    const justOutside = new Date('2026-08-23T17:01:00.000Z');
    expect(ratingWindowExpired(session, justInside)).toBe(false);
    expect(ratingWindowExpired(session, justOutside)).toBe(true);
  });
});
