import { describe, expect, it } from 'vitest';
import type { MotionSample } from '../biometrics/motion';
import type { BiometricSample } from '../biometrics/types';
import { asleep } from './sleepOnsetWatcher';

const T0 = 1_000_000;

/** 1 Hz heart rate: 64 bpm sliding to 55 by minute 10, flat after (sleep onset). */
function fallingHr(minutes: number): BiometricSample[] {
  return Array.from({ length: minutes * 60 }, (_, i) => {
    const m = i / 60;
    return { timestamp: T0 + i * 1000, heartRateBpm: Math.round(m < 10 ? 64 - (9 * m) / 10 : 55) };
  });
}

/** 1 Hz motion epochs; `restless(sec)` adds a 4 s burst every 30 s. */
function motion(minutes: number, restless: (sec: number) => boolean = () => false): MotionSample[] {
  return Array.from({ length: minutes * 60 }, (_, i) => ({
    timestamp: T0 + i * 1000,
    activity: restless(i) && i % 30 < 4 ? 0.6 : 0.02 + ((i * 7) % 5) * 0.002,
  }));
}

const now = (minutes: number) => T0 + minutes * 60_000;

describe('asleep (Phase 16: heart rate + phone motion)', () => {
  it('heart rate alone decides as before', () => {
    expect(asleep(fallingHr(20), [], now(20))).toBe(true);
  });

  it('a live heart rate is vetoed while the phone feels movement', () => {
    expect(asleep(fallingHr(20), motion(20, (s) => s > 15 * 60), now(20))).toBe(false);
    expect(asleep(fallingHr(20), motion(20), now(20))).toBe(true);
  });

  it('without a heart-rate sensor, long stillness alone decides', () => {
    expect(asleep([], motion(28, (s) => s < 8 * 60), now(28))).toBe(true);
    expect(asleep([], motion(28, (s) => s > 20 * 60), now(28))).toBe(false);
    // Too soon: under the actigraphy settling-in time.
    expect(asleep([], motion(12), now(12))).toBe(false);
  });

  it('a stale heart rate falls back to motion', () => {
    const staleHr = fallingHr(20);
    expect(asleep(staleHr, motion(28, (s) => s < 8 * 60), now(28))).toBe(true);
  });
});
