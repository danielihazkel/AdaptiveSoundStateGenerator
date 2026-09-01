import type { MentalState } from '../audio/states';
import { normalizeProfile, type SoundProfile } from '../audio/types';
import {
  buildIntervalProgram,
  INTERVAL_STATES,
  normalizeIntervalPlan,
  type IntervalPlan,
} from '../programs/intervals';
import type { Program } from '../programs/types';
import type { SessionRecord } from '../storage/types';

export interface ResolvedSessionProgram {
  program: Program | undefined;
  /** The program was generated from an interval plan (not a saved program). */
  generated: boolean;
  /** The interval plan a generated program ran; null otherwise. */
  intervals: IntervalPlan | null;
  /** The generated program was rebuilt from a replayed session's plan and sound. */
  fromReplay: boolean;
}

/**
 * Which program (if any) the next session or download runs: a saved program
 * wins; otherwise an interval plan generates one on the fly. Shared by Begin
 * and Download so both play the same thing.
 *
 * A replayed interval session rebuilds its program on the sound that
 * actually played (`replay.profile`), so "replay" means the same sound and
 * the same rhythm — a plan the user has since changed still wins over the
 * stored one, but keeps the replayed sound underneath it.
 */
export function resolveSessionProgram(input: {
  programs: readonly Program[];
  selectedProgramId: string | undefined;
  intervals: IntervalPlan | null;
  state: MentalState;
  intensity: number;
  /**
   * The interval program's base sound: the selected preset's profile, or the
   * profile the bandit served for this session. Absent = the state's own.
   */
  baseProfile?: SoundProfile;
  /** The history record being replayed, if any and if no preset/program overrides it. */
  replay?: SessionRecord | null;
}): ResolvedSessionProgram {
  const saved = input.programs.find((p) => p.id === input.selectedProgramId);
  if (saved) return { program: saved, generated: false, intervals: null, fromReplay: false };
  const replay = input.replay?.intervals && !input.baseProfile ? input.replay : null;
  if (replay && INTERVAL_STATES.has(replay.state)) {
    const plan = input.intervals ?? normalizeIntervalPlan(replay.intervals);
    return {
      program: buildIntervalProgram(
        replay.state,
        replay.intensity,
        plan,
        normalizeProfile(replay.profile),
      ),
      generated: true,
      intervals: plan,
      fromReplay: true,
    };
  }
  if (input.intervals && INTERVAL_STATES.has(input.state)) {
    return {
      program: buildIntervalProgram(input.state, input.intensity, input.intervals, input.baseProfile),
      generated: true,
      intervals: input.intervals,
      fromReplay: false,
    };
  }
  return { program: undefined, generated: false, intervals: null, fromReplay: false };
}
