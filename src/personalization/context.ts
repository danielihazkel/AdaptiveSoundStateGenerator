/**
 * Serving context for the contextual bandit (PRD §9/§16): the same arm can
 * work differently in the morning than at night, and binaural arms mean
 * nothing on speakers (the engine substitutes a pulsed tone in mono). The
 * bandit keeps a per-(state, context) posterior shrunk toward the state-level
 * one, so context only matters once there is context-specific evidence.
 */
import type { MoodLevel } from '../storage/types';

export type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';

export const TIME_BUCKETS: readonly TimeBucket[] = ['morning', 'afternoon', 'evening', 'night'];

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

export interface ServeContext {
  bucket: TimeBucket;
  /** Speaker / mono fallback active — binaural arms are substituted. */
  mono: boolean;
  /**
   * Phase 15: how the user said they felt going in, bucketed. A separate
   * cell family from time × output (see moodContextKey) — crossing the two
   * would leave too little evidence per cell at ~1 session a day.
   */
  mood?: MoodBucket | null;
}

/** Before-mood, coarsened: the low or high end of the state's own axis. */
export type MoodBucket = 'low' | 'high';

export const MOOD_BUCKETS: readonly MoodBucket[] = ['low', 'high'];

/** 1–2 = low, 4–5 = high; the neutral middle and "didn't say" carry no mood context. */
export function moodBucketOf(level: MoodLevel | undefined): MoodBucket | null {
  if (level === undefined) return null;
  if (level <= 2) return 'low';
  if (level >= 4) return 'high';
  return null;
}

/**
 * Storage key of a mood cell, in the same per-state contexts map as the
 * time × output cells. parseContextKey rejects it ("mood" is no time
 * bucket), so time-of-day readers skip mood cells by construction.
 */
export function moodContextKey(mood: MoodBucket): string {
  return `mood:${mood}`;
}

/** Local time of day: 5–11 morning, 11–17 afternoon, 17–22 evening, else night. */
export function timeBucketOf(date: Date): TimeBucket {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

/** Context a stored session was served in; null when its timestamp is unusable. */
export function contextOf(
  startedAtIso: string,
  mono: boolean,
  moodBefore?: MoodLevel,
): ServeContext | null {
  const date = new Date(startedAtIso);
  if (Number.isNaN(date.getTime())) return null;
  const mood = moodBucketOf(moodBefore);
  return mood ? { bucket: timeBucketOf(date), mono, mood } : { bucket: timeBucketOf(date), mono };
}

/** Stable storage key for a context — never change the format. */
export function contextKey(ctx: ServeContext): string {
  return `${ctx.bucket}:${ctx.mono ? 'mono' : 'stereo'}`;
}

export function parseContextKey(key: string): ServeContext | null {
  const [bucket, output] = key.split(':');
  if (!TIME_BUCKETS.includes(bucket as TimeBucket)) return null;
  if (output !== 'mono' && output !== 'stereo') return null;
  return { bucket: bucket as TimeBucket, mono: output === 'mono' };
}
