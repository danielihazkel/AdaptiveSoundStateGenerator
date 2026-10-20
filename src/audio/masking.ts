import { MAX_MASKING_BOOST } from './mixPolicy';

/**
 * Adaptive masking (Phase 16, PRD §6E "mask environmental distractions"):
 * when the room gets louder than it was when the session started — a café
 * filling up, a colleague on a call — the noise and ambience beds rise a
 * little to keep masking it, and settle back when the room quietens. Pure:
 * microphone loudness readings in, a gain for the engine's masking side
 * channel out. Only levels are ever measured — nothing is recorded.
 */
export interface RoomReading {
  /** ms epoch */
  timestamp: number;
  /** RMS level of the microphone signal over the last second, dBFS. */
  db: number;
}

export const MASKING_DEFAULTS = {
  /** The room's own level = median of the session's first minute. */
  baselineWindowMs: 60_000,
  /** "The room now" = median of the last few seconds (one cough is not a room). */
  recentWindowMs: 10_000,
  /** Louder than the baseline by less than this: leave the sound alone. */
  deadbandDb: 3,
  /** At this much louder the full MAX_MASKING_BOOST applies. */
  fullBoostAtDb: 15,
  /** Rise slowly (a minute) — never chase a door slam… */
  attackSec: 60,
  /** …and settle back faster once the room quietens. */
  releaseSec: 20,
} as const;

/** Readings needed before the baseline means anything. */
const MIN_BASELINE_READINGS = 20;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How much louder the room is now than at the start, in dB; null until the
 * baseline exists. `currentBoostDb` is subtracted: the microphone also hears
 * the app's own beds, so without this a boost would read as a louder room
 * and ratchet itself up (echo cancellation removes most, not all, of it).
 */
export function roomExcessDb(
  readings: readonly RoomReading[],
  now: number,
  currentBoostDb = 0,
): number | null {
  if (readings.length === 0) return null;
  const firstTs = readings[0].timestamp;
  const baseline = readings
    .filter((r) => r.timestamp - firstTs <= MASKING_DEFAULTS.baselineWindowMs)
    .map((r) => r.db);
  if (baseline.length < MIN_BASELINE_READINGS) return null;
  if (now - firstTs <= MASKING_DEFAULTS.baselineWindowMs) return null;
  const recent = readings.filter((r) => now - r.timestamp <= MASKING_DEFAULTS.recentWindowMs).map((r) => r.db);
  if (recent.length === 0) return null;
  return median(recent) - median(baseline) - currentBoostDb;
}

/** The boost the room calls for: none inside the deadband, the full cap by fullBoostAtDb. */
export function targetMaskingGain(excessDb: number | null): number {
  if (excessDb === null) return 1;
  const { deadbandDb, fullBoostAtDb } = MASKING_DEFAULTS;
  const share = Math.min(1, Math.max(0, (excessDb - deadbandDb) / (fullBoostAtDb - deadbandDb)));
  return MAX_MASKING_BOOST ** share;
}

/** One smoothing step toward the target: slow attack, faster release. */
export function stepMaskingGain(current: number, target: number, dtSec: number): number {
  const tau = target > current ? MASKING_DEFAULTS.attackSec : MASKING_DEFAULTS.releaseSec;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dtSec) / tau));
  return Math.min(MAX_MASKING_BOOST, Math.max(1, next));
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}
