import { describe, expect, it } from 'vitest';
import {
  computeMotionTrend,
  detectSleepOnsetFromMotion,
  isStill,
  MOTION_SLEEP_ONSET_DEFAULTS,
  restlessThreshold,
  type MotionSample,
} from './motion';

const T0 = 1_000_000;

/**
 * One epoch per second for `minutes`, from T0. `restlessAt(sec)` = true →
 * that second is part of a 4 s movement burst every 30 s (a roll-over);
 * otherwise a quiet sensor floor with a deterministic wobble.
 */
function series(minutes: number, restlessAt: (sec: number) => boolean = () => false): MotionSample[] {
  return Array.from({ length: minutes * 60 }, (_, i) => {
    const burst = restlessAt(i) && i % 30 < 4;
    return { timestamp: T0 + (i + 1) * 1000, activity: (burst ? 0.6 : 0.02) + ((i * 7) % 5) * 0.002 };
  });
}

const end = (samples: MotionSample[]) => samples[samples.length - 1].timestamp + 500;

describe('restlessThreshold', () => {
  it('needs a baseline, then sits well above the quiet floor', () => {
    expect(restlessThreshold(series(0.5))).toBeNull();
    const t = restlessThreshold(series(5))!;
    expect(t).toBeGreaterThan(0.08);
    expect(t).toBeLessThan(0.6);
  });

  it('is not inflated by fidgeting while settling in', () => {
    const calm = restlessThreshold(series(5))!;
    const fidgety = restlessThreshold(series(5, (s) => s < 180))!;
    expect(fidgety).toBeCloseTo(calm, 6);
  });
});

describe('computeMotionTrend', () => {
  it('reads still, restless, or nothing at all', () => {
    const still = series(20);
    expect(computeMotionTrend(still, { now: end(still), recentWindowMs: 10 * 60_000 })).toEqual({
      trend: 'still',
      restlessShare: 0,
    });
    const tossing = series(20, (s) => s >= 10 * 60);
    expect(computeMotionTrend(tossing, { now: end(tossing), recentWindowMs: 10 * 60_000 })?.trend).toBe(
      'restless',
    );
    expect(computeMotionTrend([], { now: T0, recentWindowMs: 60_000 })).toBeNull();
  });

  it('a stale sensor says nothing', () => {
    const s = series(20);
    expect(computeMotionTrend(s, { now: end(s) + 60_000, recentWindowMs: 10 * 60_000 })).toBeNull();
  });

  it('one bump in a still stretch does not make it restless', () => {
    const s = series(20);
    s[15 * 60].activity = 2; // one jolt (someone sat on the bed)
    expect(computeMotionTrend(s, { now: end(s), recentWindowMs: 10 * 60_000 })?.trend).toBe('still');
  });
});

describe('isStill / detectSleepOnsetFromMotion', () => {
  it('sustained stillness after settling reads as asleep', () => {
    // Tossing for 8 minutes, then 20 minutes lying still.
    const s = series(28, (sec) => sec < 8 * 60);
    expect(isStill(s, { now: end(s), sustainMs: 15 * 60_000 })).toBe(true);
    expect(detectSleepOnsetFromMotion(s, { now: end(s) })).toBe(true);
  });

  it('never fires before the settling-in time, nor while still restless', () => {
    const early = series(MOTION_SLEEP_ONSET_DEFAULTS.minElapsedMs / 60_000 - 1);
    expect(detectSleepOnsetFromMotion(early, { now: end(early) })).toBe(false);
    const restless = series(30, (sec) => sec > 20 * 60);
    expect(isStill(restless, { now: end(restless), sustainMs: 15 * 60_000 })).toBe(false);
    expect(detectSleepOnsetFromMotion(restless, { now: end(restless) })).toBe(false);
  });

  it('a gap in the data is "unknown", never "still"', () => {
    const s = series(30).filter((x) => x.timestamp < T0 + 20 * 60_000 || x.timestamp > T0 + 22 * 60_000);
    expect(isStill(s, { now: end(s), sustainMs: 15 * 60_000 })).toBeNull();
    expect(detectSleepOnsetFromMotion(s, { now: end(s) })).toBe(false);
  });
});
