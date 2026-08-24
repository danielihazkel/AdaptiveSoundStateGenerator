import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLoopCrossfade } from './ambienceAssets';

describe('applyLoopCrossfade', () => {
  it('makes the loop seam continuous: the buffer end lands exactly on the loop start', () => {
    // A ramp makes any seam discontinuity obvious.
    const length = 1000;
    const fade = 100;
    const data = Float32Array.from({ length }, (_, i) => i / length);
    const head = data.slice(0, fade);

    const loopStartSamples = applyLoopCrossfade([data], fade);

    expect(loopStartSamples).toBe(fade);
    // At the very end the blend has fully become the head at index fade-1,
    // so looping back to index `fade` continues the head sequence seamlessly.
    expect(data[length - 1]).toBeCloseTo(head[fade - 1], 6);
    // Start of the seam is still almost entirely original tail.
    expect(data[length - fade]).toBeCloseTo((length - fade) / length, 1);
    // Region before the seam is untouched (float32 storage precision).
    expect(data[length - fade - 1]).toBeCloseTo((length - fade - 1) / length, 6);
  });

  it('is equal-power: constant unit signals never exceed sqrt(2) through the seam', () => {
    const data = new Float32Array(400).fill(1);
    applyLoopCrossfade([data], 100);
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(v).toBeLessThanOrEqual(Math.SQRT2 + 1e-6);
    }
  });

  it('caps the fade at half the buffer', () => {
    const data = new Float32Array(10).fill(0.5);
    expect(applyLoopCrossfade([data], 1000)).toBe(5);
  });
});

describe('probeSampleAssets', () => {
  beforeEach(() => {
    vi.resetModules(); // module-level caches must not leak between tests
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function response(contentType: string, ok = true) {
    return { ok, headers: { get: () => contentType } };
  }

  it('rejects SPA-fallback responses (200 + index.html) for missing files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('text/html')),
    );
    const { probeSampleAssets } = await import('./ambienceAssets');
    expect(await probeSampleAssets()).toEqual(new Set());
  });

  it('accepts only urls answered with an audio content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('forest.mp3') ? response('audio/mpeg') : response('text/html'),
      ),
    );
    const { probeSampleAssets } = await import('./ambienceAssets');
    expect(await probeSampleAssets()).toEqual(new Set(['forest']));
  });

  it('treats network errors as "asset absent"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const { probeSampleAssets } = await import('./ambienceAssets');
    expect(await probeSampleAssets()).toEqual(new Set());
  });
});
