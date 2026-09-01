import type { MentalState } from '../audio/states';
import type { Program } from '../programs/types';
import type { SharePayload } from '../share/shareLink';
import { newId, savePreset, saveProgram } from '../storage/storage';
import type { Preset } from '../storage/types';

/**
 * Store a validated share payload (from a link or a saved share file) and
 * select it, so both entry points behave identically.
 */
export function importSharePayload(
  payload: SharePayload,
  deps: {
    refreshPrograms: () => void;
    refreshPresets: () => void;
    selectProgram: (program: Program) => void;
    selectState: (state: MentalState) => void;
    selectPreset: (preset: Preset) => void;
  },
): void {
  const now = new Date().toISOString();
  if (payload.kind === 'program') {
    const program: Program = { ...payload.program, id: newId(), createdAt: now };
    saveProgram(program);
    deps.refreshPrograms();
    deps.selectProgram(program);
  } else {
    const preset: Preset = { id: newId(), createdAt: now, ...payload.preset };
    savePreset(preset);
    deps.refreshPresets();
    deps.selectState(preset.state);
    deps.selectPreset(preset);
  }
}
