import { describe, expect, it } from 'vitest';
import {
  gainToDb,
  MASKING_DEFAULTS,
  roomExcessDb,
  stepMaskingGain,
  targetMaskingGain,
  type RoomReading,
} from './masking';
import { MAX_MASKING_BOOST } from './mixPolicy';

const T0 = 1_000_000;

/** 1 Hz readings: `db(sec)` for `seconds`. */
function readings(seconds: number, db: (sec: number) => number): RoomReading[] {
  return Array.from({ length: seconds }, (_, i) => ({ timestamp: T0 + (i + 1) * 1000, db: db(i) }));
}

const at = (r: RoomReading[]) => r[r.length - 1].timestamp;

describe('roomExcessDb', () => {
  it('waits for a first-minute baseline, then reports how much louder the room is', () => {
    expect(roomExcessDb(readings(30, () => -50), T0 + 30_000)).toBeNull();
    const cafe = readings(120, (s) => (s < 60 ? -50 : -38));
    expect(roomExcessDb(cafe, at(cafe))).toBeCloseTo(12, 6);
  });

  it("subtracts the app's own boost so masking can't ratchet itself up", () => {
    const r = readings(120, (s) => (s < 60 ? -50 : -47));
    expect(roomExcessDb(r, at(r), 3)).toBeCloseTo(0, 6);
  });

  it('a single loud second (a cough, a door) barely moves the median', () => {
    const r = readings(120, (s) => (s === 115 ? -10 : -50));
    expect(roomExcessDb(r, at(r))).toBeCloseTo(0, 6);
  });
});

describe('targetMaskingGain', () => {
  it('nothing inside the deadband, the full cap by fullBoostAtDb, never more', () => {
    expect(targetMaskingGain(null)).toBe(1);
    expect(targetMaskingGain(MASKING_DEFAULTS.deadbandDb)).toBe(1);
    expect(targetMaskingGain(-10)).toBe(1);
    expect(targetMaskingGain(MASKING_DEFAULTS.fullBoostAtDb)).toBeCloseTo(MAX_MASKING_BOOST, 12);
    expect(targetMaskingGain(60)).toBeCloseTo(MAX_MASKING_BOOST, 12);
    const mid = (MASKING_DEFAULTS.deadbandDb + MASKING_DEFAULTS.fullBoostAtDb) / 2;
    expect(gainToDb(targetMaskingGain(mid))).toBeCloseTo(1.5, 6);
  });
});

describe('stepMaskingGain', () => {
  it('rises over about a minute and settles back faster, inside [1, cap]', () => {
    let g = 1;
    for (let s = 0; s < 60; s++) g = stepMaskingGain(g, MAX_MASKING_BOOST, 1);
    // One attack time constant: ~63 % of the way up.
    expect(g).toBeGreaterThan(1 + 0.6 * (MAX_MASKING_BOOST - 1));
    expect(g).toBeLessThan(1 + 0.66 * (MAX_MASKING_BOOST - 1));
    for (let s = 0; s < 20; s++) g = stepMaskingGain(g, 1, 1);
    expect(g).toBeLessThan(1 + 0.25 * (MAX_MASKING_BOOST - 1));
    expect(stepMaskingGain(1, 9, 1e6)).toBe(MAX_MASKING_BOOST);
    expect(stepMaskingGain(1.2, 0, 1e6)).toBe(1);
  });
});
