import { STATE_LIST, type MentalState } from '../audio/states';
import { normalizeProfile, type NoiseType } from '../audio/types';
import type { ArmStats, PersonalizationState, SessionRecord } from '../storage/types';
import { contextualPosterior, posteriorFor } from './bandit';
import { candidatesFor } from './candidates';
import { parseContextKey, TIME_BUCKETS, type TimeBucket } from './context';
import { scoreSession } from './reward';
import {
  bestFoundAfter,
  completionRate,
  ratingTrend,
  trendDirection,
  type TrendDirection,
  type TrendPoint,
} from './trends';

/**
 * Personal sound profile aggregations (PRD §10) — pure functions over session
 * records and the bandit posterior. Every session contributes: rated ones via
 * their rating, unrated ones via the implicit score, weighted by confidence.
 */
export const MIN_SESSIONS_FOR_INSIGHTS = 5;
/**
 * An arm needs this many weighted pulls before it's shown as "best". Pulls
 * decay with recency (bandit.ts DECAY), so read this as "about three recent
 * sessions' worth of evidence".
 */
export const MIN_ARM_PULLS = 3;
/** Half-width of the shown interval: ±1.96 posterior std (≈95 %). */
export const ARM_CI_Z = 1.96;
/** A time of day needs this many weighted pulls (all arms) before it gets a winner. */
export const MIN_CONTEXT_PULLS = 2;
/** Sessions per noise type before it can be called "preferred". */
export const MIN_NOISE_SESSIONS = 3;
/** Sessions scoring at least this count as "worked" for volume preference. */
export const GOOD_SESSION_SCORE = 0.5;
/** Sessions carrying an HRV delta before the fact is shown (Phase 9). */
export const MIN_HRV_SESSIONS = 3;

export type SoundComponent =
  | 'binaural'
  | 'noise'
  | 'isochronic'
  | 'rhythm'
  | 'tone'
  | 'harmony'
  | 'bass'
  | 'ambience';

export const SOUND_COMPONENTS: readonly SoundComponent[] = [
  'binaural',
  'noise',
  'isochronic',
  'rhythm',
  'tone',
  'harmony',
  'bass',
  'ambience',
];

export interface ComponentEffectiveness {
  component: SoundComponent;
  /** Weighted average quality score of sessions where the layer was on. */
  avgRewardWhenOn: number;
  sessionsOn: number;
}

/** One row of the per-variation comparison table. */
export interface ArmInsight {
  id: string;
  label: string;
  /** Weighted, recency-decayed pulls. */
  pulls: number;
  /** Posterior mean reward, 0..1. */
  mean: number;
  /** ± half-width of the interval around `mean`. */
  ci: number;
  /** The row shown as "Best variation" (needs MIN_ARM_PULLS). */
  isBest: boolean;
}

export interface StateInsights {
  state: MentalState;
  sessionCount: number;
  ratedCount: number;
  avgRating: number | null;
  bestArm: { id: string; label: string; mean: number; n: number } | null;
  /** Every variation that has been played, best first. */
  arms: ArmInsight[];
  /** Best variation per time of day, where that time has enough evidence. */
  bestByTime: Array<{ bucket: TimeBucket; label: string; n: number }>;
  componentEffectiveness: ComponentEffectiveness[];
  /** Reward-weighted P25–P75 of the binaural beat, Hz. */
  preferredBeatRange: [number, number] | null;
  preferredNoiseType: NoiseType | null;
  /** Median master volume of sessions that worked. */
  preferredVolume: number | null;
  typicalDurationMin: number | null;
  /** Session quality over time (PRD §18 — the rating trend is the core proof point). */
  trend: TrendPoint[];
  trendDirection: TrendDirection;
  /** Share of sessions that ran to their end; null with nothing to count. */
  completionRate: number | null;
  /** Session count at which the current best variation was first played and settled. */
  bestFoundAfter: number | null;
  /**
   * Mean per-session HRV (RMSSD) change during sessions whose segments
   * carry one (heart-rate sensor with RR support); null below
   * MIN_HRV_SESSIONS. Positive = HRV rose while listening.
   */
  hrvDeltaPct: { meanPct: number; n: number } | null;
}

interface Scored {
  record: SessionRecord;
  value: number;
  weight: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Weighted percentile by cumulative weight; assumes weights are positive. */
function weightedPercentile(pairs: Array<[number, number]>, p: number): number {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((acc, [, w]) => acc + w, 0);
  let cumulative = 0;
  for (const [value, weight] of sorted) {
    cumulative += weight;
    if (cumulative >= p * total) return value;
  }
  return sorted[sorted.length - 1][0];
}

function componentEnabled(record: SessionRecord, component: SoundComponent): boolean {
  const p = record.profile;
  switch (component) {
    case 'rhythm':
      // A BPM pattern grid rather than a plain pulse — only audible with the pulse on.
      return p.isochronic.enabled && p.rhythm.mode !== 'simple';
    case 'bass':
      return p.bass > 0;
    default:
      return p[component].enabled;
  }
}

function computeStateInsights(
  state: MentalState,
  scored: Scored[],
  bandit: PersonalizationState,
): StateInsights {
  const ratings = scored
    .filter((s) => s.record.feedback)
    .map((s) => s.record.feedback!.rating);
  const records = scored.map((s) => s.record);
  const trend = ratingTrend(records);

  // Best-known variation from the bandit posterior, once an arm has real data.
  let bestArm: StateInsights['bestArm'] = null;
  const armStats = bandit.arms[state] ?? {};
  for (const spec of candidatesFor(state)) {
    const stats = armStats[spec.id];
    if (!stats || stats.n < MIN_ARM_PULLS) continue;
    const { mean } = posteriorFor(stats, spec.id);
    if (!bestArm || mean > bestArm.mean) {
      bestArm = { id: spec.id, label: spec.label, mean, n: stats.n };
    }
  }

  // The whole comparison, so the user can see *why* something is best — and
  // which variations are still barely explored.
  const arms: ArmInsight[] = [];
  for (const spec of candidatesFor(state)) {
    const stats = armStats[spec.id];
    if (!stats || stats.n <= 0) continue;
    const { mean, std } = posteriorFor(stats, spec.id);
    arms.push({
      id: spec.id,
      label: spec.label,
      pulls: stats.n,
      mean,
      ci: ARM_CI_Z * std,
      isBest: bestArm?.id === spec.id,
    });
  }
  arms.sort((a, b) => b.mean - a.mean || b.pulls - a.pulls);

  // Time-of-day winners: mono and stereo evidence merged per bucket, the
  // context posterior shrunk toward the state one, shown only where the
  // bucket has been tried enough to say anything.
  const bestByTime: StateInsights['bestByTime'] = [];
  const contexts = bandit.contexts?.[state] ?? {};
  for (const bucket of TIME_BUCKETS) {
    const merged: Record<string, ArmStats> = {};
    for (const [key, byArm] of Object.entries(contexts)) {
      if (parseContextKey(key)?.bucket !== bucket) continue;
      for (const [armId, s] of Object.entries(byArm)) {
        const prev = merged[armId] ?? { n: 0, sum: 0, sumSq: 0 };
        merged[armId] = { n: prev.n + s.n, sum: prev.sum + s.sum, sumSq: prev.sumSq + s.sumSq };
      }
    }
    const n = Object.values(merged).reduce((acc, s) => acc + s.n, 0);
    if (n < MIN_CONTEXT_PULLS) continue;
    let winner: { id: string; label: string; mean: number } | null = null;
    for (const spec of candidatesFor(state)) {
      const { mean } = contextualPosterior(armStats[spec.id], merged[spec.id], spec.id);
      if (!winner || mean > winner.mean) winner = { id: spec.id, label: spec.label, mean };
    }
    if (winner) bestByTime.push({ bucket, label: winner.label, n });
  }

  const componentEffectiveness: ComponentEffectiveness[] = SOUND_COMPONENTS.map((component) => {
    const on = scored.filter((s) => componentEnabled(s.record, component));
    const totalWeight = on.reduce((acc, s) => acc + s.weight, 0);
    return {
      component,
      avgRewardWhenOn:
        totalWeight > 0
          ? on.reduce((acc, s) => acc + s.value * s.weight, 0) / totalWeight
          : 0,
      sessionsOn: on.length,
    };
  });

  // Beat preference: quality-weighted spread of what actually played.
  const beatPairs: Array<[number, number]> = scored
    .filter((s) => s.record.profile.binaural.enabled)
    .map((s) => [s.record.profile.binaural.beat, s.value * s.weight]);
  const beatWeight = beatPairs.reduce((acc, [, w]) => acc + w, 0);
  const preferredBeatRange: [number, number] | null =
    beatWeight > 0
      ? [weightedPercentile(beatPairs, 0.25), weightedPercentile(beatPairs, 0.75)]
      : null;

  // Noise preference: best average score among types tried often enough.
  const byNoise = new Map<NoiseType, Scored[]>();
  for (const s of scored) {
    if (!s.record.profile.noise.enabled) continue;
    const type = s.record.profile.noise.type;
    byNoise.set(type, [...(byNoise.get(type) ?? []), s]);
  }
  let preferredNoiseType: NoiseType | null = null;
  let bestNoiseScore = -Infinity;
  for (const [type, group] of byNoise) {
    if (group.length < MIN_NOISE_SESSIONS) continue;
    const totalWeight = group.reduce((acc, s) => acc + s.weight, 0);
    const avg = group.reduce((acc, s) => acc + s.value * s.weight, 0) / totalWeight;
    if (avg > bestNoiseScore) {
      bestNoiseScore = avg;
      preferredNoiseType = type;
    }
  }

  // HRV during sessions (Phase 9): each session averages its segments' RMSSD
  // deltas; the fact is the mean over such sessions.
  const hrvPerSession: number[] = [];
  for (const record of records) {
    const deltas = (record.segments ?? [])
      .map((s) => s.hrvDeltaPct)
      .filter((d): d is number => d !== undefined);
    if (deltas.length > 0) {
      hrvPerSession.push(deltas.reduce((a, b) => a + b, 0) / deltas.length);
    }
  }
  const hrvDeltaPct =
    hrvPerSession.length >= MIN_HRV_SESSIONS
      ? {
          meanPct: hrvPerSession.reduce((a, b) => a + b, 0) / hrvPerSession.length,
          n: hrvPerSession.length,
        }
      : null;

  return {
    state,
    sessionCount: scored.length,
    ratedCount: ratings.length,
    avgRating:
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : null,
    bestArm,
    arms,
    hrvDeltaPct,
    bestByTime,
    componentEffectiveness,
    preferredBeatRange,
    preferredNoiseType,
    preferredVolume: median(
      scored
        .filter((s) => s.value >= GOOD_SESSION_SCORE)
        .map((s) => s.record.profile.masterVolume),
    ),
    typicalDurationMin: median(scored.map((s) => s.record.plannedDurationSec / 60)),
    trend,
    trendDirection: trendDirection(trend),
    completionRate: completionRate(records),
    bestFoundAfter: bestFoundAfter(records, bestArm?.id),
  };
}

/** Only states with enough sessions appear — PRD §10 "after several sessions". */
export function computeInsights(
  sessions: SessionRecord[],
  bandit: PersonalizationState,
): StateInsights[] {
  const results: StateInsights[] = [];
  for (const { id: state } of STATE_LIST) {
    const scored: Scored[] = sessions
      .filter((r) => r.state === state)
      // Old records may predate profile fields (e.g. ambience) — complete them
      // before any profile[component] access.
      .map((record) => ({
        record: { ...record, profile: normalizeProfile(record.profile) },
        ...scoreSession(record),
      }));
    if (scored.length < MIN_SESSIONS_FOR_INSIGHTS) continue;
    results.push(computeStateInsights(state, scored, bandit));
  }
  return results;
}
