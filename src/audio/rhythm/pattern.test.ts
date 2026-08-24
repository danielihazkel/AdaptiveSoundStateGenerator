import { describe, expect, it } from 'vitest';
import {
  BEATS_PER_BAR,
  MAX_PULSE_WEIGHT,
  buildBar,
  pulseWidthFraction,
} from './pattern';

describe('buildBar', () => {
  it('is four equal quarter notes at complexity 0 (legacy steady feel)', () => {
    const bar = buildBar(0);
    expect(bar).toEqual([
      { atBeat: 0, weight: 1 },
      { atBeat: 1, weight: 1 },
      { atBeat: 2, weight: 1 },
      { atBeat: 3, weight: 1 },
    ]);
  });

  it('keeps every pulse inside the bar with weights in (0, MAX_PULSE_WEIGHT]', () => {
    for (let c = 0; c <= 1; c += 0.05) {
      for (const event of buildBar(c)) {
        expect(event.atBeat).toBeGreaterThanOrEqual(0);
        expect(event.atBeat).toBeLessThan(BEATS_PER_BAR);
        expect(event.weight).toBeGreaterThan(0);
        expect(event.weight).toBeLessThanOrEqual(MAX_PULSE_WEIGHT);
      }
    }
  });

  it('returns pulses sorted by beat offset', () => {
    for (const c of [0, 0.3, 0.7, 1]) {
      const beats = buildBar(c).map((e) => e.atBeat);
      expect(beats).toEqual([...beats].sort((a, b) => a - b));
    }
  });

  it('has no 8th subdivisions at low complexity and no 16ths below 0.6', () => {
    expect(buildBar(0.2).every((e) => Number.isInteger(e.atBeat))).toBe(true);
    const mid = buildBar(0.5);
    expect(mid.some((e) => e.atBeat % 0.5 === 0 && !Number.isInteger(e.atBeat))).toBe(true);
    expect(mid.some((e) => e.atBeat % 0.5 !== 0)).toBe(false);
    expect(buildBar(0.9).some((e) => e.atBeat % 0.5 !== 0)).toBe(true);
  });

  it('is continuous in complexity — no discrete pattern jumps', () => {
    // Sample each grid position's weight over a dense complexity grid; the
    // step delta must stay small or a slow complexity ramp would glitch.
    const positions = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.25, 3.5, 3.75];
    const step = 0.01;
    const weightAt = (c: number, atBeat: number) =>
      buildBar(c).find((e) => e.atBeat === atBeat)?.weight ?? 0;
    for (const atBeat of positions) {
      let prev = weightAt(0, atBeat);
      for (let c = step; c <= 1.000001; c += step) {
        const next = weightAt(c, atBeat);
        expect(Math.abs(next - prev)).toBeLessThan(0.03);
        prev = next;
      }
    }
  });
});

describe('pulseWidthFraction', () => {
  it('narrows monotonically from soft to articulate within (0, 1)', () => {
    let prev = pulseWidthFraction(0);
    expect(prev).toBeCloseTo(0.9);
    for (let c = 0.05; c <= 1; c += 0.05) {
      const w = pulseWidthFraction(c);
      expect(w).toBeLessThanOrEqual(prev);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(1);
      prev = w;
    }
    expect(pulseWidthFraction(1)).toBeCloseTo(0.4);
  });
});
