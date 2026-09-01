import { describe, expect, it } from 'vitest';
import {
  alignmentDelays,
  frac,
  OscillatorPhaseTracker,
  ParamTimeline,
  solveStartDelay,
} from './phaseTracker';

describe('ParamTimeline', () => {
  it('follows setTargetAtTime: exponential approach from the value at the set time', () => {
    const p = new ParamTimeline(100);
    p.set(1, 200, 0.5);
    expect(p.valueAt(0.5)).toBe(100);
    expect(p.valueAt(1)).toBe(100);
    expect(p.valueAt(1.5)).toBeCloseTo(200 - 100 * Math.exp(-1), 9);
    // A second target starts from wherever the first had got to.
    p.set(1.5, 50, 0.1);
    const at15 = 200 - 100 * Math.exp(-1);
    expect(p.valueAt(1.5)).toBeCloseTo(at15, 9);
    expect(p.valueAt(1.6)).toBeCloseTo(50 + (at15 - 50) * Math.exp(-1), 9);
  });
});

describe('OscillatorPhaseTracker', () => {
  it('a constant frequency accumulates f·t cycles', () => {
    const tr = new OscillatorPhaseTracker(220);
    expect(tr.cyclesAt(1)).toBeCloseTo(220, 6);
    expect(tr.cyclesAt(12.5)).toBeCloseTo(2750, 6);
  });

  it('integrates a ramp exactly (closed form: Δ·target + (from−target)·τ·(1−e^(−Δ/τ)))', () => {
    const tr = new OscillatorPhaseTracker(200);
    tr.setFrequency(0, 210, 2);
    const closed = 3 * 210 + (200 - 210) * 2 * (1 - Math.exp(-3 / 2));
    expect(tr.cyclesAt(3)).toBeCloseTo(closed, 6);
  });

  it('applies detune in cents multiplicatively', () => {
    const tr = new OscillatorPhaseTracker(440, 1200);
    expect(tr.hzAt(0)).toBeCloseTo(880, 9);
    expect(tr.cyclesAt(2)).toBeCloseTo(1760, 6);
  });

  it('phase counts from the delayed start only', () => {
    const tr = new OscillatorPhaseTracker(100);
    tr.start(0.0025); // a quarter period
    expect(tr.phaseAt(0.001)).toBe(0);
    expect(tr.phaseAt(1)).toBeCloseTo(100 - 0.25, 9);
  });
});

describe('solveStartDelay / alignmentDelays', () => {
  it('finds a sub-period delay that removes the requested fraction of a cycle', () => {
    const tr = new OscillatorPhaseTracker(250);
    const d = solveStartDelay(tr, 0.3);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1 / 250);
    expect(tr.cyclesAt(d)).toBeCloseTo(0.3, 8);
    expect(solveStartDelay(tr, 0)).toBe(0);
    expect(solveStartDelay(tr, 2.3)).toBeCloseTo(d, 12); // wraps
  });

  it('accounts for a ramp in flight during the delay', () => {
    const tr = new OscillatorPhaseTracker(100);
    tr.setFrequency(0, 400, 0.001); // snaps almost instantly to 400 Hz
    const d = solveStartDelay(tr, 0.5);
    expect(tr.cyclesAt(d)).toBeCloseTo(0.5, 8);
    expect(d).toBeLessThan(1 / 100);
  });

  it('lands the next chunk on the previous chunk’s phase at the seam', () => {
    // Previous chunk: 220 Hz for 900 s, oscillator started at 0.
    const prev = new OscillatorPhaseTracker(220.37);
    const seamPrev = 899; // ctx time of the alignment instant in the previous chunk
    const target = frac(prev.phaseAt(seamPrev));

    // Next chunk starts 3 s early; the seam instant is at ctx 2 s. Its
    // oscillator is built at the base frequency and snaps to the modulated one.
    const next = new OscillatorPhaseTracker(220);
    next.setFrequency(0, 220.37, 0.05);
    const [delay] = alignmentDelays([next], [target], 2);
    next.start(delay);
    expect(frac(next.phaseAt(2))).toBeCloseTo(target, 6);
    expect(delay).toBeLessThan(1 / 220);
  });
});
