import { normalizeProfile } from '../audio/types';
import { programMinDurationSec, type Program } from '../programs/types';
import type { ExportSelection } from './offlineRenderer';

/** Extra time rendered into an open-ended final phase when no duration was chosen. */
export const OPEN_SEGMENT_EXPORT_SEC = 10 * 60;

/**
 * The export selection for a program on its own (editor, lab): the program's
 * base sound snapshot for its closed phases, plus a fixed tail when the last
 * phase is open-ended. Setup uses the same shape with its chosen duration —
 * see App.resolveExportSelection — so all entry points render identically.
 */
export function programExportSelection(
  program: Program,
  chimeEnabled: boolean,
  minDurationSec = 0,
): { sel: ExportSelection; label: string } {
  const last = program.segments[program.segments.length - 1];
  const natural =
    programMinDurationSec(program) + (last.endMin === null ? OPEN_SEGMENT_EXPORT_SEC : 0);
  return {
    sel: {
      profile: normalizeProfile(program.baseProfile),
      state: program.baseState,
      durationSec: Math.max(natural, minDurationSec),
      program,
      chimeEnabled,
    },
    label: program.name,
  };
}
