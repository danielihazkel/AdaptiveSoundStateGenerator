import type { BiometricSample } from './types';

/**
 * Sleep-onset detection from heart rate (Phase 9). At sleep onset the heart
 * rate falls several bpm below the settling-in baseline and then stays low
 * and steady. Pure: samples in, verdict out — the orchestrator polls this
 * during opted-in sleep sessions and winds the session down on the first
 * true. Deliberately conservative: a false "asleep" ends someone's session
 * while they are awake, a false "awake" merely plays on.
 */
export interface SleepOnsetOptions {
  /** ms epoch of the evaluation moment. */
  now: number;
  /** No verdict before this much session time (settling in). */
  minElapsedMs?: number;
  /** Session baseline = median HR of the first N minutes. */
  baselineWindowMs?: number;
  /** HR must sit below the threshold for this long, continuously. */
  sustainMs?: number;
  /** Required drop: min(dropBpm, dropFraction × baseline). */
  dropBpm?: number;
  dropFraction?: number;
  /** Recent-window interquartile range must be at most this (steady). */
  iqrBpm?: number;
  /** The newest sample must be at most this old (sensor still live). */
  staleMs?: number;
  /**
   * Seam for a future stillness signal (DeviceMotion): pass false to veto a
   * verdict while movement is detected. Absent = unknown = no veto.
   */
  stillness?: boolean;
}

export const SLEEP_ONSET_DEFAULTS = {
  minElapsedMs: 10 * 60_000,
  baselineWindowMs: 5 * 60_000,
  sustainMs: 5 * 60_000,
  dropBpm: 6,
  dropFraction: 0.08,
  iqrBpm: 4,
  staleMs: 15_000,
} as const;

/** Each sustain-window minute bucket needs at least this many samples. */
const MIN_SAMPLES_PER_BUCKET = 3;
/** Baseline needs at least this many samples (mirrors hrTrend.ts). */
const MIN_BASELINE_SAMPLES = 6;
const BUCKET_MS = 60_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

export interface SleepOnsetResult {
  onset: boolean;
  /** How far below baseline the sustained HR sits (bpm); null if no verdict. */
  deltaBpm: number | null;
}

export function detectSleepOnset(
  samples: readonly BiometricSample[],
  opts: SleepOnsetOptions,
): SleepOnsetResult {
  const o = { ...SLEEP_ONSET_DEFAULTS, ...opts };
  const none: SleepOnsetResult = { onset: false, deltaBpm: null };
  if (samples.length === 0 || o.stillness === false) return none;

  const firstTs = samples[0].timestamp;
  if (o.now - firstTs < o.minElapsedMs) return none;
  const last = samples[samples.length - 1];
  if (o.now - last.timestamp > o.staleMs) return none;

  const baselineHr = samples
    .filter((s) => s.timestamp - firstTs <= o.baselineWindowMs)
    .map((s) => s.heartRateBpm);
  if (baselineHr.length < MIN_BASELINE_SAMPLES) return none;
  const baseline = median(baselineHr);
  const threshold = baseline - Math.min(o.dropBpm, o.dropFraction * baseline);

  // Every 1-minute bucket of the sustain window must sit below the threshold.
  const sustainStart = o.now - o.sustainMs;
  const buckets = Math.ceil(o.sustainMs / BUCKET_MS);
  const recent: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const from = sustainStart + b * BUCKET_MS;
    const to = Math.min(from + BUCKET_MS, o.now);
    const bucket = samples
      .filter((s) => s.timestamp >= from && s.timestamp < to)
      .map((s) => s.heartRateBpm);
    if (bucket.length < MIN_SAMPLES_PER_BUCKET) return none;
    if (median(bucket) > threshold) return none;
    recent.push(...bucket);
  }

  // Steady, not just low: a tossing-and-turning HR swings too much.
  const sorted = [...recent].sort((a, b) => a - b);
  const iqr = percentile(sorted, 0.75) - percentile(sorted, 0.25);
  if (iqr > o.iqrBpm) return none;

  return { onset: true, deltaBpm: baseline - median(recent) };
}
