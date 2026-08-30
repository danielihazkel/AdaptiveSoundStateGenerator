import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import type { SessionRecord } from '../storage/types';
import { summarizeHistory } from './history';

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
