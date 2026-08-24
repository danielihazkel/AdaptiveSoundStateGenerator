import { STATE_LIST, type MentalState } from '../audio/states';
import { normalizeProfile, type NoiseType } from '../audio/types';
import type { PersonalizationState, SessionRecord } from '../storage/types';
import { posteriorFor } from './bandit';
import { candidatesFor } from './candidates';
import { scoreSession } from './reward';

/**
 * Personal sound profile aggregations (PRD §10) — pure functions over session
 * records and the bandit posterior. Every session contributes: rated ones via
 * their rating, unrated ones via the implicit score, weighted by confidence.
 */
export const MIN_SESSIONS_FOR_INSIGHTS = 5;
/** An arm needs this many weighted pulls before it's shown as "best". */
export const MIN_ARM_PULLS = 3;
/** Sessions per noise type before it can be called "preferred". */
export const MIN_NOISE_SESSIONS = 3;
/** Sessions scoring at least this count as "worked" for volume preference. */
export const GOOD_SESSION_SCORE = 0.5;

export type SoundComponent = 'binaural' | 'noise' | 'isochronic' | 'tone' | 'ambience';

export interface ComponentEffectiveness {
  component: SoundComponent;
  /** Weighted average quality score of sessions where the layer was on. */
  avgRewardWhenOn: number;
  sessionsOn: number;
}

export interface StateInsights {
  state: MentalState;
  sessionCount: number;
  ratedCount: number;
  avgRating: number | null;
  bestArm: { id: string; label: string; mean: number; n: number } | null;
  componentEffectiveness: ComponentEffectiveness[];
  /** Reward-weighted P25–P75 of the binaural beat, Hz. */
  preferredBeatRange: [number, number] | null;
  preferredNoiseType: NoiseType | null;
  /** Median master volume of sessions that worked. */
  preferredVolume: number | null;
  typicalDurationMin: number | null;
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
  return record.profile[component].enabled;
}

function computeStateInsights(
  state: MentalState,
  scored: Scored[],
  bandit: PersonalizationState,
): StateInsights {
  const ratings = scored
    .filter((s) => s.record.feedback)
    .map((s) => s.record.feedback!.rating);

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

  const componentEffectiveness: ComponentEffectiveness[] = (
    ['binaural', 'noise', 'isochronic', 'tone', 'ambience'] as SoundComponent[]
  ).map((component) => {
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

  return {
    state,
    sessionCount: scored.length,
    ratedCount: ratings.length,
    avgRating:
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : null,
    bestArm,
    componentEffectiveness,
    preferredBeatRange,
    preferredNoiseType,
    preferredVolume: median(
      scored
        .filter((s) => s.value >= GOOD_SESSION_SCORE)
        .map((s) => s.record.profile.masterVolume),
    ),
    typicalDurationMin: median(scored.map((s) => s.record.plannedDurationSec / 60)),
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
