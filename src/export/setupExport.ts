import type { MentalState } from '../audio/states';
import { cloneProfile, normalizeProfile } from '../audio/types';
import { chooseProfile } from '../personalization/personalizer';
import { programMinDurationSec, type Program } from '../programs/types';
import type { Preset } from '../storage/types';
import type { ExportSelection } from './offlineRenderer';

export interface SetupExportInput {
  programs: readonly Program[];
  presets: readonly Preset[];
  selectedProgramId: string | undefined;
  selectedPresetId: string | undefined;
  state: MentalState;
  intensity: number;
  minutes: number;
  chimeEnabled: boolean;
}

/**
 * The sound the setup screen's Download button exports — same precedence as
 * beginning a session (program > preset > personalized), but served
 * deterministically ('locked' = best known arm): a download must not create a
 * session record or feed the bandit, and re-downloading should yield the same
 * sound. Programs get at least their closed phases' duration, like sessions.
 */
export function resolveSetupExport(input: SetupExportInput): {
  sel: ExportSelection;
  label: string;
} {
  const program = input.programs.find((p) => p.id === input.selectedProgramId);
  const preset = program
    ? undefined
    : input.presets.find((p) => p.id === input.selectedPresetId && p.state === input.state);
  const chimeEnabled = input.chimeEnabled;
  if (program) {
    return {
      sel: {
        profile: normalizeProfile(program.baseProfile),
        state: program.baseState,
        durationSec: Math.max(input.minutes * 60, programMinDurationSec(program)),
        program,
        chimeEnabled,
      },
      label: program.name,
    };
  }
  if (preset) {
    return {
      sel: {
        profile: cloneProfile(preset.profile),
        state: input.state,
        durationSec: input.minutes * 60,
        program: null,
        chimeEnabled,
      },
      label: preset.name,
    };
  }
  const served = chooseProfile(input.state, input.intensity, 'locked');
  return {
    sel: {
      profile: served.profile,
      state: input.state,
      durationSec: input.minutes * 60,
      program: null,
      chimeEnabled,
    },
    label: input.state,
  };
}
