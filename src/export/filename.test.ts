import { describe, expect, it } from 'vitest';
import { exportFilename } from './filename';

describe('exportFilename', () => {
  it('builds a slugged name from a state label', () => {
    expect(exportFilename('focus', 60)).toBe('resonance-focus-60min.mp3');
  });

  it('slugs preset names with spaces and punctuation', () => {
    expect(exportFilename('Deep Work!', 45)).toBe('resonance-deep-work-45min.mp3');
  });

  it('falls back to "session" when nothing sluggable remains', () => {
    expect(exportFilename('★☆★', 30)).toBe('resonance-session-30min.mp3');
  });
});
