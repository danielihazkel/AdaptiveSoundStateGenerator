import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { DEFAULT_INTERVALS } from '../programs/intervals';
import { defaultProgram } from '../programs/types';
import { resolveSessionProgram } from './resolveSessionProgram';
import type { SessionRecord } from '../storage/types';

function intervalRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const profile = { ...STATES.focus.buildProfile(0.5), noise: { ...STATES.focus.buildProfile(0.5).noise, type: 'brown' as const } };
  return {
    id: 'r1',
    startedAt: '2026-01-01T00:00:00.000Z',
    state: 'focus',
    intensity: 0.5,
    plannedDurationSec: 25 * 60 * 4 + 5 * 60 * 3,
    actualDurationSec: 25 * 60 * 4 + 5 * 60 * 3,
    completed: true,
    customized: false,
    profile,
    monoMode: false,
    intervals: { workMin: 25, breakMin: 5, cycles: 4, boundaryChime: true },
    ...overrides,
  } as SessionRecord;
}

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
    expect(r).toEqual({ program: saved, generated: false, intervals: null, fromReplay: false });
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
      baseProfile: profile,
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
    ).toEqual({ program: undefined, generated: false, intervals: null, fromReplay: false });
  });

  it('rebuilds a replayed interval session on the sound that played', () => {
    const record = intervalRecord();
    const r = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: null,
      state: 'focus',
      intensity: 0.5,
      replay: record,
    });
    expect(r.generated).toBe(true);
    expect(r.fromReplay).toBe(true);
    expect(r.intervals).toEqual(record.intervals);
    expect(r.program?.segments.length).toBe(7);
    expect(r.program?.baseProfile.noise.type).toBe('brown');
  });

  it('keeps the replayed sound under a plan the user changed since', () => {
    const record = intervalRecord();
    const plan = { workMin: 50, breakMin: 10, cycles: 2, boundaryChime: false };
    const r = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: plan,
      state: 'focus',
      intensity: 0.5,
      replay: record,
    });
    expect(r.fromReplay).toBe(true);
    expect(r.intervals).toEqual(plan);
    expect(r.program?.segments.length).toBe(3);
    expect(r.program?.baseProfile.noise.type).toBe('brown');
  });

  it('normalizes a stale stored plan and ignores replays without intervals', () => {
    const stale = intervalRecord({ intervals: { workMin: 999, breakMin: -3, cycles: 0 } as never });
    const r = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: null,
      state: 'focus',
      intensity: 0.5,
      replay: stale,
    });
    expect(r.fromReplay).toBe(true);
    expect(r.intervals?.cycles).toBeGreaterThanOrEqual(1);
    expect(r.intervals?.breakMin).toBeGreaterThanOrEqual(1);
    const plain = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: null,
      state: 'focus',
      intensity: 0.5,
      replay: intervalRecord({ intervals: undefined }),
    });
    expect(plain).toEqual({ program: undefined, generated: false, intervals: null, fromReplay: false });
  });

  it('a chosen preset overrides the replayed sound', () => {
    const preset = STATES.focus.buildProfile(0.9);
    const r = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: DEFAULT_INTERVALS,
      state: 'focus',
      intensity: 0.5,
      baseProfile: preset,
      replay: intervalRecord(),
    });
    expect(r.fromReplay).toBe(false);
    expect(r.program?.baseProfile).toEqual(preset);
  });

  it('builds a generated interval program on whatever base sound it is given', () => {
    const served = { ...STATES.focus.buildProfile(0.5), noise: { ...STATES.focus.buildProfile(0.5).noise, type: 'blue' as const } };
    const r = resolveSessionProgram({
      programs: [],
      selectedProgramId: undefined,
      intervals: DEFAULT_INTERVALS,
      state: 'focus',
      intensity: 0.5,
      baseProfile: served,
    });
    expect(r.generated).toBe(true);
    expect(r.fromReplay).toBe(false);
    expect(r.program?.baseProfile.noise.type).toBe('blue');
  });
});
