import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import type { SessionRecord } from '../storage/types';
import { summarizeHistory, weeklyReflection } from './history';

function rec(startedAt: Date, actualDurationSec = 1800, state: 'focus' | 'calm' = 'focus'): SessionRecord {
  return {
    id: startedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    state,
    intensity: 0.5,
    plannedDurationSec: 1800,
    actualDurationSec,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(0.5),
  };
}

const NOW = new Date(2026, 7, 30, 15, 0, 0); // local time, mid-afternoon
const daysAgo = (n: number, hour = 9) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, hour);

describe('summarizeHistory', () => {
  it('handles an empty history', () => {
    expect(summarizeHistory([], NOW)).toEqual({
      total: 0,
      thisWeek: 0,
      minutesThisWeek: 0,
      currentStreakDays: 0,
      byState: {},
    });
  });

  it('counts the last 7 days and the state breakdown', () => {
    const s = summarizeHistory(
      [rec(daysAgo(0), 600), rec(daysAgo(6, 23), 1200, 'calm'), rec(daysAgo(8), 1800)],
      NOW,
    );
    expect(s.total).toBe(3);
    expect(s.thisWeek).toBe(2);
    expect(s.minutesThisWeek).toBe(30);
    expect(s.byState).toEqual({ focus: 2, calm: 1 });
  });

  it('streak runs across midnight boundaries by local day', () => {
    // Late last night + early this morning + the day before = 3 days.
    const s = summarizeHistory(
      [rec(daysAgo(0, 1)), rec(daysAgo(1, 23, )), rec(daysAgo(2, 12))],
      NOW,
    );
    expect(s.currentStreakDays).toBe(3);
  });

  it('a streak ending yesterday still counts; a gap breaks it', () => {
    expect(summarizeHistory([rec(daysAgo(1)), rec(daysAgo(2))], NOW).currentStreakDays).toBe(2);
    expect(summarizeHistory([rec(daysAgo(2)), rec(daysAgo(3))], NOW).currentStreakDays).toBe(0);
    expect(summarizeHistory([rec(daysAgo(0)), rec(daysAgo(2))], NOW).currentStreakDays).toBe(1);
  });
});

describe('weeklyReflection', () => {
  const rated = (d: Date, rating: 1 | 2 | 3 | 4 | 5, overrides: Partial<SessionRecord> = {}) => ({
    ...rec(d),
    feedback: { rating, ratedAt: d.toISOString() },
    ...overrides,
  });
  const withNoise = (type: 'brown' | 'pink') => {
    const profile = STATES.focus.buildProfile(0.5);
    profile.noise = { ...profile.noise, enabled: true, type };
    return profile;
  };

  it('stays quiet on a light week', () => {
    expect(weeklyReflection([rec(daysAgo(0)), rec(daysAgo(1))], NOW)).toBeNull();
  });

  it('sums the week, compares it with the one before, and ranks the states', () => {
    const r = weeklyReflection(
      [
        rec(daysAgo(0), 1800),
        rec(daysAgo(2), 1200, 'calm'),
        rec(daysAgo(3), 600),
        rec(daysAgo(9), 900), // the week before
        rec(daysAgo(20), 9999), // too old to count anywhere
      ],
      NOW,
    )!;
    expect(r.sessions).toBe(3);
    expect(r.minutes).toBe(60);
    expect(r.minutesBefore).toBe(15);
    expect(r.topStates).toEqual([
      { state: 'focus', minutes: 40 },
      { state: 'calm', minutes: 20 },
    ]);
  });

  it('has no comparison without an earlier week', () => {
    const r = weeklyReflection([rec(daysAgo(0)), rec(daysAgo(1)), rec(daysAgo(2))], NOW)!;
    expect(r.minutesBefore).toBeNull();
    expect(r.avgRating).toBeNull();
  });

  it('finds the best-rated noise colour and time of day, given enough ratings', () => {
    const r = weeklyReflection(
      [
        rated(daysAgo(0, 9), 5, { profile: withNoise('brown') }),
        rated(daysAgo(1, 9), 4, { profile: withNoise('brown') }),
        rated(daysAgo(2, 20), 2, { profile: withNoise('pink') }),
        rated(daysAgo(3, 20), 3, { profile: withNoise('pink') }),
        rated(daysAgo(4, 13), 5, { profile: withNoise('pink') }), // a single afternoon never wins
        rated(daysAgo(10), 2), // last week
      ],
      NOW,
    )!;
    expect(r.avgRating).toBeCloseTo((5 + 4 + 2 + 3 + 5) / 5, 12);
    expect(r.avgRatingBefore).toBe(2);
    expect(r.bestNoise).toBe('brown');
    expect(r.bestTime).toBe('morning');
  });

  it('counts sleep sessions that faded out on sleep onset', () => {
    const r = weeklyReflection(
      [rec(daysAgo(0)), { ...rec(daysAgo(1)), sleepOnsetSec: 900 }, { ...rec(daysAgo(2)), sleepOnsetSec: 600 }],
      NOW,
    )!;
    expect(r.fellAsleep).toBe(2);
  });
});
