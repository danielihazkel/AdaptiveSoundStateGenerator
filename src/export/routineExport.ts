import { BREATH_PATTERNS, type BreathingPatternId } from '../audio/breathing';
import { STATES } from '../audio/states';
import { cloneProfile, normalizeProfile } from '../audio/types';
import { chooseProfile } from '../personalization/personalizer';
import { programMinDurationSec, type Program } from '../programs/types';
import type { Routine } from '../routines/types';
import { breathingFor, wakeUpFor } from '../session/sessionOptions';
import type { Settings } from '../storage/types';
import { routineExportSelection, type ExportLeg, type ExportSelection } from './offlineRenderer';

/** "Energy 10 min → Focus 50 min" — the tag comment's plain-text routine. */
export function routineTagDescription(legs: readonly Pick<ExportLeg, 'state' | 'durationSec'>[]): string {
  return legs.map((l) => `${STATES[l.state].label} ${Math.round(l.durationSec / 60)} min`).join(' → ');
}

/**
 * A whole routine as one file (Phase 17) — the legs a live run would play,
 * resolved the way the setup screen's Download resolves a session: served
 * deterministically ('locked' = best known arm per leg), so a download never
 * feeds the bandit and downloading twice yields the same sound. Program legs
 * play their program (at least its closed phases); breathing follows each
 * leg's state; only the last plain leg may end in a wake-up rise; the first
 * leg's volume carries through, like the listener's volume does live.
 */
export function resolveRoutineExport(
  routine: Routine,
  input: {
    programs: readonly Program[];
    chimeEnabled: boolean;
    breathingPattern?: BreathingPatternId;
    wakeUp?: Settings['wakeUp'];
  },
): { sel: ExportSelection; label: string } {
  const legs: ExportLeg[] = routine.legs.map((leg, index) => {
    const last = index === routine.legs.length - 1;
    const program = leg.programId ? (input.programs.find((p) => p.id === leg.programId) ?? null) : null;
    if (program) {
      return {
        profile: normalizeProfile(program.baseProfile),
        state: program.baseState,
        durationSec: Math.max(leg.minutes * 60, programMinDurationSec(program)),
        program,
      };
    }
    const durationSec = leg.minutes * 60;
    const breathingId = breathingFor(leg.state, input.breathingPattern);
    return {
      profile: cloneProfile(chooseProfile(leg.state, leg.intensity, 'locked').profile),
      state: leg.state,
      durationSec,
      program: null,
      breathing: breathingId ? BREATH_PATTERNS[breathingId] : null,
      wakeUp: last ? wakeUpFor(leg.state, input.wakeUp, durationSec) : null,
    };
  });
  const volume = legs[0].profile.masterVolume;
  for (const leg of legs) leg.profile = { ...leg.profile, masterVolume: volume };
  return {
    sel: routineExportSelection(legs, input.chimeEnabled, {
      name: routine.name,
      description: routineTagDescription(legs),
    }),
    label: routine.name,
  };
}
