/**
 * Guided breathing patterns. A pattern is a cycle of timed phases; the pulse
 * modulator swells the whole mix with the breath (loud on the inhale peak,
 * quiet at the end of the exhale, flat through holds) and the on-screen
 * pacer shows the same phases — both are pure functions of elapsed time on
 * this module, so sound and visual agree by construction.
 *
 * The simple isochronic pulse cannot express holds (it is a symmetric sine
 * and its rate is clamped ≥ 0.1 Hz), which is why box / 4-7-8 breathing get
 * their own scheduled envelope instead of a profile tweak.
 */

export type BreathPhaseLabel = 'in' | 'hold' | 'out';

export interface BreathPhase {
  label: BreathPhaseLabel;
  seconds: number;
}

export type BreathingPatternId = 'pulse' | 'box' | 'relax478' | 'coherent';

export interface BreathPattern {
  id: BreathingPatternId;
  label: string;
  phases: BreathPhase[];
}

/** The user-selectable patterns; 'pulse' follows the state's own slow pulse. */
export const BREATH_PATTERNS: Record<Exclude<BreathingPatternId, 'pulse'>, BreathPattern> = {
  box: {
    id: 'box',
    label: 'Box 4-4-4-4',
    phases: [
      { label: 'in', seconds: 4 },
      { label: 'hold', seconds: 4 },
      { label: 'out', seconds: 4 },
      { label: 'hold', seconds: 4 },
    ],
  },
  relax478: {
    id: 'relax478',
    label: '4-7-8',
    phases: [
      { label: 'in', seconds: 4 },
      { label: 'hold', seconds: 7 },
      { label: 'out', seconds: 8 },
    ],
  },
  coherent: {
    id: 'coherent',
    label: 'Coherent 5.5 s',
    phases: [
      { label: 'in', seconds: 5.5 },
      { label: 'out', seconds: 5.5 },
    ],
  },
};

export const BREATHING_PATTERN_IDS: BreathingPatternId[] = ['pulse', 'box', 'relax478', 'coherent'];

export function isBreathingPatternId(value: unknown): value is BreathingPatternId {
  return typeof value === 'string' && (BREATHING_PATTERN_IDS as string[]).includes(value);
}

/** Symmetric in/out cycle matching a slow isochronic pulse (calm's 0.1 Hz). */
export function pulseDerivedPattern(rateHz: number): BreathPattern {
  const half = 1 / rateHz / 2;
  return {
    id: 'pulse',
    label: 'Follow the pulse',
    phases: [
      { label: 'in', seconds: half },
      { label: 'out', seconds: half },
    ],
  };
}

export function patternPeriodSec(pattern: BreathPattern): number {
  return pattern.phases.reduce((sum, p) => sum + p.seconds, 0);
}

export interface BreathPhaseAt {
  index: number;
  label: BreathPhaseLabel;
  /** Seconds into this phase. */
  phaseElapsedSec: number;
  /** Seconds until the next phase starts. */
  remainingSec: number;
  /** Seconds into the cycle. */
  cycleElapsedSec: number;
}

/** Which phase is playing at `tSec` seconds since the cycle anchor (t may be negative). */
export function breathPhaseAt(pattern: BreathPattern, tSec: number): BreathPhaseAt {
  const period = patternPeriodSec(pattern);
  const cycleElapsedSec = ((tSec % period) + period) % period;
  let offset = 0;
  for (let i = 0; i < pattern.phases.length; i++) {
    const phase = pattern.phases[i];
    const last = i === pattern.phases.length - 1;
    if (cycleElapsedSec < offset + phase.seconds || last) {
      const phaseElapsedSec = cycleElapsedSec - offset;
      return {
        index: i,
        label: phase.label,
        phaseElapsedSec,
        remainingSec: Math.max(0, phase.seconds - phaseElapsedSec),
        cycleElapsedSec,
      };
    }
    offset += phase.seconds;
  }
  // Unreachable: the last phase always matches.
  throw new Error('breath pattern has no phases');
}

/** Raised-cosine 0 → 1. */
function ease(x: number): number {
  return 0.5 * (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x))));
}

/**
 * Fullness of the breath, 0..1: rises over an inhale, falls over an exhale,
 * and holds whatever level the previous phase reached. Continuous at every
 * phase boundary (an 'out' starts at 1 and a hold after it stays at 0).
 */
export function breathEnvelopeAt(pattern: BreathPattern, tSec: number): number {
  const at = breathPhaseAt(pattern, tSec);
  const phase = pattern.phases[at.index];
  const x = phase.seconds > 0 ? at.phaseElapsedSec / phase.seconds : 1;
  switch (phase.label) {
    case 'in':
      return ease(x);
    case 'out':
      return 1 - ease(x);
    case 'hold':
      return levelBeforePhase(pattern, at.index);
  }
}

/** The envelope level a hold inherits: 1 after an inhale, 0 after an exhale. */
export function levelBeforePhase(pattern: BreathPattern, index: number): number {
  const n = pattern.phases.length;
  for (let k = 1; k <= n; k++) {
    const prev = pattern.phases[(((index - k) % n) + n) % n];
    if (prev.label === 'in') return 1;
    if (prev.label === 'out') return 0;
  }
  return 0;
}
