import type { Distraction, SessionRecord, SessionSegment } from '../storage/types';
import type { SourceArmResolver } from './sourceArm';

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
/**
 * Explicitly declining to rate is mild evidence the session wasn't worth a
 * tap (PRD §9) — a small nudge below an unrated session, at implicit weight.
 */
export const SKIPPED_RATING_PENALTY = 0.05;

/**
 * Falling asleep to a sleep session is the outcome the state exists for: the
 * early fade must not read as an early stop (fraction forced to 1) and earns
 * a small positive nudge on top (Phase 9).
 */
export const SLEEP_ONSET_ADJUST = 0.1;

/**
 * Pauses (PRD §9): one pause is life happening; repeated pauses read as the
 * sound not holding the user. Same shape as the volume-tweak penalty.
 * Time spent paused is deliberately not scored — a long lunch break says
 * nothing about the sound.
 */
export const PAUSE_PENALTY_PER = 0.04;
export const PAUSE_PENALTY_FLOOR = -0.12;

/**
 * A recovered session (the app died) still carries one honest signal: the
 * sound played that long without being stopped. Credit the truncated
 * implicit score at a small weight instead of discarding it.
 */
export const RECOVERED_WEIGHT = 0.25;
/**
 * Replaying a session or a preset saved from one is a positive label for the
 * arm behind the sound (PRD §15): the *choice* counts REPLAY_CHOICE_VALUE,
 * blended with how the replay actually went, at reduced weight — it is a
 * second-hand observation of that arm.
 */
export const REPLAY_CHOICE_VALUE = 0.85;
export const REPLAY_CHOICE_BLEND = 0.5;
export const REPLAY_WEIGHT = 0.5;
/**
 * PRD §9 extras on the feedback screen, both optional. Small nudges on top
 * of the rating: the rating already carries most of the signal, these
 * disambiguate a "3" that was pleasant-but-distracting from one the user
 * would happily hear again.
 */
export const DISTRACTION_ADJUST: Record<Distraction, number> = { 1: 0.03, 2: 0, 3: -0.06 };
export const USE_AGAIN_ADJUST = { yes: 0.05, no: -0.08 } as const;

/** Extra inputs for attribution that live outside the record itself. */
export interface CreditContext {
  /** Arm behind a replayed session / saved preset (sourceArm.ts). */
  sourceArm?: SourceArmResolver;
}

/** A record the bandit can learn from, directly or through its source. */
export function hasBanditSignal(record: SessionRecord): boolean {
  return Boolean(record.servedArmId || record.replayOfSessionId || record.presetId);
}

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
  // A detected sleep onset ended the session early *on purpose* — that is
  // full completion, not an early stop.
  const fraction =
    record.sleepOnsetSec !== undefined
      ? 1
      : record.openEnded
        ? Math.min(record.actualDurationSec / OPEN_ENDED_TARGET_SEC, 1)
        : record.plannedDurationSec > 0
          ? Math.min(record.actualDurationSec / record.plannedDurationSec, 1)
          : 0;
  const implicit = IMPLICIT_BASE + IMPLICIT_SPAN * fraction;

  let value: number;
  let weight: number;
  if (record.feedback) {
    const fb = record.feedback;
    const ratingNorm = (fb.rating - 1) / 4;
    value = RATING_BLEND * ratingNorm + (1 - RATING_BLEND) * implicit;
    weight = 1;
    if (fb.distraction !== undefined) value += DISTRACTION_ADJUST[fb.distraction] ?? 0;
    if (fb.useAgain !== undefined) value += fb.useAgain ? USE_AGAIN_ADJUST.yes : USE_AGAIN_ADJUST.no;
  } else {
    value = implicit;
    weight = IMPLICIT_ONLY_WEIGHT;
    // Recovered sessions auto-set feedbackSkipped, but nobody declined a
    // prompt they never saw.
    if (record.feedbackSkipped && !record.recovered) value -= SKIPPED_RATING_PENALTY;
  }

  if (record.sleepOnsetSec !== undefined) value += SLEEP_ONSET_ADJUST;

  value += Math.max(
    VOLUME_PENALTY_FLOOR,
    -VOLUME_PENALTY_PER_TWEAK * Math.max(record.volumeAdjustments - 1, 0),
  );
  value += Math.max(
    PAUSE_PENALTY_FLOOR,
    -PAUSE_PENALTY_PER * Math.max((record.pauseCount ?? 0) - 1, 0),
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
export function computeCredits(record: SessionRecord, ctx: CreditContext = {}): ArmCredit[] {
  const credits = rawCredits(record, ctx);
  if (!record.intervals || credits.length === 0) return credits;
  return credits.map((c) => ({
    armId: c.armId,
    reward: { value: c.reward.value, weight: c.reward.weight * INTERVAL_SESSION_WEIGHT },
  }));
}

function rawCredits(record: SessionRecord, ctx: CreditContext): ArmCredit[] {
  // The app died mid-session: the truncated length is only a weak positive
  // ("played this long, never stopped") — a single down-weighted implicit
  // credit to the served arm, nothing for presets/replays.
  if (record.recovered) {
    if (!record.servedArmId || record.servedBy === 'preset') return [];
    const reward = computeReward(record);
    return reward
      ? [
          {
            armId: record.servedArmId,
            reward: { value: reward.value, weight: reward.weight * RECOVERED_WEIGHT },
          },
        ]
      : [];
  }
  if (!record.servedArmId || record.servedBy === 'preset') return replayCredit(record, ctx);
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

/**
 * A replayed session (or a preset saved from one) never served an arm, but
 * the user chose that sound again — credit the arm that produced it.
 */
function replayCredit(record: SessionRecord, ctx: CreditContext): ArmCredit[] {
  if (!ctx.sourceArm || !(record.replayOfSessionId || record.presetId)) return [];
  const source = ctx.sourceArm(record);
  if (!source || source.state !== record.state) return [];
  const outcome = scoreSession(record);
  const value =
    REPLAY_CHOICE_BLEND * REPLAY_CHOICE_VALUE + (1 - REPLAY_CHOICE_BLEND) * outcome.value;
  return [
    {
      armId: source.armId,
      reward: { value: Math.min(1, Math.max(0, value)), weight: outcome.weight * REPLAY_WEIGHT },
    },
  ];
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
