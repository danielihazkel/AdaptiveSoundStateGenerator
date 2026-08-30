import { clamp01, type MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { buildArcProgram, type ArcPhaseSpec } from './templates';
import type { Program } from './types';

/**
 * Interval ("Pomodoro") focus sessions: N work blocks separated by short
 * breaks, generated as an ordinary timed Program from three numbers so the
 * session machinery — phase readout, boundary chimes, MP3 export — is all
 * reused. Generated programs are never saved; the plan is recorded on the
 * session instead (SessionRecord.intervals).
 */
export interface IntervalPlan {
  workMin: number;
  breakMin: number;
  cycles: number;
  /** Play the chime at every work/break switch. */
  boundaryChime: boolean;
}

export const DEFAULT_INTERVALS: IntervalPlan = {
  workMin: 25,
  breakMin: 5,
  cycles: 4,
  boundaryChime: true,
};

export const INTERVAL_LIMITS = {
  work: [5, 90],
  break: [1, 30],
  cycles: [1, 8],
} as const;

export const INTERVAL_STATES: ReadonlySet<MentalState> = new Set<MentalState>([
  'focus',
  'flow',
  'creative',
]);

function clampInt(value: unknown, fallback: number, [min, max]: readonly [number, number]) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeIntervalPlan(raw: unknown): IntervalPlan {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<IntervalPlan>;
  return {
    workMin: clampInt(p.workMin, DEFAULT_INTERVALS.workMin, INTERVAL_LIMITS.work),
    breakMin: clampInt(p.breakMin, DEFAULT_INTERVALS.breakMin, INTERVAL_LIMITS.break),
    cycles: clampInt(p.cycles, DEFAULT_INTERVALS.cycles, INTERVAL_LIMITS.cycles),
    boundaryChime: p.boundaryChime !== false,
  };
}

/** Total session length: no trailing break after the last work block. */
export function intervalTotalSec(plan: IntervalPlan): number {
  return (plan.cycles * plan.workMin + (plan.cycles - 1) * plan.breakMin) * 60;
}

export function intervalProgramName(plan: IntervalPlan): string {
  return `Intervals ${plan.workMin}/${plan.breakMin} ×${plan.cycles}`;
}

/** Work-phase character per state (the Pomodoro template's focus row, adapted). */
const WORK: Record<string, { bpmRange: [number, number]; complexity: number }> = {
  focus: { bpmRange: [82, 92], complexity: 0.35 },
  flow: { bpmRange: [78, 88], complexity: 0.2 },
  creative: { bpmRange: [70, 80], complexity: 0.15 },
};

/**
 * Build the program. The base sound is the selected preset's profile when
 * one is given, otherwise the state's own; breaks soften it — quieter,
 * slower, darker, more ambience — rather than falling silent.
 */
export function buildIntervalProgram(
  state: MentalState,
  intensity: number,
  plan: IntervalPlan,
  baseProfile?: SoundProfile,
): Program {
  const p = normalizeIntervalPlan(plan);
  const work = WORK[state] ?? WORK.focus;
  const phases: ArcPhaseSpec[] = [];
  let endMin = 0;
  for (let c = 1; c <= p.cycles; c++) {
    endMin += p.workMin;
    phases.push({
      endMin,
      label: p.cycles > 1 ? `Work ${c}` : 'Work',
      description: c === 1 ? 'First block' : `Block ${c}`,
      intensity: 0.75,
      bpmRange: work.bpmRange,
      complexity: work.complexity,
      warmth: 0.6,
    });
    if (c < p.cycles) {
      endMin += p.breakMin;
      phases.push({
        endMin,
        label: 'Break',
        description: 'Step away',
        intensity: 0.35,
        bpmRange: [64, 72],
        complexity: 0,
        warmth: 0.85,
        ambienceScale: 1.6,
        lowpassScale: 0.7,
        noiseScale: 0.6,
        toneScale: 0.5,
      });
    }
  }
  return buildArcProgram(state, clamp01(intensity), phases, {
    name: intervalProgramName(p),
    boundaryChime: p.boundaryChime,
    baseProfile,
  });
}
