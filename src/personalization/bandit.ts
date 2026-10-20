import type { MentalState } from '../audio/states';
import type {
  ArmStats,
  PersonalizationState,
  Preset,
  SessionRecord,
} from '../storage/types';
import { SCHEMA_VERSION } from '../storage/types';
import { CANDIDATE_SET_VERSION, candidatesFor, PRIOR_ARM_ID } from './candidates';
import { contextKey, contextOf, type ServeContext } from './context';
import { computeCredits, hasBanditSignal, type RewardResult } from './reward';
import { makeSourceArmResolver } from './sourceArm';

/**
 * Thompson-sampling bandit over the candidate recipes (PRD §9/§16).
 * Pure functions over PersonalizationState — no storage access, rng injected.
 *
 * Posterior: Gaussian on mean reward. The simplest dependency-free conjugate;
 * at this data scale (a handful of weighted pulls per arm) a Beta posterior
 * would need a gamma sampler for no practical benefit.
 *
 * Contextual: every arm also keeps statistics per serving context (time of
 * day × mono). A context's mean is shrunk toward the state-level mean with
 * CONTEXT_SHRINK_N pseudo-observations, so with no context evidence the two
 * are identical and behaviour is exactly the non-contextual bandit.
 */
export const COLD_START_SESSIONS = 6;
/** Pseudo-observations backing the prior mean. */
export const PRIOR_N = 1;
/** Sampling scale — posterior std = SIGMA / √(PRIOR_N + n). */
export const SIGMA = 0.25;
/** The state default starts slightly ahead so it wins early ties (PRD §9 cold start). */
export const PRIOR_ARM_MEAN = 0.55;
export const OTHER_ARM_MEAN = 0.5;
/**
 * Recency: before each resolved session is credited, every arm's statistics
 * for that state are multiplied by DECAY, so evidence has this half-life in
 * sessions. Preferences drift (season, job, hearing fatigue) and early
 * ratings were made against a less-tuned app; without decay they would pin
 * the posterior forever. 60 ≈ two months at a session a day — long enough
 * that a 13–15 arm menu still converges, short enough to keep learning. The
 * effective n saturates at 1/(1−DECAY) ≈ 87, so the posterior std never drops
 * below SIGMA/√88 ≈ 0.027: mild perpetual exploration by design.
 */
export const DECAY_HALF_LIFE_SESSIONS = 60;
export const DECAY = 0.5 ** (1 / DECAY_HALF_LIFE_SESSIONS);
/** Pseudo-observations of the state-level mean backing each context's mean. */
export const CONTEXT_SHRINK_N = 3;

export interface Posterior {
  mean: number;
  std: number;
}

/**
 * Exploration never fully stops (Phase 10 floor): decay saturates the
 * effective n at 1/(1−DECAY), and the empirical-variance blend must not let
 * a run of identical rewards collapse the spread below the level the decay
 * design already promised (see the DECAY comment above).
 */
export const MIN_POSTERIOR_STD = SIGMA / Math.sqrt(PRIOR_N + 1 / (1 - DECAY));

/**
 * Variance blend (Phase 10): PRIOR_N pseudo-observations at SIGMA² plus the
 * arm's own empirical spread from the stored sumSq. With n = 0 this is
 * exactly SIGMA², so untouched arms behave as before; a noisy arm keeps a
 * wide posterior (more exploration), a consistent one narrows faster.
 */
function blendedVariance(stats: ArmStats | undefined): number {
  const n = stats?.n ?? 0;
  if (n <= 0) return SIGMA * SIGMA;
  const mean = (stats?.sum ?? 0) / n;
  const empVar = Math.max(0, (stats?.sumSq ?? 0) / n - mean * mean);
  return (PRIOR_N * SIGMA * SIGMA + n * empVar) / (PRIOR_N + n);
}

/** The fixed prior mean of an arm, before any cross-state pooling. */
function basePriorMean(armId: string): number {
  return armId === PRIOR_ARM_ID ? PRIOR_ARM_MEAN : OTHER_ARM_MEAN;
}

/**
 * Cross-state pooling (Phase 13). Recipes whose effect is the same *kind* of
 * change everywhere ("a little more bass", "a softer binaural layer") carry
 * what they did in other states into this one's prior: a new state stops
 * starting from scratch on a recipe that clearly worked — or clearly didn't —
 * elsewhere. Recipes that mean different things per state (an alternate
 * noise colour, an alternate ambience, toggling a pad that may or may not be
 * there, sleep's "darker") are never pooled.
 */
export const POOLABLE_ARMS: ReadonlySet<string> = new Set([
  'beat-down',
  'beat-up',
  'carrier-low',
  'binaural-soft',
  'noise-up',
  'iso-off',
  'ambience-up',
  'bass-up',
  'warmth-up',
  'space-on',
  'pulse-deep',
]);
/** Pseudo-observations of "no effect" the pooled evidence must outweigh. */
export const POOL_SHRINK_N = 4;
/** The pooled shift never moves a prior further than this. */
export const POOL_MAX_SHIFT = 0.15;

/**
 * The prior mean for `armId` in `mental`: the fixed prior, shifted by the
 * recipe's relative effect in every *other* state — its posterior mean minus
 * that state's default-sound posterior mean — weighted by evidence and
 * shrunk with POOL_SHRINK_N pseudo-observations of zero effect, capped at
 * ±POOL_MAX_SHIFT. Exactly the fixed prior with no evidence elsewhere, so
 * single-state histories (and the pinned draws) are untouched.
 */
export function pooledPriorMean(state: PersonalizationState, mental: MentalState, armId: string): number {
  const base = basePriorMean(armId);
  if (!POOLABLE_ARMS.has(armId)) return base;
  let weight = 0;
  let weighted = 0;
  for (const [other, arms] of Object.entries(state.arms)) {
    if (other === mental || !arms) continue;
    const stats = arms[armId];
    if (!stats || stats.n <= 0) continue;
    const effect = posteriorFor(stats, armId).mean - posteriorFor(arms[PRIOR_ARM_ID], PRIOR_ARM_ID).mean;
    weight += stats.n;
    weighted += stats.n * effect;
  }
  if (weight <= 0) return base;
  const shift = weighted / (weight + POOL_SHRINK_N);
  return base + Math.min(POOL_MAX_SHIFT, Math.max(-POOL_MAX_SHIFT, shift));
}

/** `priorMean` defaults to the fixed prior; the bandit passes the pooled one. */
export function posteriorFor(
  stats: ArmStats | undefined,
  armId: string,
  priorMean = basePriorMean(armId),
): Posterior {
  const n = stats?.n ?? 0;
  const sum = stats?.sum ?? 0;
  return {
    mean: (priorMean * PRIOR_N + sum) / (PRIOR_N + n),
    std: Math.max(
      MIN_POSTERIOR_STD,
      Math.sqrt(blendedVariance(stats) / (PRIOR_N + n)),
    ),
  };
}

/**
 * Posterior for an arm in one context: the state-level posterior with its
 * mean pulled toward the context's own evidence, and (Phase 10) its spread
 * narrowed by the context observations — context evidence now drives
 * exploration too, not only exploitation. Exactly `posteriorFor` when the
 * context has no data, which keeps old payloads and context-free calls
 * bit-identical.
 */
export function contextualPosterior(
  stateStats: ArmStats | undefined,
  ctxStats: ArmStats | undefined,
  armId: string,
  priorMean?: number,
): Posterior {
  const base = posteriorFor(stateStats, armId, priorMean);
  const nc = ctxStats?.n ?? 0;
  if (nc <= 0) return base;
  const n = stateStats?.n ?? 0;
  return {
    mean: (base.mean * CONTEXT_SHRINK_N + (ctxStats?.sum ?? 0)) / (CONTEXT_SHRINK_N + nc),
    std: Math.max(
      MIN_POSTERIOR_STD,
      Math.sqrt(blendedVariance(stateStats) / (PRIOR_N + n + nc)),
    ),
  };
}

export function contextStatsFor(
  state: PersonalizationState,
  mental: MentalState,
  ctx: ServeContext | undefined,
): Record<string, ArmStats> | undefined {
  if (!ctx) return undefined;
  return state.contexts?.[mental]?.[contextKey(ctx)];
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
  ctx?: ServeContext,
): string {
  const armStats = state.arms[mental] ?? {};
  const ctxStats = contextStatsFor(state, mental, ctx);
  let best = PRIOR_ARM_ID;
  let bestDraw = -Infinity;
  for (const { id } of candidatesFor(mental)) {
    const { mean, std } = contextualPosterior(
      armStats[id],
      ctxStats?.[id],
      id,
      pooledPriorMean(state, mental, id),
    );
    const draw = mean + std * gaussian(rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = id;
    }
  }
  return best;
}

/** Locked mode: deterministic argmax of posterior means, no exploration. */
export function bestArm(
  state: PersonalizationState,
  mental: MentalState,
  ctx?: ServeContext,
): string {
  const armStats = state.arms[mental] ?? {};
  const ctxStats = contextStatsFor(state, mental, ctx);
  let best = PRIOR_ARM_ID;
  let bestMean = -Infinity;
  for (const { id } of candidatesFor(mental)) {
    const { mean } = contextualPosterior(
      armStats[id],
      ctxStats?.[id],
      id,
      pooledPriorMean(state, mental, id),
    );
    if (mean > bestMean) {
      bestMean = mean;
      best = id;
    }
  }
  return best;
}

/**
 * Sessions resolved for a state — drives the cold-start gate. The undecayed
 * `resolved` counter when present; Σ weighted pulls for payloads written
 * before it existed (or states never resolved through decayState).
 */
export function eligibleSessionCount(
  state: PersonalizationState,
  mental: MentalState,
): number {
  const resolved = state.resolved?.[mental];
  if (resolved !== undefined) return resolved;
  return Object.values(state.arms[mental] ?? {}).reduce((acc, s) => acc + s.n, 0);
}

function addReward(prev: ArmStats | undefined, reward: RewardResult): ArmStats {
  const p = prev ?? { n: 0, sum: 0, sumSq: 0 };
  return {
    n: p.n + reward.weight,
    sum: p.sum + reward.weight * reward.value,
    sumSq: p.sumSq + reward.weight * reward.value * reward.value,
  };
}

/**
 * Immutable weighted update of one arm's sufficient statistics — at the
 * state level always, and in the given context too when one is known.
 */
export function updateArm(
  state: PersonalizationState,
  mental: MentalState,
  armId: string,
  reward: RewardResult,
  ctx?: ServeContext,
): PersonalizationState {
  const next: PersonalizationState = {
    ...state,
    arms: {
      ...state.arms,
      [mental]: { ...(state.arms[mental] ?? {}), [armId]: addReward(state.arms[mental]?.[armId], reward) },
    },
  };
  if (!ctx) return next;
  const key = contextKey(ctx);
  const stateContexts = state.contexts?.[mental] ?? {};
  const inContext = stateContexts[key] ?? {};
  next.contexts = {
    ...(state.contexts ?? {}),
    [mental]: {
      ...stateContexts,
      [key]: { ...inContext, [armId]: addReward(inContext[armId], reward) },
    },
  };
  return next;
}

function decayStats(arms: Record<string, ArmStats>): Record<string, ArmStats> {
  const out: Record<string, ArmStats> = {};
  for (const [armId, s] of Object.entries(arms)) {
    out[armId] = { n: s.n * DECAY, sum: s.sum * DECAY, sumSq: s.sumSq * DECAY };
  }
  return out;
}

/**
 * One resolved session's worth of forgetting for a state: every arm's stats
 * (state level and every context) shrink by DECAY and the undecayed session
 * counter advances. Call exactly once per session that yields at least one
 * credit, before crediting it — both the incremental path and
 * rebuildFromSessions do, so they stay equal.
 */
export function decayState(state: PersonalizationState, mental: MentalState): PersonalizationState {
  const next: PersonalizationState = {
    ...state,
    arms: { ...state.arms, [mental]: decayStats(state.arms[mental] ?? {}) },
    resolved: { ...(state.resolved ?? {}), [mental]: (state.resolved?.[mental] ?? 0) + 1 },
  };
  const stateContexts = state.contexts?.[mental];
  if (stateContexts) {
    const decayed: Record<string, Record<string, ArmStats>> = {};
    for (const [key, arms] of Object.entries(stateContexts)) decayed[key] = decayStats(arms);
    next.contexts = { ...(state.contexts ?? {}), [mental]: decayed };
  }
  return next;
}

/**
 * Deterministic reconstruction of the posterior from session records — used by
 * import and candidate-set upgrades so merging data is idempotent. Only
 * records already stamped banditResolvedAt count; unresolved recent sessions
 * will be picked up by the normal resolution sweep. Records are replayed in
 * resolution order (oldest first) so decay lands exactly as it did
 * incrementally: rebuild ≡ incremental updates.
 */
export function rebuildFromSessions(
  sessions: readonly SessionRecord[],
  presets: readonly Preset[] = [],
): PersonalizationState {
  let state: PersonalizationState = {
    schemaVersion: SCHEMA_VERSION,
    candidateSetVersion: CANDIDATE_SET_VERSION,
    arms: {},
  };
  const sourceArm = makeSourceArmResolver(sessions, presets);
  const ordered = sessions
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.banditResolvedAt && hasBanditSignal(record))
    // Stored newest-first: on equal stamps the higher index is the older record.
    .sort(
      (a, b) =>
        a.record.banditResolvedAt!.localeCompare(b.record.banditResolvedAt!) || b.index - a.index,
    );
  for (const { record } of ordered) {
    const credits = computeCredits(record, { sourceArm });
    if (credits.length === 0) continue;
    const ctx = contextOf(record.startedAt, record.monoMode) ?? undefined;
    state = decayState(state, record.state);
    for (const credit of credits) {
      state = updateArm(state, record.state, credit.armId, credit.reward, ctx);
    }
  }
  return state;
}
