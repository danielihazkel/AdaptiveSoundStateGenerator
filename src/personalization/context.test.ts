import { describe, expect, it } from 'vitest';
import { contextKey, contextOf, parseContextKey, timeBucketOf } from './context';

/** Local-time constructor so the buckets don't depend on the machine's zone. */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 8, 1, hour, minute);
}

describe('timeBucketOf', () => {
  it('splits the local day at 5 / 11 / 17 / 22', () => {
    expect(timeBucketOf(at(0))).toBe('night');
    expect(timeBucketOf(at(4, 59))).toBe('night');
    expect(timeBucketOf(at(5))).toBe('morning');
    expect(timeBucketOf(at(10, 59))).toBe('morning');
    expect(timeBucketOf(at(11))).toBe('afternoon');
    expect(timeBucketOf(at(16, 59))).toBe('afternoon');
    expect(timeBucketOf(at(17))).toBe('evening');
    expect(timeBucketOf(at(21, 59))).toBe('evening');
    expect(timeBucketOf(at(22))).toBe('night');
    expect(timeBucketOf(at(23, 59))).toBe('night');
  });
});

describe('contextOf / contextKey', () => {
  it('derives a context from a stored timestamp and the output mode', () => {
    expect(contextOf(at(8).toISOString(), false)).toEqual({ bucket: 'morning', mono: false });
    expect(contextOf(at(23).toISOString(), true)).toEqual({ bucket: 'night', mono: true });
  });

  it('is null for an unusable timestamp', () => {
    expect(contextOf('not a date', false)).toBeNull();
    expect(contextOf('', false)).toBeNull();
  });

  it('keys round-trip and reject garbage', () => {
    for (const ctx of [
      { bucket: 'morning' as const, mono: false },
      { bucket: 'night' as const, mono: true },
    ]) {
      expect(parseContextKey(contextKey(ctx))).toEqual(ctx);
    }
    expect(contextKey({ bucket: 'evening', mono: false })).toBe('evening:stereo');
    expect(parseContextKey('noon:stereo')).toBeNull();
    expect(parseContextKey('morning:loud')).toBeNull();
    expect(parseContextKey('')).toBeNull();
  });
});
