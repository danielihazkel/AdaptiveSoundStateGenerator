import { describe, expect, it } from 'vitest';
import { generateImpulseResponse, mulberry32 } from './reverbIr';
import { REVERB_SIZE_BUCKETS, bucketForSize, rt60ForBucket } from './reverb';

const SAMPLE_RATE = 44100;

function rms(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (to - from));
}

describe('generateImpulseResponse', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = generateImpulseResponse({ sampleRate: SAMPLE_RATE, rt60Sec: 1, seed: 3 });
    const b = generateImpulseResponse({ sampleRate: SAMPLE_RATE, rt60Sec: 1, seed: 3 });
    const c = generateImpulseResponse({ sampleRate: SAMPLE_RATE, rt60Sec: 1, seed: 4 });
    expect(a.left).toEqual(b.left);
    expect(a.right).toEqual(b.right);
    expect(a.left).not.toEqual(c.left);
  });

  it('truncates at RT60 and never exceeds the 3 s export chunk lead', () => {
    for (let bucket = 0; bucket < REVERB_SIZE_BUCKETS; bucket++) {
      const rt60 = rt60ForBucket(bucket);
      expect(rt60).toBeLessThanOrEqual(3);
      const ir = generateImpulseResponse({ sampleRate: SAMPLE_RATE, rt60Sec: rt60, seed: 1 });
      expect(ir.left.length).toBe(Math.round(rt60 * SAMPLE_RATE));
      expect(ir.left.every(Number.isFinite)).toBe(true);
    }
  });

  it('decays monotonically to roughly −60 dB', () => {
    const ir = generateImpulseResponse({ sampleRate: SAMPLE_RATE, rt60Sec: 2, seed: 5 });
    const win = Math.floor(0.1 * SAMPLE_RATE);
    const levels: number[] = [];
    for (let i = 0; i + win <= ir.left.length; i += win) {
      levels.push(rms(ir.left, i, i + win));
    }
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThan(levels[i - 1]);
    }
    // −60 dB target: the last window sits ~3 orders below the first.
    expect(levels[levels.length - 1] / levels[0]).toBeLessThan(0.01);
  });

  it('produces decorrelated stereo channels', () => {
    const ir = generateImpulseResponse({ sampleRate: SAMPLE_RATE, rt60Sec: 1, seed: 2 });
    let num = 0;
    let dl = 0;
    let dr = 0;
    for (let i = 0; i < ir.left.length; i++) {
      num += ir.left[i] * ir.right[i];
      dl += ir.left[i] ** 2;
      dr += ir.right[i] ** 2;
    }
    expect(Math.abs(num / Math.sqrt(dl * dr))).toBeLessThan(0.1);
  });

  it('starts from silence (no impulsive onset)', () => {
    const ir = generateImpulseResponse({ sampleRate: SAMPLE_RATE, rt60Sec: 1, seed: 7 });
    expect(Math.abs(ir.left[0])).toBe(0);
    expect(Math.abs(ir.left[1])).toBeLessThan(0.05);
  });
});

describe('size buckets', () => {
  it('maps 0..1 onto the bucket range with monotone RT60', () => {
    expect(bucketForSize(0)).toBe(0);
    expect(bucketForSize(1)).toBe(REVERB_SIZE_BUCKETS - 1);
    expect(bucketForSize(-5)).toBe(0);
    expect(bucketForSize(9)).toBe(REVERB_SIZE_BUCKETS - 1);
    for (let b = 1; b < REVERB_SIZE_BUCKETS; b++) {
      expect(rt60ForBucket(b)).toBeGreaterThan(rt60ForBucket(b - 1));
    }
  });
});

describe('mulberry32', () => {
  it('yields uniform-ish values in [0, 1)', () => {
    const rand = mulberry32(123);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeGreaterThan(0.45);
    expect(sum / 10000).toBeLessThan(0.55);
  });
});
