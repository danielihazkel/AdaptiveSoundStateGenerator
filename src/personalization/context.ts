/**
 * Serving context for the contextual bandit (PRD §9/§16): the same arm can
 * work differently in the morning than at night, and binaural arms mean
 * nothing on speakers (the engine substitutes a pulsed tone in mono). The
 * bandit keeps a per-(state, context) posterior shrunk toward the state-level
 * one, so context only matters once there is context-specific evidence.
 */
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
export function contextOf(startedAtIso: string, mono: boolean): ServeContext | null {
  const date = new Date(startedAtIso);
  if (Number.isNaN(date.getTime())) return null;
  return { bucket: timeBucketOf(date), mono };
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
