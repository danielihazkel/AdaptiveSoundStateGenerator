import { describe, expect, it } from 'vitest';
import { breathingFor, nightstandFor, wakeUpFor } from './sessionOptions';

describe('nightstandFor', () => {
  it('defaults to sleep sessions only', () => {
    expect(nightstandFor('sleep', undefined)).toBe(true);
    expect(nightstandFor('focus', undefined)).toBe(false);
    expect(nightstandFor('sleep', 'sleep')).toBe(true);
  });

  it('honours always / never', () => {
    expect(nightstandFor('focus', 'always')).toBe(true);
    expect(nightstandFor('sleep', 'never')).toBe(false);
  });
});

describe('breathingFor', () => {
  it('only applies to breathing states and explicit patterns', () => {
    expect(breathingFor('calm', 'box')).toBe('box');
    expect(breathingFor('relax', 'relax478')).toBe('relax478');
    expect(breathingFor('calm', 'pulse')).toBeNull();
    expect(breathingFor('calm', undefined)).toBeNull();
    expect(breathingFor('focus', 'box')).toBeNull();
  });
});

describe('wakeUpFor', () => {
  it('is null unless enabled for sleep', () => {
    expect(wakeUpFor('sleep', undefined, 3600)).toBeNull();
    expect(wakeUpFor('sleep', { enabled: false, riseMinutes: 10 }, 3600)).toBeNull();
    expect(wakeUpFor('focus', { enabled: true, riseMinutes: 10 }, 3600)).toBeNull();
  });

  it('clamps the rise and never exceeds half the session', () => {
    expect(wakeUpFor('sleep', { enabled: true, riseMinutes: 10 }, 3600)).toEqual({ riseSec: 600 });
    expect(wakeUpFor('sleep', { enabled: true, riseMinutes: 90 }, 8 * 3600)).toEqual({
      riseSec: 30 * 60,
    });
    expect(wakeUpFor('sleep', { enabled: true, riseMinutes: 1 }, 8 * 3600)).toEqual({
      riseSec: 3 * 60,
    });
    expect(wakeUpFor('sleep', { enabled: true, riseMinutes: 10 }, 600)).toEqual({ riseSec: 300 });
  });
});
