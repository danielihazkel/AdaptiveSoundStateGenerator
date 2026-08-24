/**
 * Pattern-mode rhythm math (pure, no Web Audio). A rhythm is a repeating
 * 4-beat bar of pulses; `complexity` (0..1) continuously fades subdivisions
 * and accents in and out. Continuity in complexity is the load-bearing
 * property: programs ramp complexity over minutes, and any discrete pattern
 * switch would be an audible glitch. At complexity 0 the bar is four equal
 * quarter-note pulses — the same steady feel as the legacy sine LFO.
 */

export const BEATS_PER_BAR = 4;

export interface PulseEvent {
  /** Offset within the bar, in beats (0 ≤ atBeat < 4). */
  atBeat: number;
  /**
   * Accent weight, multiplies modulation depth. 0..1 for ordinary pulses;
   * the bar downbeat may reach MAX_PULSE_WEIGHT. A weight of 0 means the
   * pulse is silent at this complexity (it is omitted from the bar).
   */
  weight: number;
}

/**
 * Downbeat accent ceiling. The engine divides depth by this before scaling,
 * so effective modulation never exceeds the profile depth and the modulator's
 * limiter-safe invariant (gain ∈ [1 - depth, 1]) holds.
 */
export const MAX_PULSE_WEIGHT = 1.15;

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** How strongly off-beat 8ths sound at complexity c (fade in from c≈0.25). */
function eighthWeight(c: number): number {
  return smoothstep((c - 0.25) / 0.35) * 0.5;
}

/** 16th-note ghost fills before the bar turnaround (fade in from c≈0.6). */
function ghostWeight(c: number): number {
  return smoothstep((c - 0.6) / 0.3) * 0.35;
}

/** Backbeat dip on beats 2 and 4 grows with complexity. */
function backbeatWeight(c: number): number {
  return 1 - smoothstep(c / 0.6) * 0.3;
}

/** Downbeat accent grows from 1 toward MAX_PULSE_WEIGHT. */
function downbeatWeight(c: number): number {
  return 1 + smoothstep((c - 0.15) / 0.5) * (MAX_PULSE_WEIGHT - 1);
}

/**
 * One bar of pulses at the given complexity, sorted by beat offset.
 * Zero-weight pulses are omitted so the scheduler skips them entirely.
 */
export function buildBar(complexity: number): PulseEvent[] {
  const c = clamp01(complexity);
  const events: PulseEvent[] = [
    { atBeat: 0, weight: downbeatWeight(c) },
    { atBeat: 1, weight: backbeatWeight(c) },
    { atBeat: 2, weight: 1 },
    { atBeat: 3, weight: backbeatWeight(c) },
  ];
  const eighth = eighthWeight(c);
  if (eighth > 0) {
    for (const atBeat of [0.5, 1.5, 2.5, 3.5]) events.push({ atBeat, weight: eighth });
  }
  const ghost = ghostWeight(c);
  if (ghost > 0) {
    events.push({ atBeat: 3.25, weight: ghost });
    events.push({ atBeat: 3.75, weight: ghost });
  }
  return events.sort((a, b) => a.atBeat - b.atBeat);
}

/**
 * Pulse envelope width as a fraction of one beat interval. Wide, soft pulses
 * at low complexity (near-sinusoidal feel); tighter, more articulate pulses
 * as complexity rises — also keeps 8th/16th subdivisions from overlapping.
 */
export function pulseWidthFraction(complexity: number): number {
  const c = clamp01(complexity);
  return 0.9 - smoothstep(c) * 0.5; // 0.9 → 0.4
}
