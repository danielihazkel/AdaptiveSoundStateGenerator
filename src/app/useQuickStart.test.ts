import { describe, expect, it } from 'vitest';
import { MAX_CUSTOM_MINUTES, MIN_CUSTOM_MINUTES } from '../session/durationLimits';
import { parseQuickStart } from './useQuickStart';

describe('parseQuickStart', () => {
  it('returns null without a start param or for an unknown state', () => {
    expect(parseQuickStart('')).toBeNull();
    expect(parseQuickStart('?lab')).toBeNull();
    expect(parseQuickStart('?start=nope')).toBeNull();
    expect(parseQuickStart('?start=toString')).toBeNull();
  });

  it('parses a state with clamped minutes and depth', () => {
    expect(parseQuickStart('?start=focus&minutes=25&depth=0.7')).toEqual({
      kind: 'state',
      state: 'focus',
      minutes: 25,
      intensity: 0.7,
    });
    expect(parseQuickStart('?start=sleep&minutes=999')).toEqual({
      kind: 'state',
      state: 'sleep',
      minutes: MAX_CUSTOM_MINUTES,
    });
    expect(parseQuickStart('?start=sleep&minutes=1&depth=7')).toEqual({
      kind: 'state',
      state: 'sleep',
      minutes: MIN_CUSTOM_MINUTES,
      intensity: 1,
    });
  });

  it('ignores malformed numbers', () => {
    expect(parseQuickStart('?start=calm&minutes=abc')).toEqual({ kind: 'state', state: 'calm' });
  });

  it('recognises last', () => {
    expect(parseQuickStart('?start=last')).toEqual({ kind: 'last' });
  });
});
