import type { SessionRecord } from '../storage/types';
import { scoreSession } from './reward';

/**
 * Over-time views of one state's sessions (PRD §18: the rating trend is the
 * core proof that the personalizer works). Pure functions over records; the
 * insights screen draws them.
 *
 * Recovered sessions (the app died) are left out everywhere: their length
 * and lack of rating say nothing about the sound.
 */

/** Trailing window for the smoothed series. */
export const TREND_WINDOW = 5;
/** Smoothed first-half vs last-half difference that counts as a direction. */
export const TREND_DIRECTION_THRESHOLD = 0.05;

export interface TrendPoint {
  /** ISO start time of the session. */
  at: string;
  /** 0..1 session quality score (rating-blended when rated). */
  score: number;
  /** Trailing-window mean of `score`, TREND_WINDOW wide. */
  smoothed: number;
  rated: boolean;
}

export type TrendDirection = 'up' | 'down' | 'flat';

function usable(records: readonly SessionRecord[]): SessionRecord[] {
  return records
    .filter((r) => !r.recovered)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// --- Is personalization working? (PRD §18) ----------------------------------

/** Each group needs this many sessions before the comparison is shown. */
export const MIN_LIFT_GROUP_SESSIONS = 3;
/** ±1.96 standard errors (≈95 %). */
const LIFT_CI_Z = 1.96;
/** |lift| below this reads as "about the same". */
export const LIFT_MEANINGFUL = 0.05;

export interface LiftGroup {
  /** Weighted mean session score, 0..1. */
  mean: number;
  /** Session count (unweighted, what the user sees). */
  n: number;
  /** ± half-width of the ≈95 % interval around `mean`. */
  ci: number;
}

export interface PersonalizationLift {
  /** Sessions that played the untouched state default ('prior' + 'baseline'). */
  control: LiftGroup;
  /** Sessions the bandit shaped ('bandit' + 'locked'). */
  personalized: LiftGroup;
  /** personalized.mean − control.mean, on the 0..1 score scale. */
  lift: number;
  /** How many control sessions were held-out baselines (vs cold start). */
  heldOutCount: number;
}

function liftGroup(records: readonly SessionRecord[]): LiftGroup {
  let sumW = 0;
  let sumWV = 0;
  let sumW2 = 0;
  const scores: Array<{ v: number; w: number }> = [];
  for (const record of records) {
    const { value, weight } = scoreSession(record);
    scores.push({ v: value, w: weight });
    sumW += weight;
    sumWV += value * weight;
    sumW2 += weight * weight;
  }
  const mean = sumW > 0 ? sumWV / sumW : 0;
  const varW =
    sumW > 0 ? scores.reduce((acc, s) => acc + s.w * (s.v - mean) ** 2, 0) / sumW : 0;
  // Effective sample size under unequal weights (Kish).
  const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  return {
    mean,
    n: records.length,
    ci: nEff > 0 ? (LIFT_CI_Z * Math.sqrt(varW)) / Math.sqrt(nEff) : 0,
  };
}

/**
 * The flywheel proof: default-sound sessions (cold-start 'prior' plus the
 * held-out 'baseline' serves) against personalized ones ('bandit'/'locked'),
 * scored identically. Presets, programs, replays and customized sessions are
 * out — their sound wasn't what the personalizer served. Null until both
 * groups have MIN_LIFT_GROUP_SESSIONS.
 */
export function personalizationLift(
  records: readonly SessionRecord[],
): PersonalizationLift | null {
  const eligible = usable(records).filter((r) => r.servedArmId && !r.customized);
  const control = eligible.filter(
    (r) => r.servedBy === 'prior' || r.servedBy === 'baseline',
  );
  const personalized = eligible.filter(
    (r) => r.servedBy === 'bandit' || r.servedBy === 'locked',
  );
  if (
    control.length < MIN_LIFT_GROUP_SESSIONS ||
    personalized.length < MIN_LIFT_GROUP_SESSIONS
  ) {
    return null;
  }
  const controlGroup = liftGroup(control);
  const personalizedGroup = liftGroup(personalized);
  return {
    control: controlGroup,
    personalized: personalizedGroup,
    lift: personalizedGroup.mean - controlGroup.mean,
    heldOutCount: control.filter((r) => r.servedBy === 'baseline').length,
  };
}

/** Chronological quality scores, every session (rated or not), plus a smoothed line. */
export function ratingTrend(records: readonly SessionRecord[]): TrendPoint[] {
  const ordered = usable(records);
  const points: TrendPoint[] = [];
  let windowSum = 0;
  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    const score = scoreSession(record).value;
    windowSum += score;
    if (i >= TREND_WINDOW) windowSum -= scoreSession(ordered[i - TREND_WINDOW]).value;
    const width = Math.min(i + 1, TREND_WINDOW);
    points.push({ at: record.startedAt, score, smoothed: windowSum / width, rated: Boolean(record.feedback) });
  }
  return points;
}

/** Is the smoothed line rising, falling, or flat across the series? */
export function trendDirection(points: readonly TrendPoint[]): TrendDirection {
  if (points.length < 2) return 'flat';
  const half = Math.floor(points.length / 2);
  const mean = (slice: readonly TrendPoint[]) =>
    slice.reduce((acc, p) => acc + p.smoothed, 0) / slice.length;
  const delta = mean(points.slice(points.length - half)) - mean(points.slice(0, half));
  if (delta >= TREND_DIRECTION_THRESHOLD) return 'up';
  if (delta <= -TREND_DIRECTION_THRESHOLD) return 'down';
  return 'flat';
}

/**
 * Share of sessions that ran to their end (0..1), or null with nothing to
 * count. An open-ended session ends when the user stops it, so it always
 * counts as finished.
 */
export function completionRate(records: readonly SessionRecord[]): number | null {
  const ordered = usable(records);
  if (ordered.length === 0) return null;
  const finished = ordered.filter((r) => r.completed || r.openEnded).length;
  return finished / ordered.length;
}

/**
 * How many sessions it took to first play the variation that is now the
 * best known one (1-based; the session count at that point), or null when
 * that arm has not been served yet. Only sessions the bandit has settled
 * count — the arm cannot have been "found" before its reward landed.
 */
export function bestFoundAfter(
  records: readonly SessionRecord[],
  bestArmId: string | null | undefined,
): number | null {
  if (!bestArmId) return null;
  const ordered = usable(records);
  const index = ordered.findIndex((r) => r.servedArmId === bestArmId && r.banditResolvedAt);
  return index < 0 ? null : index + 1;
}
