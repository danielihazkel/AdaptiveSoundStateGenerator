import type { HrTrend } from '../adaptation/types';
import type { BiometricSample } from './types';

/**
 * Baseline-relative heart-rate trend (Phase 3, PRD §17). Medians on both
 * windows so a single spiky reading can't flip the trend. Pure: samples in,
 * verdict out.
 */

/** Session baseline = median of the first N minutes of samples. */
export const BASELINE_WINDOW_MS = 5 * 60_000;
/** |Δ| below this reads as noise, not a trend. */
export const HR_TREND_THRESHOLD_BPM = 3;
/** Both windows need at least this many samples for a verdict. */
export const MIN_SAMPLES_PER_WINDOW = 6;

export interface HrTrendResult {
  deltaBpm: number;
  trend: HrTrend;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeHrTrend(
  samples: BiometricSample[],
  opts: { baselineWindowMs?: number; recentWindowMs: number; now: number },
): HrTrendResult | null {
  if (samples.length === 0) return null;
  const baselineWindowMs = opts.baselineWindowMs ?? BASELINE_WINDOW_MS;
  const firstTs = samples[0].timestamp;

  const baseline = samples
    .filter((s) => s.timestamp - firstTs <= baselineWindowMs)
    .map((s) => s.heartRateBpm);
  const recent = samples
    .filter((s) => opts.now - s.timestamp <= opts.recentWindowMs)
    .map((s) => s.heartRateBpm);
  if (baseline.length < MIN_SAMPLES_PER_WINDOW || recent.length < MIN_SAMPLES_PER_WINDOW) {
    return null;
  }

  const deltaBpm = median(recent) - median(baseline);
  const trend: HrTrend =
    Math.abs(deltaBpm) < HR_TREND_THRESHOLD_BPM
      ? 'stable'
      : deltaBpm > 0
        ? 'rising'
        : 'falling';
  return { deltaBpm, trend };
}
