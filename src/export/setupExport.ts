import { BREATH_PATTERNS, type BreathingPatternId } from '../audio/breathing';
import type { MentalState } from '../audio/states';
import { breathingFor, wakeUpFor } from '../session/sessionOptions';
import { cloneProfile, normalizeProfile } from '../audio/types';
import { chooseProfile } from '../personalization/personalizer';
import { resolveSessionProgram } from '../app/resolveSessionProgram';
import type { IntervalPlan } from '../programs/intervals';
import { programMinDurationSec, type Program } from '../programs/types';
import type { Preset, Settings } from '../storage/types';
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
  /** Interval plan (generates a program) — absent/null = none. */
  intervals?: IntervalPlan | null;
  /** Guided breathing / wake-up settings; absent = neither. */
  breathingPattern?: BreathingPatternId;
  wakeUp?: Settings['wakeUp'];
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
  const selectedPreset = input.presets.find(
    (p) => p.id === input.selectedPresetId && p.state === input.state,
  );
  const resolved = resolveSessionProgram({
    programs: input.programs,
    selectedProgramId: input.selectedProgramId,
    intervals: input.intervals ?? null,
    state: input.state,
    intensity: input.intensity,
    presetProfile: selectedPreset?.profile,
  });
  const program = resolved.program;
  const preset = program ? undefined : selectedPreset;
  const chimeEnabled = input.chimeEnabled;
  if (program) {
    return {
      sel: {
        profile: normalizeProfile(program.baseProfile),
        state: program.baseState,
        durationSec: resolved.generated
          ? programMinDurationSec(program)
          : Math.max(input.minutes * 60, programMinDurationSec(program)),
        program,
        chimeEnabled,
      },
      label: program.name,
    };
  }
  const durationSec = input.minutes * 60;
  const breathingId = breathingFor(input.state, input.breathingPattern);
  const breathing = breathingId ? BREATH_PATTERNS[breathingId] : null;
  const wakeUp = wakeUpFor(input.state, input.wakeUp, durationSec);
  if (preset) {
    return {
      sel: {
        profile: cloneProfile(preset.profile),
        state: input.state,
        durationSec,
        program: null,
        chimeEnabled,
        breathing,
        wakeUp,
      },
      label: preset.name,
    };
  }
  const served = chooseProfile(input.state, input.intensity, 'locked');
  return {
    sel: {
      profile: served.profile,
      state: input.state,
      durationSec,
      program: null,
      chimeEnabled,
      breathing,
      wakeUp,
    },
    label: input.state,
  };
}
