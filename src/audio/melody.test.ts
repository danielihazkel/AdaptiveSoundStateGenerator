import { describe, expect, it } from 'vitest';
import { MELODY_MAX_HZ, MELODY_MIN_HZ, MELODY_SLOT_SEC, melodyNoteAt, melodyNotesBetween } from './melody';

const PENTATONIC_CLASSES = new Set([0, 2, 4, 7, 9]);

/** Semitones above the root, folded into one octave. */
function pitchClass(frequency: number, rootHz: number): number {
  const semis = Math.round(12 * Math.log2(frequency / rootHz));
  return ((semis % 12) + 12) % 12;
}

describe('melody notes (Phase 17)', () => {
  it('are a pure function of time — the same window always yields the same notes', () => {
    const a = melodyNotesBetween(600, 900, 4, 110);
    const b = melodyNotesBetween(600, 900, 4, 110);
    expect(a).toEqual(b);
    // Split windows (two export chunks) agree with one window.
    expect([...melodyNotesBetween(600, 750, 4, 110), ...melodyNotesBetween(750, 900, 4, 110)]).toEqual(a);
  });

  it('average `density` notes a minute over the long run', () => {
    // Every density compares the same per-slot draws, so short windows err
    // together; 40 hours pins the rate to within a few percent.
    for (const density of [1, 3, 8]) {
      const minutes = 2400;
      const notes = melodyNotesBetween(0, minutes * 60, density, 110);
      expect(notes.length / minutes).toBeGreaterThan(density * 0.95);
      expect(notes.length / minutes).toBeLessThan(density * 1.05);
    }
  });

  it('stay on the major pentatonic of the root, inside the band', () => {
    for (const rootHz of [55, 98, 110, 220]) {
      for (const note of melodyNotesBetween(0, 3600, 8, rootHz)) {
        expect(PENTATONIC_CLASSES.has(pitchClass(note.frequency, rootHz))).toBe(true);
        expect(note.frequency).toBeGreaterThanOrEqual(MELODY_MIN_HZ);
        expect(note.frequency).toBeLessThanOrEqual(MELODY_MAX_HZ);
        expect(note.velocity).toBeGreaterThanOrEqual(0.6);
        expect(note.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('land inside their own slot, in time order', () => {
    const notes = melodyNotesBetween(0, 1800, 8, 110);
    for (let i = 1; i < notes.length; i++) expect(notes[i].time).toBeGreaterThan(notes[i - 1].time);
    for (let slot = 0; slot < 400; slot++) {
      const note = melodyNoteAt(slot, 8, 110);
      if (!note) continue;
      expect(note.time).toBeGreaterThanOrEqual(slot * MELODY_SLOT_SEC);
      expect(note.time).toBeLessThan((slot + 1) * MELODY_SLOT_SEC);
    }
  });

  it('a different root moves the pitches, not the timing', () => {
    const low = melodyNotesBetween(0, 600, 4, 98);
    const high = melodyNotesBetween(0, 600, 4, 147);
    expect(high.map((n) => n.time)).toEqual(low.map((n) => n.time));
    expect(high.map((n) => n.frequency)).not.toEqual(low.map((n) => n.frequency));
  });
});
