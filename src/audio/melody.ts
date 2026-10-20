/**
 * Generative melody (Phase 17): where the notes fall, as a pure function of
 * absolute session time. Time is cut into MELODY_SLOT_SEC slots; each slot
 * holds a note with probability density × slot / 60, its pitch, timing
 * nudge and velocity drawn from a fixed integer hash of the slot index — no
 * running random state. So the live engine, an export, and both sides of an
 * export chunk seam (where two engines render the same seconds) all agree on
 * every note, with nothing to hand over.
 */
export const MELODY_SLOT_SEC = 0.5;
/** Notes land up to this far after their slot's start (a human, unquantized feel). */
const MAX_NUDGE_SEC = 0.2;
/** Fixed seed: the melody is a property of the moment, not of the render. */
const MELODY_SEED = 0x5eed1e;
/** Major pentatonic — no two notes clash, whatever lands next to what. */
const PENTATONIC = [0, 2, 4, 7, 9] as const;
/** Notes sit an octave or two above the pad's root, inside this band. */
export const MELODY_MIN_HZ = 180;
export const MELODY_MAX_HZ = 1800;

export interface MelodyNote {
  /** Absolute session seconds. */
  time: number;
  frequency: number;
  /** 0.6..1 — the pluck's strength. */
  velocity: number;
}

/** lowbias32 (Chris Wellons): a well-mixed 32-bit integer hash. */
function hash32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A uniform [0, 1) draw for (slot, purpose). */
function unit(slot: number, salt: number): number {
  return hash32(hash32(slot + MELODY_SEED) ^ salt) / 2 ** 32;
}

/** The note in one slot, or null. `density` is notes per minute on average. */
export function melodyNoteAt(slot: number, density: number, rootHz: number): MelodyNote | null {
  const probability = (density * MELODY_SLOT_SEC) / 60;
  if (unit(slot, 1) >= probability) return null;
  // Two octaves of the scale above root × 2, folded into the band.
  const step = Math.floor(unit(slot, 2) * PENTATONIC.length * 2);
  const semitones = PENTATONIC[step % PENTATONIC.length] + 12 * Math.floor(step / PENTATONIC.length);
  let frequency = rootHz * 2 * 2 ** (semitones / 12);
  while (frequency > MELODY_MAX_HZ) frequency /= 2;
  while (frequency < MELODY_MIN_HZ) frequency *= 2;
  return {
    time: slot * MELODY_SLOT_SEC + MAX_NUDGE_SEC * unit(slot, 3),
    frequency,
    velocity: 0.6 + 0.4 * unit(slot, 4),
  };
}

/** Every note whose slot starts in [fromSec, toSec), in time order. */
export function melodyNotesBetween(
  fromSec: number,
  toSec: number,
  density: number,
  rootHz: number,
): MelodyNote[] {
  const notes: MelodyNote[] = [];
  for (let slot = Math.ceil(fromSec / MELODY_SLOT_SEC); slot * MELODY_SLOT_SEC < toSec; slot++) {
    const note = melodyNoteAt(slot, density, rootHz);
    if (note) notes.push(note);
  }
  return notes;
}
