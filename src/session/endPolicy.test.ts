import { describe, expect, it } from 'vitest';
import { defaultProgram } from '../programs/types';
import { resolveEndChime, resolveEndFadeSeconds, WAKE_FADE_SECONDS } from './endPolicy';

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

  it('a wake-up forces the chime for sleep, but a program endChime false still wins', () => {
    expect(resolveEndChime('sleep', undefined, false, true)).toBe(true);
    const silent = { ...defaultProgram('sleep', 0.5), endChime: false };
    expect(resolveEndChime('sleep', silent, true, true)).toBe(false);
  });
});

describe('resolveEndFadeSeconds', () => {
  it("uses the state's fade normally and a short one for wake-ups", () => {
    expect(resolveEndFadeSeconds('sleep')).toBe(60);
    expect(resolveEndFadeSeconds('sleep', true)).toBe(WAKE_FADE_SECONDS);
  });
});
