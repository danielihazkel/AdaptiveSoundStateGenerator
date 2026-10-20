// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProgram } from '../programs/types';
import { loadPrograms, loadRoutines } from '../storage/storage';
import { importSharePayload } from './importShare';

beforeEach(() => localStorage.clear());

function deps() {
  return {
    refreshPrograms: vi.fn(),
    refreshPresets: vi.fn(),
    selectProgram: vi.fn(),
    selectState: vi.fn(),
    selectPreset: vi.fn(),
    refreshRoutines: vi.fn(),
  };
}

describe('importSharePayload: routines with programs (Phase 17)', () => {
  it('saves the travelling programs under new ids and points the legs at them', () => {
    const program = { ...defaultProgram('relax', 0.3), id: 'their-id', name: 'Unwind' };
    const d = deps();
    importSharePayload(
      {
        v: 1,
        kind: 'routine',
        routine: {
          id: 'r',
          name: 'Shared',
          createdAt: '2026-10-19T08:00:00.000Z',
          legs: [
            { state: 'focus', intensity: 0.5, minutes: 25 },
            { state: 'relax', intensity: 0.3, minutes: 10, programId: 'their-id' },
          ],
        },
        programs: [program],
      },
      d,
    );
    const [saved] = loadPrograms();
    expect(saved.name).toBe('Unwind');
    expect(saved.id).not.toBe('their-id');
    const [routine] = loadRoutines();
    expect(routine.legs[1].programId).toBe(saved.id);
    expect(routine.legs[0].programId).toBeUndefined();
    expect(d.refreshPrograms).toHaveBeenCalled();
    expect(d.refreshRoutines).toHaveBeenCalled();
  });
});
