import { describe, expect, it } from 'vitest';
import { defaultProgram } from '../programs/types';
import { resolveEndChime } from './endPolicy';

describe('resolveEndChime', () => {
  it('chimes for an optional-chime state with chimes enabled', () => {
    expect(resolveEndChime('focus', undefined, true)).toBe(true);
  });

  it('respects the user opting out of chimes', () => {
    expect(resolveEndChime('focus', undefined, false)).toBe(false);
  });

  it("never chimes for a 'none' state even with chimes enabled", () => {
    expect(resolveEndChime('sleep', undefined, true)).toBe(false);
  });

  it('defers to the base state when the program has no endChime', () => {
    expect(resolveEndChime('focus', defaultProgram('focus', 0.5), true)).toBe(true);
    expect(resolveEndChime('sleep', defaultProgram('sleep', 0.5), true)).toBe(false);
  });

  it('a program endChime overrides everything', () => {
    const wake = { ...defaultProgram('sleep', 0.5), endChime: true };
    expect(resolveEndChime('sleep', wake, false)).toBe(true);
    const silent = { ...defaultProgram('focus', 0.5), endChime: false };
    expect(resolveEndChime('focus', silent, true)).toBe(false);
  });
});
