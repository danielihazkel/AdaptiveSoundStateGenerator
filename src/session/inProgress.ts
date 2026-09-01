import { newId } from '../storage/id';
import type { InProgressSession, SessionRecord } from '../storage/types';

/** How often the running session's checkpoint is rewritten. */
export const CHECKPOINT_EVERY_SEC = 30;
/** Shorter interrupted sessions are dropped rather than logged. */
export const MIN_RECOVERABLE_SEC = 60;

/**
 * Turn a leftover checkpoint (the app died mid-session) into the history
 * record it never got to write, or null when it was too short to matter.
 * Marked `recovered`: no bandit signal, no rating prompt.
 */
export function recoverSession(checkpoint: InProgressSession): SessionRecord | null {
  if (checkpoint.elapsedSec < MIN_RECOVERABLE_SEC) return null;
  return {
    id: newId(),
    startedAt: checkpoint.startedAt,
    state: checkpoint.state,
    intensity: checkpoint.intensity,
    plannedDurationSec: checkpoint.openEnded
      ? Math.round(checkpoint.elapsedSec)
      : checkpoint.plannedDurationSec,
    actualDurationSec: checkpoint.openEnded
      ? Math.round(checkpoint.elapsedSec)
      : Math.min(Math.round(checkpoint.elapsedSec), checkpoint.plannedDurationSec),
    completed: false,
    customized: false,
    volumeAdjustments: 0,
    monoMode: checkpoint.monoMode,
    presetId: checkpoint.presetId,
    programId: checkpoint.programId,
    intervals: checkpoint.intervals,
    replayOfSessionId: checkpoint.replayOfSessionId,
    profile: checkpoint.profile,
    servedArmId: checkpoint.servedArmId,
    servedBy: checkpoint.servedBy,
    breathingPattern: checkpoint.breathingPattern,
    wakeUp: checkpoint.wakeUp,
    openEnded: checkpoint.openEnded,
    feedbackSkipped: true,
    recovered: true,
  };
}
