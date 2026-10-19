import { describe, expect, it } from 'vitest';
import { ROUTINE_TEMPLATES, routineFromTemplate } from './templates';
import {
  describeRoutine,
  MAX_LEG_MINUTES,
  MAX_ROUTINE_LEGS,
  normalizeRoutine,
  routineMinutes,
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
