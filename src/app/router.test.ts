import { describe, expect, it } from 'vitest';
import { hashForScreen, LOCKED, NAVIGABLE, screenForHash } from './router';
import type { Screen } from './types';

describe('router', () => {
  it('round-trips every navigable screen through its hash', () => {
    for (const screen of NAVIGABLE) {
      const hash = hashForScreen(screen);
      expect(hash.startsWith('#')).toBe(true);
      expect(screenForHash(hash)).toBe(screen);
    }
  });

  it('maps the empty hash to setup and setup to the empty hash', () => {
    expect(screenForHash('')).toBe('setup');
    expect(screenForHash('#')).toBe('setup');
    expect(hashForScreen('setup')).toBe('');
  });

  it('gives session and feedback no hash of their own', () => {
    for (const screen of LOCKED) {
      expect(NAVIGABLE.has(screen)).toBe(false);
      expect(hashForScreen(screen)).toBe('');
    }
  });

  it('ignores share tokens and unknown hashes', () => {
    expect(screenForHash('#share=z.abc')).toBeNull();
    expect(screenForHash('#history=1')).toBeNull();
    expect(screenForHash('#nope')).toBeNull();
    expect(screenForHash('#History')).toBeNull();
  });

  it('accepts a hash without the leading #', () => {
    expect(screenForHash('history')).toBe('history');
  });

  it('covers every screen exactly once between navigable and locked or setup', () => {
    const all: Screen[] = ['setup', 'session', 'feedback', 'insights', 'history', 'programEditor', 'lab'];
    for (const screen of all) {
      const navigable = NAVIGABLE.has(screen);
      const locked = LOCKED.has(screen);
      expect(navigable && locked).toBe(false);
      if (!navigable && !locked) expect(screen).toBe('setup');
    }
  });
});
