import type { AmbienceType, NoiseType } from '../audio/types';
import type { Program, ProgramSegment } from './types';

/**
 * Program evaluation: pure and deterministic in elapsed seconds, the same
 * contract as session evolution — the same moment of a session always sounds
 * the same. The engine consumes the result through the side channel
 * (AudioEngine.setProgramModulation), never through the profile, so presets,
 * the bandit, and user-edit detection never see program churn.
 */
export interface ProgramModulation {
  /** Multiplies every layer level and the pulse depth (like arc intensity). */
  intensity: number;
  /** Multiplies the master lowpass cutoff. */
  lowpassScale: number;
  /** Per-segment texture scalers over the base profile, default 1. */
  noiseScale: number;
  ambienceScale: number;
  toneScale: number;
  harmonyScale: number;
  bassScale: number;
  /** Absolute tone-warmth override; null = use the profile's warmth. */
  warmth: number | null;
  /** Pattern-mode pulse target; null = fall back to the profile's rhythm. */
  rhythm: { bpm: number; complexity: number } | null;
  /**
   * Absolute sound overrides (Phase 9); null = the profile's value. Numeric
   * ones crossfade across the boundary window; the discrete ones snap at the
   * boundary and the engine asks the worklets to glide over `typeFadeSec`.
   */
  beatHz: number | null;
  carrierHz: number | null;
  noiseType: NoiseType | null;
  ambienceType: AmbienceType | null;
  harmonyRichness: number | null;
  /** How long a noise-colour / ambience-type switch should take. */
  typeFadeSec: number;
}

/** Numeric outputs blend across [boundary − 15 s, boundary + 15 s]. */
export const SEGMENT_CROSSFADE_SEC = 30;

/**
 * Worklet crossfade for a discrete type change at a phase boundary. Shorter
 * than the numeric window so the new colour has landed by the time the
 * levels finish blending, long enough to read as a dissolve, not a cut.
 */
export const PROGRAM_TYPE_FADE_SEC = 8;

/** Period of the deterministic BPM drift sine within a segment. */
const DRIFT_PERIOD_SEC = 150;

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function segmentIndexAt(program: Program, elapsedSec: number): number {
  const minutes = elapsedSec / 60;
  const segments = program.segments;
  for (let i = 0; i < segments.length; i++) {
    const end = segments[i].endMin;
    if (end === null || minutes < end) return i;
  }
  return segments.length - 1;
}

/**
 * BPM drift: a slow sine inside [min, max], phase-offset per segment index so
 * consecutive segments never sync. Deterministic — no randomness.
 */
function driftBpm(segment: ProgramSegment, index: number, elapsedSec: number): number {
  const [min, max] = segment.bpmRange;
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  const phase = index * 1.7;
  return mid + half * Math.sin((2 * Math.PI * elapsedSec) / DRIFT_PERIOD_SEC + phase);
}

interface SegmentValues {
  intensity: number;
  lowpassScale: number;
  noiseScale: number;
  ambienceScale: number;
  toneScale: number;
  harmonyScale: number;
  bassScale: number;
  warmth: number | null;
  bpm: number;
  complexity: number;
  beatHz: number | null;
  carrierHz: number | null;
  noiseType: NoiseType | null;
  ambienceType: AmbienceType | null;
  harmonyRichness: number | null;
}

function valuesAt(program: Program, index: number, elapsedSec: number): SegmentValues {
  const segment = program.segments[index];
  return {
    intensity: segment.intensity,
    lowpassScale: segment.lowpassScale ?? 1,
    noiseScale: segment.noiseScale ?? 1,
    ambienceScale: segment.ambienceScale ?? 1,
    toneScale: segment.toneScale ?? 1,
    harmonyScale: segment.harmonyScale ?? 1,
    bassScale: segment.bassScale ?? 1,
    warmth: segment.warmth ?? null,
    bpm: driftBpm(segment, index, elapsedSec),
    complexity: segment.complexity,
    beatHz: segment.beatHz ?? null,
    carrierHz: segment.carrierHz ?? null,
    noiseType: segment.noiseType ?? null,
    ambienceType: segment.ambienceType ?? null,
    harmonyRichness: segment.harmonyRichness ?? null,
  };
}

/**
 * Null-aware lerp for an optional absolute override: an override only on one
 * side snaps at the window edge — inaudible under the engine's τ=2 s glide,
 * and the shipped templates set warmth on every segment so this path never
 * triggers in practice.
 */
function mixOptional(a: number | null, b: number | null, t: number): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return a + (b - a) * t;
}

/** A discrete override switches at the boundary (blend 0.5), null-aware. */
function pickDiscrete<T>(a: T | null, b: T | null, t: number): T | null {
  return t >= 0.5 ? (b ?? a) : (a ?? b);
}

function mix(a: SegmentValues, b: SegmentValues, t: number): SegmentValues {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    intensity: lerp(a.intensity, b.intensity),
    lowpassScale: lerp(a.lowpassScale, b.lowpassScale),
    noiseScale: lerp(a.noiseScale, b.noiseScale),
    ambienceScale: lerp(a.ambienceScale, b.ambienceScale),
    toneScale: lerp(a.toneScale, b.toneScale),
    harmonyScale: lerp(a.harmonyScale, b.harmonyScale),
    bassScale: lerp(a.bassScale, b.bassScale),
    warmth: mixOptional(a.warmth, b.warmth, t),
    bpm: lerp(a.bpm, b.bpm),
    complexity: lerp(a.complexity, b.complexity),
    beatHz: mixOptional(a.beatHz, b.beatHz, t),
    carrierHz: mixOptional(a.carrierHz, b.carrierHz, t),
    noiseType: pickDiscrete(a.noiseType, b.noiseType, t),
    ambienceType: pickDiscrete(a.ambienceType, b.ambienceType, t),
    harmonyRichness: mixOptional(a.harmonyRichness, b.harmonyRichness, t),
  };
}

export function evaluateProgram(program: Program, elapsedSec: number): ProgramModulation {
  const t = Math.max(0, elapsedSec);
  const index = segmentIndexAt(program, t);
  let values = valuesAt(program, index, t);

  // Smoothstep-blend across each shared boundary's crossfade window. Both
  // neighbors are evaluated at the same elapsed time, so their drift curves
  // blend continuously.
  const half = SEGMENT_CROSSFADE_SEC / 2;
  const prevBoundary = program.segments[index].startMin * 60;
  const nextEnd = program.segments[index].endMin;
  if (index > 0 && t < prevBoundary + half) {
    const blend = smoothstep((t - (prevBoundary - half)) / SEGMENT_CROSSFADE_SEC);
    values = mix(valuesAt(program, index - 1, t), values, blend);
  } else if (index < program.segments.length - 1 && nextEnd !== null) {
    const boundary = nextEnd * 60;
    if (t > boundary - half) {
      const blend = smoothstep((t - (boundary - half)) / SEGMENT_CROSSFADE_SEC);
      values = mix(values, valuesAt(program, index + 1, t), blend);
    }
  }

  return {
    intensity: values.intensity,
    lowpassScale: values.lowpassScale,
    noiseScale: values.noiseScale,
    ambienceScale: values.ambienceScale,
    toneScale: values.toneScale,
    harmonyScale: values.harmonyScale,
    bassScale: values.bassScale,
    warmth: values.warmth,
    rhythm: { bpm: values.bpm, complexity: values.complexity },
    beatHz: values.beatHz,
    carrierHz: values.carrierHz,
    noiseType: values.noiseType,
    ambienceType: values.ambienceType,
    harmonyRichness: values.harmonyRichness,
    typeFadeSec: PROGRAM_TYPE_FADE_SEC,
  };
}

/** Current segment plus the countdown to the next — for the session UI. */
export function segmentAt(
  program: Program,
  elapsedSec: number,
): { segment: ProgramSegment; index: number; nextIn: number | null } {
  const t = Math.max(0, elapsedSec);
  const index = segmentIndexAt(program, t);
  const segment = program.segments[index];
  const end = segment.endMin;
  const nextIn =
    index < program.segments.length - 1 && end !== null ? Math.max(0, end * 60 - t) : null;
  return { segment, index, nextIn };
}
