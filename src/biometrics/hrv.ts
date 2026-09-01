import type { HrTrend } from '../adaptation/types';
import type { BiometricSample } from './types';

/**
 * Heart-rate variability from RR intervals (Phase 9). RMSSD — the root mean
 * square of successive RR differences — is the standard short-window,
 * parasympathetic-weighted HRV measure: it rises as the body settles and
 * falls under stress, roughly the mirror of heart rate. Pure functions,
 * mirroring hrTrend.ts: samples in, verdict out; raw RR never leaves memory.
 */

/** Physiologically plausible beat interval (30..200 bpm). */
const RR_MIN_MS = 300;
const RR_MAX_MS = 2000;
/** A successive jump larger than this fraction is an artifact (ectopic/dropout). */
const RR_ARTIFACT_JUMP = 0.2;
/** RMSSD needs a real handful of clean beat pairs per window. */
export const MIN_RR_PER_WINDOW = 30;
/** Session baseline = RR from the first N minutes (same as hrTrend). */
export const HRV_BASELINE_WINDOW_MS = 5 * 60_000;
/** |Δ| below this fraction of baseline reads as noise, not a trend. */
export const HRV_TREND_THRESHOLD = 0.15;

/**
 * RMSSD over a cleaned RR series: intervals outside [300, 2000] ms are
 * dropped, and a successive difference is only counted when both intervals
 * are within 20 % of each other (artifact rejection). Null without enough
 * clean pairs.
 */
export function computeRmssd(rrMs: readonly number[]): number | null {
  let sumSq = 0;
  let pairs = 0;
  let prev: number | null = null;
  for (const rr of rrMs) {
    if (!Number.isFinite(rr) || rr < RR_MIN_MS || rr > RR_MAX_MS) {
      prev = null;
      continue;
    }
    if (prev !== null) {
      if (Math.abs(rr - prev) / prev <= RR_ARTIFACT_JUMP) {
        sumSq += (rr - prev) ** 2;
        pairs += 1;
      }
      // An artifact-sized jump drops the pair but the new interval may still
      // pair with its successor.
    }
    prev = rr;
  }
  if (pairs < MIN_RR_PER_WINDOW - 1) return null;
  return Math.sqrt(sumSq / pairs);
}

export interface HrvTrendResult {
  baselineRmssdMs: number;
  recentRmssdMs: number;
  deltaMs: number;
  /** Signed change relative to baseline (0.2 = +20 %). */
  deltaPct: number;
  /** 'rising' HRV = settling (good for calm states); 'falling' = adverse. */
  trend: HrTrend;
}

function windowRr(
  samples: readonly BiometricSample[],
  from: number,
  to: number,
): number[] {
  const rr: number[] = [];
  for (const s of samples) {
    if (s.timestamp >= from && s.timestamp <= to && s.rrIntervalsMs) {
      rr.push(...s.rrIntervalsMs);
    }
  }
  return rr;
}

/**
 * Baseline-vs-recent RMSSD trend, the HRV mirror of computeHrTrend. Null
 * until both windows hold enough clean RR data (a sensor without RR support
 * simply never produces a verdict).
 */
export function computeHrvTrend(
  samples: readonly BiometricSample[],
  opts: { baselineWindowMs?: number; recentWindowMs: number; now: number },
): HrvTrendResult | null {
  if (samples.length === 0) return null;
  const baselineWindowMs = opts.baselineWindowMs ?? HRV_BASELINE_WINDOW_MS;
  const firstTs = samples[0].timestamp;
  const baseline = computeRmssd(windowRr(samples, firstTs, firstTs + baselineWindowMs));
  const recent = computeRmssd(windowRr(samples, opts.now - opts.recentWindowMs, opts.now));
  if (baseline === null || recent === null || baseline <= 0) return null;
  const deltaMs = recent - baseline;
  const deltaPct = deltaMs / baseline;
  const trend: HrTrend =
    Math.abs(deltaPct) < HRV_TREND_THRESHOLD
      ? 'stable'
      : deltaPct > 0
        ? 'rising'
        : 'falling';
  return { baselineRmssdMs: baseline, recentRmssdMs: recent, deltaMs, deltaPct, trend };
}
