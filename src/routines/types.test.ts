import { describe, expect, it } from 'vitest';
import { ROUTINE_TEMPLATES, routineFromTemplate } from './templates';
import {
  describeRoutine,
  legsWithMissingProgram,
  MAX_LEG_MINUTES,
  MAX_ROUTINE_LEGS,
  normalizeRoutine,
  routineDestination,
  routineMinutes,
  routineProgramIds,
} from './types';

describe('normalizeRoutine', () => {
  it('keeps a valid routine as it is', () => {
    const routine = {
      id: 'r1',
      name: 'Mine',
      createdAt: '2026-10-19T08:00:00.000Z',
      legs: [
        { state: 'energy', intensity: 0.5, minutes: 10 },
        { state: 'focus', intensity: 0.6, minutes: 50 },
      ],
    };
    expect(normalizeRoutine(routine)).toEqual(routine);
  });

  it('drops invalid legs, clamps values, trims extras, fills defaults', () => {
    const r = normalizeRoutine({
      name: '   ',
      legs: [
        { state: 'focus', intensity: 3, minutes: 9999 },
        { state: 'lava', intensity: 0.5, minutes: 10 },
        { state: 'calm', intensity: 'x', minutes: 0.2 },
        ...Array.from({ length: 6 }, () => ({ state: 'relax', intensity: 0.5, minutes: 5 })),
      ],
    })!;
    expect(r.name).toBe('My routine');
    expect(r.id).toMatch(/^routine-/);
    expect(r.legs).toHaveLength(MAX_ROUTINE_LEGS);
    expect(r.legs[0]).toEqual({ state: 'focus', intensity: 1, minutes: MAX_LEG_MINUTES });
    expect(r.legs[1]).toEqual({ state: 'calm', intensity: 0.5, minutes: 1 });
  });

  it('refuses anything with fewer than two valid legs', () => {
    expect(normalizeRoutine(null)).toBeNull();
    expect(normalizeRoutine({ legs: [{ state: 'focus', intensity: 0.5, minutes: 10 }] })).toBeNull();
    expect(normalizeRoutine({ legs: 'nope' })).toBeNull();
  });
});

describe('routine templates', () => {
  it('are all valid routines', () => {
    for (const template of ROUTINE_TEMPLATES) {
      const routine = routineFromTemplate(template);
      expect(normalizeRoutine(routine)).toEqual(routine);
    }
  });

  it('describe themselves compactly', () => {
    const kickoff = routineFromTemplate(ROUTINE_TEMPLATES[0]);
    expect(routineMinutes(kickoff)).toBe(60);
    expect(describeRoutine(kickoff)).toMatch(/^\S+ 10 → \S+ 50$/u);
  });
});

describe('program legs (Phase 17)', () => {
  const routine = {
    legs: [
      { state: 'focus' as const, intensity: 0.5, minutes: 25, programId: 'p1' },
      { state: 'relax' as const, intensity: 0.4, minutes: 5 },
      { state: 'sleep' as const, intensity: 0.4, minutes: 30, programId: 'p1' },
    ],
  };

  it('keeps a leg’s program reference through normalization, drops junk', () => {
    const r = normalizeRoutine({
      name: 'x',
      legs: [...routine.legs, { state: 'calm', intensity: 0.5, minutes: 5, programId: 42 }],
    })!;
    expect(r.legs.map((l) => l.programId)).toEqual(['p1', undefined, 'p1', undefined]);
    expect('programId' in r.legs[3]).toBe(false);
  });

  it('lists the programs a routine uses and the legs whose program is gone', () => {
    expect(routineProgramIds(routine)).toEqual(['p1']);
    expect(legsWithMissingProgram(routine, new Set(['p1']))).toEqual([]);
    expect(legsWithMissingProgram(routine, new Set())).toEqual([1, 3]);
    expect(describeRoutine(routine)).toContain('📋');
  });
});

describe('routineDestination (Phase 17)', () => {
  it('is the last leg’s state, or its program’s base state', () => {
    const legs = [
      { state: 'energy' as const, intensity: 0.5, minutes: 10 },
      { state: 'focus' as const, intensity: 0.5, minutes: 10, programId: 'p' },
    ];
    expect(routineDestination({ legs }, [])).toBe('focus');
    expect(routineDestination({ legs }, [{ id: 'p', baseState: 'relax' }])).toBe('relax');
  });
});
