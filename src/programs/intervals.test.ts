import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import {
  buildIntervalProgram,
  DEFAULT_INTERVALS,
  intervalTotalSec,
  normalizeIntervalPlan,
} from './intervals';
import { normalizeProgram, programMinDurationSec } from './types';

describe('intervals', () => {
  it('totals work blocks plus the breaks between them', () => {
    expect(intervalTotalSec(DEFAULT_INTERVALS)).toBe((4 * 25 + 3 * 5) * 60);
    expect(intervalTotalSec({ workMin: 50, breakMin: 10, cycles: 1, boundaryChime: false })).toBe(
      50 * 60,
    );
  });

  it('normalizes and clamps a plan', () => {
    expect(normalizeIntervalPlan(null)).toEqual(DEFAULT_INTERVALS);
    expect(normalizeIntervalPlan({ workMin: 500, breakMin: 0, cycles: 0.4 })).toEqual({
      workMin: 90,
      breakMin: 1,
      cycles: 1,
      boundaryChime: true,
    });
    expect(normalizeIntervalPlan({ boundaryChime: false }).boundaryChime).toBe(false);
  });

  it('builds alternating work/break phases with a closed final block', () => {
    const program = buildIntervalProgram('focus', 0.5, DEFAULT_INTERVALS);
    expect(program.segments.map((s) => s.label)).toEqual([
      'Work 1',
      'Break',
      'Work 2',
      'Break',
      'Work 3',
      'Break',
      'Work 4',
    ]);
    expect(program.segments[program.segments.length - 1].endMin).toBe(115);
    expect(programMinDurationSec(program)).toBe(intervalTotalSec(DEFAULT_INTERVALS));
    expect(program.boundaryChime).toBe(true);
    expect(program.name).toBe('Intervals 25/5 ×4');
    expect(program.baseState).toBe('focus');
  });

  it('is already normalized (contiguous, clamped) and carries no open tail', () => {
    const program = buildIntervalProgram('flow', 0.8, { ...DEFAULT_INTERVALS, cycles: 2 });
    expect(normalizeProgram(program)).toEqual(program);
    expect(program.segments.every((s) => s.endMin !== null)).toBe(true);
  });

  it('breaks are softer than work', () => {
    const program = buildIntervalProgram('focus', 0.5, DEFAULT_INTERVALS);
    const [work, brk] = program.segments;
    expect(brk.intensity).toBeLessThan(work.intensity);
    expect(brk.bpmRange[1]).toBeLessThan(work.bpmRange[0]);
    expect(brk.ambienceScale).toBeGreaterThan(1);
  });

  it('uses a supplied preset profile as the base sound, with the pulse enabled', () => {
    const preset = STATES.focus.buildProfile(0.3);
    preset.noise.type = 'brown';
    preset.isochronic.enabled = false;
    const program = buildIntervalProgram('focus', 0.3, DEFAULT_INTERVALS, preset);
    expect(program.baseProfile.noise.type).toBe('brown');
    expect(program.baseProfile.isochronic.enabled).toBe(true);
    expect(preset.isochronic.enabled).toBe(false); // input untouched
  });

  it('omits boundaryChime when off', () => {
    const program = buildIntervalProgram('focus', 0.5, { ...DEFAULT_INTERVALS, boundaryChime: false });
    expect(program.boundaryChime).toBeUndefined();
  });
});
