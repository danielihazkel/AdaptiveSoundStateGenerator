import { describe, expect, it } from 'vitest';
import {
  BREATH_PATTERNS,
  breathEnvelopeAt,
  breathPhaseAt,
  isBreathingPatternId,
  levelBeforePhase,
  patternPeriodSec,
  pulseDerivedPattern,
} from './breathing';

const box = BREATH_PATTERNS.box;
const r478 = BREATH_PATTERNS.relax478;

describe('breath patterns', () => {
  it('periods sum the phases', () => {
    expect(patternPeriodSec(box)).toBe(16);
    expect(patternPeriodSec(r478)).toBe(19);
    expect(patternPeriodSec(BREATH_PATTERNS.coherent)).toBe(11);
  });

  it('derives a symmetric pattern from a pulse rate', () => {
    const p = pulseDerivedPattern(0.1);
    expect(p.phases).toEqual([
      { label: 'in', seconds: 5 },
      { label: 'out', seconds: 5 },
    ]);
    expect(p.id).toBe('pulse');
  });

  it('validates ids', () => {
    expect(isBreathingPatternId('box')).toBe(true);
    expect(isBreathingPatternId('pulse')).toBe(true);
    expect(isBreathingPatternId('nope')).toBe(false);
    expect(isBreathingPatternId(3)).toBe(false);
  });
});

describe('breathPhaseAt', () => {
  it('walks the phases and counts down', () => {
    expect(breathPhaseAt(box, 0)).toMatchObject({ index: 0, label: 'in', remainingSec: 4 });
    expect(breathPhaseAt(box, 5)).toMatchObject({ index: 1, label: 'hold', remainingSec: 3 });
    expect(breathPhaseAt(box, 9.5)).toMatchObject({ index: 2, label: 'out', remainingSec: 2.5 });
    expect(breathPhaseAt(box, 15.9).label).toBe('hold');
  });

  it('wraps whole cycles and negative time', () => {
    expect(breathPhaseAt(box, 16)).toMatchObject({ index: 0, cycleElapsedSec: 0 });
    expect(breathPhaseAt(box, 37)).toMatchObject({ index: 1, phaseElapsedSec: 1 });
    expect(breathPhaseAt(box, -1)).toMatchObject({ index: 3, remainingSec: 1 });
  });
});

describe('breathEnvelopeAt', () => {
  it('rises on the inhale, holds full, falls on the exhale, holds empty', () => {
    expect(breathEnvelopeAt(box, 0)).toBe(0);
    expect(breathEnvelopeAt(box, 2)).toBeCloseTo(0.5);
    expect(breathEnvelopeAt(box, 4)).toBeCloseTo(1);
    expect(breathEnvelopeAt(box, 6)).toBe(1);
    expect(breathEnvelopeAt(box, 8)).toBeCloseTo(1);
    expect(breathEnvelopeAt(box, 10)).toBeCloseTo(0.5);
    expect(breathEnvelopeAt(box, 12)).toBeCloseTo(0);
    expect(breathEnvelopeAt(box, 14)).toBe(0);
  });

  it('is continuous at every phase boundary', () => {
    for (const pattern of [box, r478, BREATH_PATTERNS.coherent]) {
      let t = 0;
      for (const phase of pattern.phases) {
        t += phase.seconds;
        const before = breathEnvelopeAt(pattern, t - 1e-6);
        const after = breathEnvelopeAt(pattern, t + 1e-6);
        expect(Math.abs(before - after)).toBeLessThan(1e-3);
      }
    }
  });

  it('a hold after an exhale stays empty (4-7-8 wraps to the inhale)', () => {
    expect(levelBeforePhase(r478, 1)).toBe(1); // hold after in
    expect(breathEnvelopeAt(r478, 18.99)).toBeCloseTo(0, 3);
    expect(breathEnvelopeAt(r478, 19)).toBe(0);
  });
});
