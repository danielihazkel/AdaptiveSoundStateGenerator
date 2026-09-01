import type { SessionRecord, SessionSegment } from '../storage/types';

/**
 * Maps a finished session onto a bandit reward (PRD §9): explicit 1–5 ratings
 * where present, implicit signals (completion fraction, volume tweaks,
 * customization) otherwise. Constants are exported so attribution can be tuned
 * without redesign.
 */
export interface RewardResult {
  /** 0..1 — the reward value credited to the served arm. */
  value: number;
  /** 0..1 — confidence in the attribution; scales the posterior update. */
  weight: number;
}

/** Explicit rating dominates the blend when present. */
export const RATING_BLEND = 0.7;
/** Implicit score = BASE + SPAN · completionFraction; completed ⇒ 0.65. */
export const IMPLICIT_BASE = 0.15;
export const IMPLICIT_SPAN = 0.5;
/** Unrated sessions carry reduced confidence. */
export const IMPLICIT_ONLY_WEIGHT = 0.6;
/**
 * An open-ended session has no planned length to complete. Staying this long
 * by choice counts as a full completion; leaving sooner scales down the same
 * way an early stop does.
 */
export const OPEN_ENDED_TARGET_SEC = 25 * 60;
/** One volume tweak is settling in; each further tweak signals wrongness. */
export const VOLUME_PENALTY_PER_TWEAK = 0.05;
export const VOLUME_PENALTY_FLOOR = -0.15;
/**
 * Customized sessions played a profile that diverged from the served arm —
 * the outcome no longer cleanly credits it, and touching the advanced panel
 * is itself mild evidence the served sound wasn't right.
 */
export const CUSTOMIZED_WEIGHT = 0.5;
export const CUSTOMIZED_VALUE_CAP = 0.45;

/**
 * Phase 3 checkpoint credits (PRD §17). A one-tap mid-session answer is a
 * weaker label than a whole-session outcome, so its weight sits well below
 * IMPLICIT_ONLY_WEIGHT.
 */
export const CHECKPOINT_WEIGHT = 0.25;
export const CHECKPOINT_VALUES = { better: 0.85, same: 0.55, worse: 0.2 } as const;
/** End-of-session reward weight is scaled by the last segment's share, floored here. */
export const END_CREDIT_MIN_SCALE = 0.5;
/**
 * An interval (Pomodoro) program softens the served sound during breaks and
 * adds its own rhythm, so the outcome credits the arm a little less cleanly.
 */
export const INTERVAL_SESSION_WEIGHT = 0.8;

export function computeReward(record: SessionRecord): RewardResult | null {
  // Preset sessions (and pre-Phase-2 records) were not served by the bandit.
  if (!record.servedArmId || record.servedBy === 'preset') return null;
  return scoreSession(record);
}

/**
 * The same quality score without the served-arm gate — used by the insights
 * aggregations (PRD §10), which cover every session including presets.
 */
export function scoreSession(record: SessionRecord): RewardResult {
  const fraction = record.openEnded
    ? Math.min(record.actualDurationSec / OPEN_ENDED_TARGET_SEC, 1)
    : record.plannedDurationSec > 0
      ? Math.min(record.actualDurationSec / record.plannedDurationSec, 1)
      : 0;
  const implicit = IMPLICIT_BASE + IMPLICIT_SPAN * fraction;

  let value: number;
  let weight: number;
  if (record.feedback) {
    const ratingNorm = (record.feedback.rating - 1) / 4;
    value = RATING_BLEND * ratingNorm + (1 - RATING_BLEND) * implicit;
    weight = 1;
  } else {
    value = implicit;
    weight = IMPLICIT_ONLY_WEIGHT;
  }

  value += Math.max(
    VOLUME_PENALTY_FLOOR,
    -VOLUME_PENALTY_PER_TWEAK * Math.max(record.volumeAdjustments - 1, 0),
  );

  if (record.customized) {
    weight = Math.min(weight, CUSTOMIZED_WEIGHT);
    value = Math.min(value, CUSTOMIZED_VALUE_CAP);
  }

  return { value: Math.min(1, Math.max(0, value)), weight };
}

export interface ArmCredit {
  armId: string;
  reward: RewardResult;
}

/**
 * Per-arm reward attribution for one resolved session (Phase 3, PRD §17).
 * Without segments this is exactly the legacy single-arm path. With segments:
 * every explicitly-answered checkpoint credits its arm a small fixed-weight
 * reward, and the end-of-session score goes to the LAST arm — a post-hoc
 * rating is recency-dominated, and splitting would smear credit onto arms the
 * user already marked 'worse' — scaled by that arm's share of the session.
 */
export function computeCredits(record: SessionRecord): ArmCredit[] {
  const credits = rawCredits(record);
  if (!record.intervals || credits.length === 0) return credits;
  return credits.map((c) => ({
    armId: c.armId,
    reward: { value: c.reward.value, weight: c.reward.weight * INTERVAL_SESSION_WEIGHT },
  }));
}

function rawCredits(record: SessionRecord): ArmCredit[] {
  if (!record.servedArmId || record.servedBy === 'preset') return [];
  // The app died mid-session: the truncated length says nothing about the sound.
  if (record.recovered) return [];
  const segments = record.segments;
  if (!segments || segments.length === 0) {
    const reward = computeReward(record);
    return reward ? [{ armId: record.servedArmId, reward }] : [];
  }

  const credits: ArmCredit[] = [];
  for (const segment of segments) {
    const checkpoint = checkpointCredit(segment);
    if (checkpoint) credits.push(checkpoint);
  }

  const last = segments[segments.length - 1];
  const endReward = scoreSession(record);
  const lastShare =
    record.actualDurationSec > 0
      ? Math.max(last.endSec - last.startSec, 0) / record.actualDurationSec
      : 1;
  const scale = Math.min(1, Math.max(END_CREDIT_MIN_SCALE, lastShare));
  credits.push({
    armId: last.armId,
    reward: { value: endReward.value, weight: endReward.weight * scale },
  });
  return credits;
}

function checkpointCredit(segment: SessionSegment): ArmCredit | null {
  if (!segment.response) return null;
  let value = CHECKPOINT_VALUES[segment.response];
  value += Math.max(
    VOLUME_PENALTY_FLOOR,
    -VOLUME_PENALTY_PER_TWEAK * Math.max(segment.volumeAdjustments - 1, 0),
  );
  return {
    armId: segment.armId,
    reward: { value: Math.min(1, Math.max(0, value)), weight: CHECKPOINT_WEIGHT },
  };
}
