import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { DEFAULT_INTERVALS } from '../programs/intervals';
import { defaultProgram } from '../programs/types';
import { resolveSessionProgram } from './resolveSessionProgram';

const saved = defaultProgram('flow', 0.5);

describe('resolveSessionProgram', () => {
  it('a saved program beats an interval plan', () => {
    const r = resolveSessionProgram({
      programs: [saved],
      selectedProgramId: saved.id,
      intervals: DEFAULT_INTERVALS,
      state: 'focus',
      intensity: 0.5,
    });
    expect(r).toEqual({ program: saved, generated: false });
  });

  it('generates an interval program for interval states only', () => {
    const r = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: DEFAULT_INTERVALS,
      state: 'focus',
      intensity: 0.5,
    });
    expect(r.generated).toBe(true);
    expect(r.program?.segments.length).toBe(7);
    const none = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: DEFAULT_INTERVALS,
      state: 'sleep',
      intensity: 0.5,
    });
    expect(none.program).toBeUndefined();
  });

  it('bases the generated program on the preset profile', () => {
    const profile = STATES.focus.buildProfile(0.5);
    profile.noise.type = 'blue';
    const r = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: DEFAULT_INTERVALS,
      state: 'focus',
      intensity: 0.5,
      presetProfile: profile,
    });
    expect(r.program?.baseProfile.noise.type).toBe('blue');
  });

  it('nothing selected means no program', () => {
    expect(
      resolveSessionProgram({
        programs: [saved],
        selectedProgramId: undefined,
        intervals: null,
        state: 'focus',
        intensity: 0.5,
      }),
    ).toEqual({ program: undefined, generated: false });
  });
});
