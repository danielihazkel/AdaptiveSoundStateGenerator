import { describe, expect, it } from 'vitest';
import { floatToInt16Block, MP3_BLOCK_SAMPLES } from './pcm';

describe('floatToInt16Block', () => {
  it('scales full-range floats to the int16 extremes', () => {
    const out = new Int16Array(4);
    const n = floatToInt16Block(new Float32Array([1, -1, 0, 0.5]), 0, out);
    expect(n).toBe(4);
    expect(Array.from(out)).toEqual([32767, -32768, 0, Math.round(0.5 * 32767)]);
  });

  it('clamps samples outside [-1, 1] (limiter overshoot safety)', () => {
    const out = new Int16Array(2);
    floatToInt16Block(new Float32Array([2.5, -3]), 0, out);
    expect(Array.from(out)).toEqual([32767, -32768]);
  });

  it('reads from the given offset', () => {
    const src = new Float32Array([0, 0, 1, -1]);
    const out = new Int16Array(2);
    const n = floatToInt16Block(src, 2, out);
    expect(n).toBe(2);
    expect(Array.from(out)).toEqual([32767, -32768]);
  });

  it('returns a short count for the final partial block', () => {
    const src = new Float32Array(MP3_BLOCK_SAMPLES + 10);
    const out = new Int16Array(MP3_BLOCK_SAMPLES);
    expect(floatToInt16Block(src, MP3_BLOCK_SAMPLES, out)).toBe(10);
    expect(floatToInt16Block(src, src.length, out)).toBe(0);
  });
});
