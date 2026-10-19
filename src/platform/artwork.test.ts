// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { STATES, type MentalState } from '../audio/states';
import { ARTWORK_SIZE, FALLBACK_ARTWORK, stateArtwork, stateArtworkPng } from './artwork';

describe('state artwork', () => {
  // jsdom has no 2D canvas: this exercises the fallback path, which is the
  // one that must never throw (the browser path is covered by the e2e specs).
  it('falls back to the PWA icon where a canvas cannot draw', () => {
    for (const state of Object.keys(STATES) as MentalState[]) {
      const [image] = stateArtwork(state);
      expect(image.src).toBe(FALLBACK_ARTWORK);
      expect(image.sizes).toBe(`${ARTWORK_SIZE}x${ARTWORK_SIZE}`);
      expect(image.type).toBe('image/png');
    }
  });

  it('has no cover bytes without a canvas', async () => {
    expect(await stateArtworkPng('sleep')).toBeNull();
  });
});

describe('stateArtwork caching', () => {
  it('returns the same array per state (it is an effect dependency)', () => {
    expect(stateArtwork('focus')).toBe(stateArtwork('focus'));
    expect(stateArtwork('focus')).not.toBe(stateArtwork('sleep'));
  });
});
