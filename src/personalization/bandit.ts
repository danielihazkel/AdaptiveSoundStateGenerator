import type { MentalState } from '../audio/states';
import type {
  ArmStats,
  PersonalizationState,
  SessionRecord,
} from '../storage/types';
import { SCHEMA_VERSION } from '../storage/types';
import { CANDIDATE_SET_VERSION, candidatesFor, PRIOR_ARM_ID } from './candidates';
import { computeCredits, type RewardResult } from './reward';

/**
 * Thompson-sampling bandit over the candidate recipes (PRD §9/§16).
 * Pure functions over PersonalizationState — no storage access, rng injected.
 *
 * Posterior: Gaussian on mean reward. The simplest dependency-free conjugate;
 * at this data scale (a handful of weighted pulls per arm) a Beta posterior
 * would need a gamma sampler for no practical benefit.
 */
export const COLD_START_SESSIONS = 6;
/** Pseudo-observations backing the prior mean. */
export const PRIOR_N = 1;
/** Sampling scale — posterior std = SIGMA / √(PRIOR_N + n). */
export const SIGMA = 0.25;
/** The state default starts slightly ahead so it wins early ties (PRD §9 cold start). */
export const PRIOR_ARM_MEAN = 0.55;
export const OTHER_ARM_MEAN = 0.5;

export interface Posterior {
  mean: number;
  std: number;
}

export function posteriorFor(stats: ArmStats | undefined, armId: string): Posterior {
  const priorMean = armId === PRIOR_ARM_ID ? PRIOR_ARM_MEAN : OTHER_ARM_MEAN;
  const n = stats?.n ?? 0;
  const sum = stats?.sum ?? 0;
  return {
    mean: (priorMean * PRIOR_N + sum) / (PRIOR_N + n),
    std: SIGMA / Math.sqrt(PRIOR_N + n),
  };
}

/** Box–Muller standard normal from a uniform rng. */
function gaussian(rng: () => number): number {
  let u1 = rng();
  if (u1 <= 0) u1 = Number.MIN_VALUE; // log(0) guard
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Thompson step: one posterior draw per arm, serve the argmax. */
export function sampleArm(
  state: PersonalizationState,
  mental: MentalState,
  rng: () => number = Math.random,
): string {
  const armStats = state.arms[mental] ?? {};
  let best = PRIOR_ARM_ID;
  let bestDraw = -Infinity;
  for (const { id } of candidatesFor(mental)) {
    const { mean, std } = posteriorFor(armStats[id], id);
    const draw = mean + std * gaussian(rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = id;
    }
  }
  return best;
}

/** Locked mode: deterministic argmax of posterior means, no exploration. */
export function bestArm(state: PersonalizationState, mental: MentalState): string {
  const armStats = state.arms[mental] ?? {};
  let best = PRIOR_ARM_ID;
  let bestMean = -Infinity;
  for (const { id } of candidatesFor(mental)) {
    const { mean } = posteriorFor(armStats[id], id);
    if (mean > bestMean) {
      bestMean = mean;
      best = id;
    }
  }
  return best;
}

/** Σ weighted pulls across arms — drives the cold-start gate, derived not stored. */
export function eligibleSessionCount(
  state: PersonalizationState,
  mental: MentalState,
): number {
  return Object.values(state.arms[mental] ?? {}).reduce((acc, s) => acc + s.n, 0);
}

/** Immutable weighted update of one arm's sufficient statistics. */
export function updateArm(
  state: PersonalizationState,
  mental: MentalState,
  armId: string,
  reward: RewardResult,
): PersonalizationState {
  const prev = state.arms[mental]?.[armId] ?? { n: 0, sum: 0, sumSq: 0 };
  const next: ArmStats = {
    n: prev.n + reward.weight,
    sum: prev.sum + reward.weight * reward.value,
    sumSq: prev.sumSq + reward.weight * reward.value * reward.value,
  };
  return {
    ...state,
    arms: {
      ...state.arms,
      [mental]: { ...(state.arms[mental] ?? {}), [armId]: next },
    },
  };
}

/**
 * Deterministic reconstruction of the posterior from session records — used by
 * import so merging data is idempotent. Only records already stamped
 * banditResolvedAt count; unresolved recent sessions will be picked up by the
 * normal resolution sweep, keeping rebuild ≡ incremental updates.
 */
export function rebuildFromSessions(sessions: SessionRecord[]): PersonalizationState {
  let state: PersonalizationState = {
    schemaVersion: SCHEMA_VERSION,
    candidateSetVersion: CANDIDATE_SET_VERSION,
    arms: {},
  };
  for (const record of sessions) {
    if (!record.banditResolvedAt || !record.servedArmId) continue;
    for (const credit of computeCredits(record)) {
      state = updateArm(state, record.state, credit.armId, credit.reward);
    }
  }
  return state;
}
