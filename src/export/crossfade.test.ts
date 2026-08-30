import { describe, expect, it } from 'vitest';
import { mixOverlap } from './crossfade';

describe('mixOverlap', () => {
  it('starts on prev and ends on next', () => {
    const n = 1000;
    const prev = new Float32Array(n).fill(1);
    const next = new Float32Array(n).fill(-1);
    mixOverlap(prev, next);
    expect(next[0]).toBeCloseTo(1, 2);
    expect(next[n - 1]).toBeCloseTo(-1, 2);
  });

  it('is equal-power: uncorrelated unit signals keep unit power across the seam', () => {
    const n = 20000;
    // Deterministic pseudo-random ±1 sequences (LCG), uncorrelated.
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const prev = Float32Array.from({ length: n }, () => Math.sign(rnd()));
    const next = Float32Array.from({ length: n }, () => Math.sign(rnd()));
    mixOverlap(prev, next);
    // Power in the middle fifth, where a linear fade would dip to 0.5.
    let power = 0;
    for (let i = (n * 2) / 5; i < (n * 3) / 5; i++) power += next[i] * next[i];
    power /= n / 5;
    expect(power).toBeGreaterThan(0.9);
    expect(power).toBeLessThan(1.1);
  });

  it('handles length mismatch by mixing the common prefix only', () => {
    const prev = new Float32Array(4).fill(1);
    const next = new Float32Array(8).fill(0);
    mixOverlap(prev, next);
    expect(next[0]).toBeGreaterThan(0.9);
    expect(next[4]).toBe(0);
  });
});
