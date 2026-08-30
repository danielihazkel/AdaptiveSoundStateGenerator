import type { MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { buildIntervalProgram, INTERVAL_STATES, type IntervalPlan } from '../programs/intervals';
import type { Program } from '../programs/types';

/**
 * Which program (if any) the next session or download runs: a saved program
 * wins; otherwise an interval plan generates one on the fly. Shared by Begin
 * and Download so both play the same thing.
 */
export function resolveSessionProgram(input: {
  programs: readonly Program[];
  selectedProgramId: string | undefined;
  intervals: IntervalPlan | null;
  state: MentalState;
  intensity: number;
  /** The selected preset's profile, used as the interval program's base sound. */
  presetProfile?: SoundProfile;
}): { program: Program | undefined; generated: boolean } {
  const saved = input.programs.find((p) => p.id === input.selectedProgramId);
  if (saved) return { program: saved, generated: false };
  if (input.intervals && INTERVAL_STATES.has(input.state)) {
    return {
      program: buildIntervalProgram(input.state, input.intensity, input.intervals, input.presetProfile),
      generated: true,
    };
  }
  return { program: undefined, generated: false };
}
