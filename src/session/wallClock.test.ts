import { describe, expect, it } from 'vitest';
import { MAX_END_AT_MINUTES, MIN_CUSTOM_MINUTES } from './durationLimits';
import { formatMinutes, minutesUntil } from './wallClock';

const at = (h: number, m: number) => new Date(2026, 7, 30, h, m, 0, 0);

describe('minutesUntil', () => {
  it('counts to a later time today', () => {
    expect(minutesUntil('23:00', at(22, 15))).toBe(45);
    expect(minutesUntil('07:00', at(0, 30))).toBe(390);
  });

  it('rolls past midnight when the target is already gone', () => {
    expect(minutesUntil('07:00', at(23, 20))).toBe(460);
    // 23.5 h away — beyond what a session can run, so capped.
    expect(minutesUntil('22:00', at(22, 30))).toBe(MAX_END_AT_MINUTES);
  });

  it('treats a target inside the minimum as tomorrow', () => {
    expect(minutesUntil('22:02', at(22, 0))).toBe(MAX_END_AT_MINUTES);
    expect(minutesUntil('01:00', at(0, 58))).toBe(MAX_END_AT_MINUTES);
    expect(minutesUntil('01:05', at(1, 0))).toBe(MIN_CUSTOM_MINUTES);
  });

  it('clamps to the session bounds', () => {
    expect(minutesUntil('23:59', at(0, 0))).toBe(MAX_END_AT_MINUTES);
    expect(minutesUntil('00:05', at(0, 0))).toBe(MIN_CUSTOM_MINUTES);
  });

  it('rejects malformed input', () => {
    expect(minutesUntil('', at(1, 0))).toBeNull();
    expect(minutesUntil('25:00', at(1, 0))).toBeNull();
    expect(minutesUntil('7am', at(1, 0))).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('formats hours and minutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(460)).toBe('7 h 40 min');
  });
});
