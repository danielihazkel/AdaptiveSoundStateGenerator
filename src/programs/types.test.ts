import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import {
  defaultProgram,
  normalizeProgram,
  programMinDurationSec,
  type Program,
} from './types';

describe('normalizeProgram', () => {
  it('is the identity on a freshly built default program (modulo ids)', () => {
    const program = defaultProgram('focus', 0.5);
    expect(normalizeProgram(program)).toEqual(program);
  });

  it('preserves an explicit endChime and never invents one', () => {
    const plain = defaultProgram('sleep', 0.5);
    expect(normalizeProgram(plain).endChime).toBeUndefined();
    expect(normalizeProgram({ ...plain, endChime: true }).endChime).toBe(true);
    // Anything other than literal true stays absent.
    expect(normalizeProgram({ ...plain, endChime: false }).endChime).toBeUndefined();
    expect(normalizeProgram({ ...plain, endChime: 'yes' }).endChime).toBeUndefined();
  });

  it('preserves an explicit boundaryChime the same way', () => {
    const plain = defaultProgram('focus', 0.5);
    expect(normalizeProgram(plain).boundaryChime).toBeUndefined();
    expect(normalizeProgram({ ...plain, boundaryChime: true }).boundaryChime).toBe(true);
    expect(normalizeProgram({ ...plain, boundaryChime: false }).boundaryChime).toBeUndefined();
  });

  it('turns non-objects into a usable one-segment program', () => {
    for (const raw of [null, undefined, 42, 'program']) {
      const p = normalizeProgram(raw);
      expect(p.segments).toHaveLength(1);
      expect(p.segments[0].startMin).toBe(0);
      expect(p.segments[0].endMin).toBeNull();
      expect(p.baseState).toBe('focus');
      expect(p.baseProfile).toEqual(STATES.focus.buildProfile(0.5));
    }
  });

  it('repairs contiguity: each start becomes the previous end, from 0', () => {
    const p = normalizeProgram({
      segments: [
        { startMin: 2, endMin: 5, bpmRange: [70, 80] },
        { startMin: 9, endMin: 14, bpmRange: [80, 90] },
        { startMin: 20, endMin: null, bpmRange: [90, 100] },
      ],
    });
    expect(p.segments.map((s) => [s.startMin, s.endMin])).toEqual([
      [0, 5],
      [5, 14],
      [14, null],
    ]);
  });

  it('closes a mid-list open segment and keeps only the final one open', () => {
    const p = normalizeProgram({
      segments: [
        { startMin: 0, endMin: null, bpmRange: [70, 80] },
        { startMin: 10, endMin: 20, bpmRange: [80, 90] },
      ],
    });
    expect(p.segments[0].endMin).not.toBeNull();
    expect(p.segments[1].endMin).toBe(20);
  });

  it('nulls a last-segment end that does not extend past its start', () => {
    const p = normalizeProgram({
      segments: [
        { startMin: 0, endMin: 10, bpmRange: [70, 80] },
        { startMin: 10, endMin: 5, bpmRange: [80, 90] },
      ],
    });
    expect(p.segments[1].endMin).toBeNull();
  });

  it('clamps segment values and orders bpm ranges', () => {
    const p = normalizeProgram({
      segments: [
        {
          startMin: 0,
          endMin: 10,
          intensity: 7,
          bpmRange: [500, 10],
          complexity: -2,
          noiseScale: 99,
          lowpassScale: 0,
          harmonyScale: 99,
          bassScale: -1,
          warmth: 7,
        },
      ],
    });
    const s = p.segments[0];
    expect(s.intensity).toBe(1);
    expect(s.bpmRange).toEqual([30, 200]);
    expect(s.complexity).toBe(0);
    expect(s.noiseScale).toBe(2);
    expect(s.lowpassScale).toBe(0.3);
    expect(s.harmonyScale).toBe(2);
    expect(s.bassScale).toBe(0);
    expect(s.warmth).toBe(1);
  });

  it('keeps absent harmony/bass/warmth fields absent', () => {
    const s = normalizeProgram({
      segments: [{ startMin: 0, endMin: 10, bpmRange: [70, 80] }],
    }).segments[0];
    expect(s.harmonyScale).toBeUndefined();
    expect(s.bassScale).toBeUndefined();
    expect(s.warmth).toBeUndefined();
  });

  it('normalizes the base profile through normalizeProfile', () => {
    const p = normalizeProgram({ baseState: 'sleep', baseProfile: { masterVolume: 9 } });
    expect(p.baseProfile.masterVolume).toBe(1);
    expect(p.baseProfile.rhythm.mode).toBe('simple');
  });
});

describe('programMinDurationSec', () => {
  it('is the end of the last closed boundary in seconds', () => {
    expect(programMinDurationSec(defaultProgram('focus', 0.5))).toBe(25 * 60);
  });

  it('falls back to the open segment start when it is the only one', () => {
    const p: Program = normalizeProgram({
      segments: [{ startMin: 0, endMin: null, bpmRange: [70, 80] }],
    });
    expect(programMinDurationSec(p)).toBe(0);
  });
});

describe('defaultProgram', () => {
  it('seeds the five-phase build arc with the state base profile', () => {
    const p = defaultProgram('energy', 0.7);
    expect(p.segments).toHaveLength(5);
    expect(p.segments[0].bpmRange).toEqual([70, 80]);
    expect(p.segments[4].endMin).toBeNull();
    expect(p.baseState).toBe('energy');
    expect(p.baseProfile).toEqual(STATES.energy.buildProfile(0.7));
    // Complexity rises through the build then eases in the sustain.
    const c = p.segments.map((s) => s.complexity);
    expect(c[0]).toBeLessThan(c[1]);
    expect(c[1]).toBeLessThan(c[2]);
    expect(c[2]).toBeLessThan(c[3]);
  });
});
