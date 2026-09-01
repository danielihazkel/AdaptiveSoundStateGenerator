import { STATES, clamp01, type MentalState } from '../audio/states';
import {
  AMBIENCE_TYPES,
  NOISE_TYPES,
  normalizeProfile,
  type AmbienceType,
  type NoiseType,
  type SoundProfile,
} from '../audio/types';
import { newId } from '../storage/id';

/**
 * Timed sound-design programs: a session as an ordered list of absolute-time
 * segments ("0–3 min warm ambience 70–80 BPM, 3–8 min rhythmic pulse…").
 * Programs are user-authored, persisted like presets, and drive the engine
 * through the same side-channel contract as evolution arcs — see evaluator.ts.
 */

export interface ProgramSegment {
  id: string;
  /** Minutes from session start. Contiguous: equals the previous endMin. */
  startMin: number;
  /** Minutes from session start; null only on the last segment ("25+"). */
  endMin: number | null;
  label: string;
  description?: string;
  /** 0..1 — scales layer levels and pulse depth, like arc intensity. */
  intensity: number;
  /** Pulse tempo drifts deterministically inside [min, max]. */
  bpmRange: [number, number];
  /** 0..1 — rhythmic complexity (subdivisions/accents fade in). */
  complexity: number;
  /** Optional texture scalers over the base profile; absent = 1. */
  noiseScale?: number; // 0..2
  ambienceScale?: number; // 0..2
  toneScale?: number; // 0..2
  lowpassScale?: number; // 0.3..1
  harmonyScale?: number; // 0..2
  bassScale?: number; // 0..2
  /** Absolute override of tone warmth (0..1); absent = profile warmth. */
  warmth?: number;
  /**
   * Absolute sound overrides (Phase 9): a phase can move the binaural beat,
   * the carrier, the noise colour, the ambience type, or the pad's richness
   * instead of only scaling levels. Absent = the base profile's value.
   * Numeric overrides crossfade at phase boundaries like warmth; the two
   * discrete ones switch at the boundary and the worklets glide the switch.
   */
  beatHz?: number; // 0.5..40
  carrierHz?: number; // 20..1500
  noiseType?: NoiseType;
  ambienceType?: AmbienceType;
  harmonyRichness?: number; // 0..1
  /** Absolute reverb wet level (0..1); absent = the base profile's space. */
  space?: number;
}

export interface Program {
  id: string;
  name: string;
  createdAt: string; // ISO
  /** End-fade behavior, warnings, and the default base sound come from here. */
  baseState: MentalState;
  baseIntensity: number; // 0..1
  /** Snapshot at save time so later states.ts tweaks don't change saved programs. */
  baseProfile: SoundProfile;
  /** ≥1 segments, sorted, contiguous from minute 0. */
  segments: ProgramSegment[];
  /**
   * Overrides the base state's end.chime — a sleep-based nap program can
   * request a wake chime. Absent = defer to the state (the historic behavior).
   */
  endChime?: boolean;
  /** Play the chime at every phase boundary (interval programs). Absent = no. */
  boundaryChime?: boolean;
}

const MIN_BPM = 30;
const MAX_BPM = 200;
const MAX_SEGMENT_MIN = 24 * 60;

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function optionalScale(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function isMentalState(value: unknown): value is MentalState {
  return typeof value === 'string' && value in STATES;
}

function normalizeSegment(raw: unknown, index: number): ProgramSegment {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bpmRaw = Array.isArray(s.bpmRange) ? s.bpmRange : [];
  const bpmA = num(bpmRaw[0], 80, MIN_BPM, MAX_BPM);
  const bpmB = num(bpmRaw[1], bpmA, MIN_BPM, MAX_BPM);
  const segment: ProgramSegment = {
    id: str(s.id, newId()),
    startMin: num(s.startMin, 0, 0, MAX_SEGMENT_MIN),
    endMin:
      s.endMin === null || s.endMin === undefined
        ? null
        : num(s.endMin, 0, 0, MAX_SEGMENT_MIN),
    label: str(s.label, `Phase ${index + 1}`),
    intensity: num(s.intensity, 0.5, 0, 1),
    bpmRange: [Math.min(bpmA, bpmB), Math.max(bpmA, bpmB)],
    complexity: num(s.complexity, 0, 0, 1),
  };
  if (typeof s.description === 'string' && s.description.length > 0) {
    segment.description = s.description;
  }
  const noiseScale = optionalScale(s.noiseScale, 0, 2);
  const ambienceScale = optionalScale(s.ambienceScale, 0, 2);
  const toneScale = optionalScale(s.toneScale, 0, 2);
  const lowpassScale = optionalScale(s.lowpassScale, 0.3, 1);
  const harmonyScale = optionalScale(s.harmonyScale, 0, 2);
  const bassScale = optionalScale(s.bassScale, 0, 2);
  const warmth = optionalScale(s.warmth, 0, 1);
  if (noiseScale !== undefined) segment.noiseScale = noiseScale;
  if (ambienceScale !== undefined) segment.ambienceScale = ambienceScale;
  if (toneScale !== undefined) segment.toneScale = toneScale;
  if (lowpassScale !== undefined) segment.lowpassScale = lowpassScale;
  if (harmonyScale !== undefined) segment.harmonyScale = harmonyScale;
  if (bassScale !== undefined) segment.bassScale = bassScale;
  if (warmth !== undefined) segment.warmth = warmth;
  // Sound overrides — same ranges as normalizeProfile's for the same fields.
  const beatHz = optionalScale(s.beatHz, 0.5, 40);
  const carrierHz = optionalScale(s.carrierHz, 20, 1500);
  const noiseType = optionalOneOf(s.noiseType, NOISE_TYPES);
  const ambienceType = optionalOneOf(s.ambienceType, AMBIENCE_TYPES);
  const harmonyRichness = optionalScale(s.harmonyRichness, 0, 1);
  const space = optionalScale(s.space, 0, 1);
  if (beatHz !== undefined) segment.beatHz = beatHz;
  if (carrierHz !== undefined) segment.carrierHz = carrierHz;
  if (noiseType !== undefined) segment.noiseType = noiseType;
  if (ambienceType !== undefined) segment.ambienceType = ambienceType;
  if (harmonyRichness !== undefined) segment.harmonyRichness = harmonyRichness;
  if (space !== undefined) segment.space = space;
  return segment;
}

/**
 * Completes and sanitizes a program of any vintage — the Program counterpart
 * of normalizeProfile. Clamps every field, sorts segments, repairs contiguity
 * (each start := previous end), closes any non-final open segment, guarantees
 * at least one segment, and normalizes the base profile.
 */
export function normalizeProgram(raw: unknown): Program {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const baseState = isMentalState(p.baseState) ? p.baseState : 'focus';
  const baseIntensity = num(p.baseIntensity, 0.5, 0, 1);

  const rawSegments = Array.isArray(p.segments) ? p.segments : [];
  let segments = rawSegments.map(normalizeSegment);
  if (segments.length === 0) {
    segments = [
      {
        id: newId(),
        startMin: 0,
        endMin: null,
        label: 'Phase 1',
        intensity: 0.5,
        bpmRange: [70, 80],
        complexity: 0,
      },
    ];
  }
  segments.sort((a, b) => a.startMin - b.startMin);
  // Repair contiguity from minute 0 and close every non-final segment.
  let cursor = 0;
  segments.forEach((segment, i) => {
    segment.startMin = cursor;
    const last = i === segments.length - 1;
    if (last) {
      if (segment.endMin !== null && segment.endMin <= segment.startMin) {
        segment.endMin = null;
      }
    } else {
      const end = segment.endMin ?? segment.startMin + 5;
      segment.endMin = Math.max(end, segment.startMin + 1);
      cursor = segment.endMin;
    }
  });

  const program: Program = {
    id: str(p.id, newId()),
    name: str(p.name, 'Untitled program'),
    createdAt: str(p.createdAt, new Date().toISOString()),
    baseState,
    baseIntensity,
    baseProfile: normalizeProfile(p.baseProfile ?? STATES[baseState].buildProfile(baseIntensity)),
    segments,
  };
  // Only materialize an explicit true — absent stays absent so old programs
  // round-trip identically through the normalizer.
  if (p.endChime === true) program.endChime = true;
  if (p.boundaryChime === true) program.boundaryChime = true;
  return program;
}

/** Sum of the closed segments in seconds — the minimum session duration. */
export function programMinDurationSec(program: Program): number {
  const last = program.segments[program.segments.length - 1];
  return (last.endMin ?? last.startMin) * 60;
}

/**
 * Seed for new programs: the five-phase build arc that motivated the feature
 * (warm ambience → pulse → complexity → peak → open-ended sustain).
 */
export function defaultProgram(state: MentalState, intensity: number): Program {
  const t = clamp01(intensity);
  const segments: ProgramSegment[] = [
    {
      id: newId(),
      startMin: 0,
      endMin: 3,
      label: 'Warm-up',
      description: 'Warm low-intensity ambience',
      intensity: 0.35 + 0.2 * t,
      bpmRange: [70, 80],
      complexity: 0,
      ambienceScale: 1.4,
    },
    {
      id: newId(),
      startMin: 3,
      endMin: 8,
      label: 'Pulse',
      description: 'Introduce rhythmic pulse',
      intensity: 0.5 + 0.2 * t,
      bpmRange: [85, 90],
      complexity: 0.25,
    },
    {
      id: newId(),
      startMin: 8,
      endMin: 15,
      label: 'Build',
      description: 'Increase rhythmic complexity',
      intensity: 0.6 + 0.2 * t,
      bpmRange: [90, 100],
      complexity: 0.55,
    },
    {
      id: newId(),
      startMin: 15,
      endMin: 25,
      label: 'Peak',
      description: 'Higher intensity',
      intensity: 0.75 + 0.25 * t,
      bpmRange: [95, 110],
      complexity: 0.75,
    },
    {
      id: newId(),
      startMin: 25,
      endMin: null,
      label: 'Sustain',
      description: 'Maintain with slow variation',
      intensity: 0.7 + 0.2 * t,
      bpmRange: [90, 105],
      complexity: 0.6,
    },
  ];
  return {
    id: newId(),
    name: 'New program',
    createdAt: new Date().toISOString(),
    baseState: state,
    baseIntensity: t,
    baseProfile: STATES[state].buildProfile(t),
    segments,
  };
}
