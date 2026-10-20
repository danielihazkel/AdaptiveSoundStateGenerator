import { beforeEach, describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { defaultProgram, programMinDurationSec } from '../programs/types';
import type { Routine } from '../routines/types';
import { resolveRoutineExport } from './routineExport';
import { exportTags } from './tagExport';

// Node has no localStorage — the personalizer reads its posterior from it.
function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

const program = { ...defaultProgram('relax', 0.4), id: 'p1', name: 'Unwind' };

const routine: Routine = {
  id: 'r1',
  name: 'Evening',
  createdAt: '2026-10-19T08:00:00.000Z',
  legs: [
    { state: 'focus', intensity: 0.6, minutes: 25 },
    { state: 'relax', intensity: 0.4, minutes: 1, programId: 'p1' },
    { state: 'sleep', intensity: 0.5, minutes: 30 },
  ],
};

describe('resolveRoutineExport (Phase 17)', () => {
  it('resolves every leg the way a live run would — programs, breathing, wake-up on the last only', () => {
    const { sel, label } = resolveRoutineExport(routine, {
      programs: [program],
      chimeEnabled: true,
      breathingPattern: 'box',
      wakeUp: { enabled: true, riseMinutes: 10 },
    });
    expect(label).toBe('Evening');
    const legs = sel.legs!;
    expect(legs.map((l) => l.state)).toEqual(['focus', 'relax', 'sleep']);
    // The program leg plays its program, at least its closed phases.
    expect(legs[1].program).toBe(program);
    expect(legs[1].durationSec).toBe(Math.max(60, programMinDurationSec(program)));
    // Only the last plain leg ends in a wake-up rise.
    expect(legs[0].wakeUp).toBeNull();
    expect(legs[2].wakeUp).toEqual({ riseSec: 600 });
    // The first leg's volume carries through.
    expect(new Set(legs.map((l) => l.profile.masterVolume)).size).toBe(1);
    // The whole: last leg owns the ending, durations add up.
    expect(sel).toMatchObject({ state: 'sleep', program: null, wakeUp: { riseSec: 600 } });
    expect(sel.durationSec).toBe(legs.reduce((acc, l) => acc + l.durationSec, 0));
    expect(sel.profile).toBe(legs[0].profile);
  });

  it('a deleted program leg exports a served sound of the leg’s state', () => {
    const { sel } = resolveRoutineExport(routine, { programs: [], chimeEnabled: false });
    expect(sel.legs![1]).toMatchObject({ state: 'relax', program: null, durationSec: 60 });
    expect(sel.legs![1].profile.noise).toEqual(STATES.relax.buildProfile(0.4).noise);
  });

  it('tags the file as a routine, listing the parts', () => {
    const { sel, label } = resolveRoutineExport(routine, { programs: [program], chimeEnabled: false });
    const tags = exportTags(sel, label);
    expect(tags).toMatchObject({ title: 'Evening', album: 'Routine', artist: 'Resonance' });
    expect(tags.comment).toMatch(/Focus 25 min → Relax \d+ min → Sleep 30 min/);
  });
});
