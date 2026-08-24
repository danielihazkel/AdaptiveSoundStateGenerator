import { describe, expect, it } from 'vitest';
import { computeHrTrend, HR_TREND_THRESHOLD_BPM, MIN_SAMPLES_PER_WINDOW } from './hrTrend';
import type { BiometricSample } from './types';

const MINUTE = 60_000;

/** One sample per 10s from t0, holding `baseline` then `recent` bpm. */
function series(baseline: number, recent: number, totalMin: number): BiometricSample[] {
  const samples: BiometricSample[] = [];
  for (let t = 0; t < totalMin * MINUTE; t += 10_000) {
    const inBaseline = t <= 5 * MINUTE;
    samples.push({
      heartRateBpm: inBaseline ? baseline : recent,
      timestamp: t,
    });
  }
  return samples;
}

describe('computeHrTrend', () => {
  const opts = { recentWindowMs: 10 * MINUTE, now: 20 * MINUTE };

  it('detects rising, falling, and stable', () => {
    expect(computeHrTrend(series(60, 70, 20), opts)!.trend).toBe('rising');
    expect(computeHrTrend(series(70, 60, 20), opts)!.trend).toBe('falling');
    expect(computeHrTrend(series(60, 61, 20), opts)!.trend).toBe('stable');
  });

  it('reports the baseline-relative delta', () => {
    expect(computeHrTrend(series(60, 70, 20), opts)!.deltaBpm).toBe(10);
  });

  it('|Δ| just under the threshold reads as stable', () => {
    const result = computeHrTrend(
      series(60, 60 + HR_TREND_THRESHOLD_BPM - 1, 20),
      opts,
    )!;
    expect(result.trend).toBe('stable');
  });

  it('a single spike cannot flip the median-based trend', () => {
    const samples = series(60, 60, 20);
    samples[samples.length - 1] = { ...samples[samples.length - 1], heartRateBpm: 180 };
    expect(computeHrTrend(samples, opts)!.trend).toBe('stable');
  });

  it('returns null with too few samples in either window', () => {
    expect(computeHrTrend([], opts)).toBeNull();
    const sparse: BiometricSample[] = Array.from(
      { length: MIN_SAMPLES_PER_WINDOW - 1 },
      (_, i) => ({ heartRateBpm: 60, timestamp: i * 10_000 }),
    );
    expect(computeHrTrend(sparse, opts)).toBeNull();
    // Plenty of baseline but a silent recent window (sensor dropped out).
    const stale = series(60, 60, 4);
    expect(computeHrTrend(stale, { recentWindowMs: MINUTE, now: 60 * MINUTE })).toBeNull();
  });
});
