import { describe, expect, it } from 'vitest';
import { computeHrvTrend, computeRmssd, MIN_RR_PER_WINDOW } from './hrv';
import type { BiometricSample } from './types';

/** n intervals alternating base ± jitter/2 — RMSSD is exactly `jitter`. */
function alternating(n: number, base: number, jitter: number): number[] {
  return Array.from({ length: n }, (_, i) => base + (i % 2 === 0 ? -jitter / 2 : jitter / 2));
}

describe('computeRmssd', () => {
  it('matches a hand-computed value on an alternating series', () => {
    // Successive differences are all ±40 ms → RMSSD = 40.
    expect(computeRmssd(alternating(40, 1000, 40))).toBeCloseTo(40, 6);
  });

  it('returns null without enough clean pairs', () => {
    expect(computeRmssd([])).toBeNull();
    expect(computeRmssd(alternating(MIN_RR_PER_WINDOW - 2, 1000, 40))).toBeNull();
  });

  it('rejects implausible intervals and artifact jumps', () => {
    const clean = alternating(60, 1000, 40);
    const rmssd = computeRmssd(clean)!;
    // Splice implausible values and a huge ectopic jump into the middle.
    const dirty = [...clean.slice(0, 30), 5000, 100, 1600, ...clean.slice(30)];
    const cleaned = computeRmssd(dirty)!;
    expect(cleaned).toBeCloseTo(rmssd, 0);
  });
});

describe('computeHrvTrend', () => {
  function series(opts: {
    minutes: number;
    baseRr: number;
    baseJitter: number;
    /** jitter at the end (linear ramp) — rising jitter = rising HRV. */
    endJitter?: number;
  }): BiometricSample[] {
    const out: BiometricSample[] = [];
    const start = 1_000_000;
    const ticks = opts.minutes * 60;
    for (let i = 0; i < ticks; i++) {
      const t = i / ticks;
      const jitter = opts.baseJitter + ((opts.endJitter ?? opts.baseJitter) - opts.baseJitter) * t;
      out.push({
        heartRateBpm: Math.round(60000 / opts.baseRr),
        timestamp: start + i * 1000,
        rrIntervalsMs: [opts.baseRr + (i % 2 === 0 ? -jitter / 2 : jitter / 2)],
      });
    }
    return out;
  }

  const opts = (samples: BiometricSample[]) => ({
    recentWindowMs: 5 * 60_000,
    now: samples[samples.length - 1].timestamp,
  });

  it('is stable when nothing changes', () => {
    const samples = series({ minutes: 20, baseRr: 1000, baseJitter: 40 });
    expect(computeHrvTrend(samples, opts(samples))!.trend).toBe('stable');
  });

  it('detects rising HRV (settling) and falling HRV (adverse)', () => {
    const settling = series({ minutes: 20, baseRr: 1000, baseJitter: 30, endJitter: 60 });
    const rising = computeHrvTrend(settling, opts(settling))!;
    expect(rising.trend).toBe('rising');
    expect(rising.deltaPct).toBeGreaterThan(0.15);

    const stressed = series({ minutes: 20, baseRr: 1000, baseJitter: 60, endJitter: 25 });
    const falling = computeHrvTrend(stressed, opts(stressed))!;
    expect(falling.trend).toBe('falling');
    expect(falling.deltaPct).toBeLessThan(-0.15);
  });

  it('returns null without RR data or with too little of it', () => {
    const noRr = series({ minutes: 20, baseRr: 1000, baseJitter: 40 }).map(
      ({ heartRateBpm, timestamp }) => ({ heartRateBpm, timestamp }),
    );
    expect(computeHrvTrend(noRr, opts(noRr))).toBeNull();
    // 24 samples → 23 successive pairs, below MIN_RR_PER_WINDOW − 1.
    const short = series({ minutes: 0.4, baseRr: 1000, baseJitter: 40 });
    expect(computeHrvTrend(short, opts(short))).toBeNull();
    expect(computeHrvTrend([], { recentWindowMs: 60_000, now: 0 })).toBeNull();
  });
});
