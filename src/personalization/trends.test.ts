import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import type { Rating, SessionRecord } from '../storage/types';
import { scoreSession } from './reward';
import {
  bestFoundAfter,
  completionRate,
  MIN_LIFT_GROUP_SESSIONS,
  personalizationLift,
  ratingTrend,
  TREND_WINDOW,
  trendDirection,
} from './trends';

let seq = 0;
function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `s${seq}`,
    startedAt: new Date(Date.UTC(2026, 0, 1, seq)).toISOString(),
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 1800,
    actualDurationSec: 1800,
    completed: true,
    customized: false,
    volumeAdjustments: 0,
    monoMode: false,
    profile: STATES.focus.buildProfile(0.5),
    servedArmId: 'prior',
    servedBy: 'bandit',
    ...overrides,
  };
}

function rated(rating: Rating, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return session({ feedback: { rating, ratedAt: '2026-01-02T00:00:00.000Z' }, ...overrides });
}

describe('ratingTrend', () => {
  it('orders by start time, scores every session, and smooths over a trailing window', () => {
    const later = rated(5);
    const earlier = rated(1, { startedAt: '2025-12-01T00:00:00.000Z' });
    const unrated = session({ actualDurationSec: 900 });
    const points = ratingTrend([later, unrated, earlier]);
    expect(points.map((p) => p.at)).toEqual([earlier.startedAt, later.startedAt, unrated.startedAt]);
    expect(points.map((p) => p.rated)).toEqual([true, true, false]);
    expect(points[0].score).toBeCloseTo(scoreSession(earlier).value, 6);
    expect(points[0].smoothed).toBeCloseTo(points[0].score, 6);
    expect(points[1].smoothed).toBeCloseTo((points[0].score + points[1].score) / 2, 6);
  });

  it('the window slides: the smoothed value only looks back TREND_WINDOW sessions', () => {
    const records = [
      ...Array.from({ length: TREND_WINDOW }, () => rated(1)),
      ...Array.from({ length: TREND_WINDOW }, () => rated(5)),
    ];
    const points = ratingTrend(records);
    const last = points[points.length - 1];
    expect(last.smoothed).toBeCloseTo(scoreSession(rated(5)).value, 6);
    expect(points[TREND_WINDOW - 1].smoothed).toBeCloseTo(scoreSession(rated(1)).value, 6);
  });

  it('skips recovered sessions', () => {
    const points = ratingTrend([rated(3), session({ recovered: true, completed: false })]);
    expect(points).toHaveLength(1);
  });
});

describe('trendDirection', () => {
  it('reads rising, falling and flat series', () => {
    const rising = ratingTrend([rated(1), rated(2), rated(4), rated(5)]);
    const falling = ratingTrend([rated(5), rated(4), rated(2), rated(1)]);
    const flat = ratingTrend([rated(3), rated(3), rated(3), rated(3)]);
    expect(trendDirection(rising)).toBe('up');
    expect(trendDirection(falling)).toBe('down');
    expect(trendDirection(flat)).toBe('flat');
    expect(trendDirection(ratingTrend([rated(5)]))).toBe('flat');
  });
});

describe('completionRate', () => {
  it('counts finished and open-ended sessions, ignores recovered ones', () => {
    const records = [
      session(),
      session({ completed: false, actualDurationSec: 300 }),
      session({ completed: true, openEnded: true }),
      session({ completed: false, recovered: true }),
    ];
    expect(completionRate(records)).toBeCloseTo(2 / 3, 6);
    expect(completionRate([])).toBeNull();
    expect(completionRate([session({ recovered: true, completed: false })])).toBeNull();
  });
});

describe('bestFoundAfter', () => {
  it('is the 1-based position of the first settled session on the best arm', () => {
    const records = [
      session({ servedArmId: 'prior', banditResolvedAt: 'x' }),
      session({ servedArmId: 'beat-up' }), // served but never resolved
      session({ servedArmId: 'beat-up', banditResolvedAt: 'x' }),
      session({ servedArmId: 'beat-up', banditResolvedAt: 'x' }),
    ];
    expect(bestFoundAfter(records, 'beat-up')).toBe(3);
    expect(bestFoundAfter(records, 'prior')).toBe(1);
    expect(bestFoundAfter(records, 'noise-alt')).toBeNull();
    expect(bestFoundAfter(records, null)).toBeNull();
  });
});

describe('personalizationLift', () => {
  const control = (rating: Rating, servedBy: 'prior' | 'baseline' = 'prior') =>
    rated(rating, { servedBy, servedArmId: 'prior' });
  const personalized = (rating: Rating) =>
    rated(rating, { servedBy: 'bandit', servedArmId: 'noise-up' });

  it('is null until both groups have enough sessions', () => {
    expect(personalizationLift([])).toBeNull();
    const records = [control(3), control(3), personalized(4), personalized(4), personalized(4)];
    expect(records.filter((r) => r.servedBy === 'prior')).toHaveLength(2);
    expect(personalizationLift(records)).toBeNull(); // control below the minimum
  });

  it('contrasts default vs personalized scores and counts held-out serves', () => {
    const records = [
      control(3),
      control(3, 'baseline'),
      control(2, 'baseline'),
      personalized(5),
      personalized(4),
      personalized(5),
    ];
    const lift = personalizationLift(records)!;
    expect(lift.control.n).toBe(3);
    expect(lift.personalized.n).toBe(3);
    expect(lift.heldOutCount).toBe(2);
    expect(lift.personalized.mean).toBeGreaterThan(lift.control.mean);
    expect(lift.lift).toBeCloseTo(lift.personalized.mean - lift.control.mean, 12);
    expect(lift.control.ci).toBeGreaterThan(0);
    expect(MIN_LIFT_GROUP_SESSIONS).toBe(3);
  });

  it('excludes presets, replays, customized and recovered sessions', () => {
    const noise = [
      rated(1, { servedBy: 'preset', servedArmId: undefined, presetId: 'p1' }),
      rated(1, { servedArmId: undefined, servedBy: undefined }),
      rated(1, { customized: true }),
      rated(1, { recovered: true }),
    ];
    const records = [
      ...noise,
      control(4),
      control(4),
      control(4),
      personalized(4),
      personalized(4),
      personalized(4),
    ];
    const lift = personalizationLift(records)!;
    expect(lift.control.n).toBe(3);
    expect(lift.personalized.n).toBe(3);
    // Identical ratings on both sides: no lift either way.
    expect(Math.abs(lift.lift)).toBeLessThan(1e-12);
  });
});
