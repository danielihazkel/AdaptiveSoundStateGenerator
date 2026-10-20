/**
 * Phone-on-the-mattress actigraphy (Phase 16, PRD §17 "movement"): the
 * phone's accelerometer turned into a restlessness signal, so the sleep
 * features work without a heart-rate strap (Web Bluetooth is Chrome-only).
 * Same rules as the heart rate (types.ts): opt-in, in memory only, reset
 * per session — only a per-segment summary is ever persisted.
 *
 * Pure: samples in, verdicts out. Every threshold is relative to the
 * session's own settled baseline, so a phone that picks up the speaker's
 * vibration through the mattress — or sits on a soft vs hard surface —
 * calibrates itself.
 */
export interface MotionSample {
  /** ms epoch at the end of the 1 s epoch. */
  timestamp: number;
  /** Mean |acceleration without gravity| over the epoch, m/s². */
  activity: number;
}

export type MotionTrend = 'restless' | 'still';

/** One epoch per second; a minute bucket needs this many to count. */
const MIN_EPOCHS_PER_MINUTE = 30;
/** The baseline needs this many epochs. */
const MIN_BASELINE_EPOCHS = 60;
const MINUTE_MS = 60_000;

export const MOTION_DEFAULTS = {
  /** Session baseline = the quiet end of the first minutes (phone settled). */
  baselineWindowMs: 3 * MINUTE_MS,
  /** A minute is restless when its burstiest epochs exceed the baseline by this factor… */
  restlessFactor: 3,
  /** …and by at least this much in absolute terms (sensor noise floor), m/s². */
  restlessFloor: 0.08,
  /** Share of restless minutes in a window that makes the window restless. */
  restlessShare: 0.3,
  /** The newest epoch must be at most this old (sensor still live). */
  staleMs: 15_000,
} as const;

function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

/** True when the newest epoch is fresh — the sensor is still delivering. */
export function motionLive(samples: readonly MotionSample[], now: number): boolean {
  const last = samples[samples.length - 1];
  return last !== undefined && now - last.timestamp <= MOTION_DEFAULTS.staleMs;
}

/** The activity level above which an epoch counts as movement; null before the baseline exists. */
export function restlessThreshold(samples: readonly MotionSample[]): number | null {
  if (samples.length === 0) return null;
  const firstTs = samples[0].timestamp;
  const baseline = samples
    .filter((s) => s.timestamp - firstTs <= MOTION_DEFAULTS.baselineWindowMs)
    .map((s) => s.activity);
  if (baseline.length < MIN_BASELINE_EPOCHS) return null;
  // The quiet quarter: settling-in fidgets must not inflate the baseline.
  const quiet = quantile(baseline, 0.25);
  return Math.max(quiet * MOTION_DEFAULTS.restlessFactor, quiet + MOTION_DEFAULTS.restlessFloor);
}

/**
 * Per-minute verdicts over [now − windowMs, now): true = restless, false =
 * still, null = too few epochs to say (sensor gap). Movement on a mattress
 * is bursty — a roll-over lasts a few seconds — so a minute is judged by
 * its P95: about three moving seconds make it restless, one bump doesn't.
 */
function minuteVerdicts(
  samples: readonly MotionSample[],
  threshold: number,
  now: number,
  windowMs: number,
): Array<boolean | null> {
  const minutes = Math.ceil(windowMs / MINUTE_MS);
  const start = now - windowMs;
  const out: Array<boolean | null> = [];
  for (let m = 0; m < minutes; m++) {
    const from = start + m * MINUTE_MS;
    const to = Math.min(from + MINUTE_MS, now);
    const epochs = samples.filter((s) => s.timestamp >= from && s.timestamp < to).map((s) => s.activity);
    out.push(epochs.length < MIN_EPOCHS_PER_MINUTE ? null : quantile(epochs, 0.95) > threshold);
  }
  return out;
}

export interface MotionTrendResult {
  trend: MotionTrend;
  /** Share of judged minutes that were restless, 0..1. */
  restlessShare: number;
}

/**
 * Restless or still over the recent window, or null when the sensor is
 * stale or there isn't enough data yet (no baseline, or under half the
 * window's minutes judged).
 */
export function computeMotionTrend(
  samples: readonly MotionSample[],
  opts: { now: number; recentWindowMs: number },
): MotionTrendResult | null {
  if (!motionLive(samples, opts.now)) return null;
  const threshold = restlessThreshold(samples);
  if (threshold === null) return null;
  const verdicts = minuteVerdicts(samples, threshold, opts.now, opts.recentWindowMs).filter(
    (v): v is boolean => v !== null,
  );
  const minutes = Math.ceil(opts.recentWindowMs / MINUTE_MS);
  if (verdicts.length < Math.max(1, minutes / 2)) return null;
  const share = verdicts.filter(Boolean).length / verdicts.length;
  return { trend: share >= MOTION_DEFAULTS.restlessShare ? 'restless' : 'still', restlessShare: share };
}

/**
 * Lying still for the whole window: every minute judged, none restless.
 * null = can't tell (stale sensor, no baseline, a gap) — callers treat that
 * as "unknown", never as "still".
 */
export function isStill(
  samples: readonly MotionSample[],
  opts: { now: number; sustainMs: number },
): boolean | null {
  if (!motionLive(samples, opts.now)) return null;
  const threshold = restlessThreshold(samples);
  if (threshold === null) return null;
  const verdicts = minuteVerdicts(samples, threshold, opts.now, opts.sustainMs);
  if (verdicts.some((v) => v === null)) return null;
  return verdicts.every((v) => v === false);
}

export const MOTION_SLEEP_ONSET_DEFAULTS = {
  /** No verdict before this much listening (settling in). */
  minElapsedMs: 15 * MINUTE_MS,
  /**
   * Continuous stillness that reads as asleep — the classic actigraphy
   * rule. Longer than the heart-rate detector's 5 min: stillness alone is a
   * weaker signal (people lie still while awake), and a false "asleep" ends
   * the session on someone who is listening.
   */
  sustainMs: 15 * MINUTE_MS,
} as const;

/** Sleep onset from movement alone (no heart-rate sensor live). */
export function detectSleepOnsetFromMotion(
  samples: readonly MotionSample[],
  opts: { now: number; minElapsedMs?: number; sustainMs?: number },
): boolean {
  const o = { ...MOTION_SLEEP_ONSET_DEFAULTS, ...opts };
  if (samples.length === 0 || o.now - samples[0].timestamp < o.minElapsedMs) return false;
  return isStill(samples, { now: o.now, sustainMs: o.sustainMs }) === true;
}
