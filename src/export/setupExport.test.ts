import { beforeEach, describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { defaultProgram, programMinDurationSec } from '../programs/types';
import { newId } from '../storage/storage';
import type { Preset } from '../storage/types';
import { resolveSetupExport, type SetupExportInput } from './setupExport';

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

const preset: Preset = {
  id: newId(),
  name: 'Evening focus',
  createdAt: new Date().toISOString(),
  state: 'focus',
  intensity: 0.7,
  profile: STATES.focus.buildProfile(0.7),
};
const program = { ...defaultProgram('relax', 0.4), id: newId(), name: 'Wind down' };

function input(overrides: Partial<SetupExportInput> = {}): SetupExportInput {
  return {
    programs: [program],
    presets: [preset],
    selectedProgramId: undefined,
    selectedPresetId: undefined,
    state: 'focus',
    intensity: 0.5,
    minutes: 30,
    chimeEnabled: true,
    ...overrides,
  };
}

describe('resolveSetupExport', () => {
  it('a selected program wins, uses its base state, and floors the duration', () => {
    const { sel, label } = resolveSetupExport(
      input({ selectedProgramId: program.id, selectedPresetId: preset.id, minutes: 1 }),
    );
    expect(label).toBe('Wind down');
    expect(sel.program).toBe(program);
    expect(sel.state).toBe('relax');
    expect(sel.durationSec).toBe(programMinDurationSec(program));

    const longer = resolveSetupExport(input({ selectedProgramId: program.id, minutes: 90 }));
    expect(longer.sel.durationSec).toBe(90 * 60);
  });

  it('a selected preset of the current state exports its exact profile', () => {
    const { sel, label } = resolveSetupExport(input({ selectedPresetId: preset.id }));
    expect(label).toBe('Evening focus');
    expect(sel.program).toBeNull();
    expect(sel.profile).toEqual(preset.profile);
    expect(sel.profile).not.toBe(preset.profile); // a copy, never the stored object
    expect(sel.durationSec).toBe(30 * 60);
  });

  it('a preset from another state is ignored', () => {
    const { label } = resolveSetupExport(input({ selectedPresetId: preset.id, state: 'relax' }));
    expect(label).toBe('relax');
  });

  it('otherwise serves the personalized sound deterministically', () => {
    const a = resolveSetupExport(input());
    const b = resolveSetupExport(input());
    expect(a.label).toBe('focus');
    expect(a.sel.profile).toEqual(b.sel.profile);
    expect(a.sel.chimeEnabled).toBe(true);
  });
});
