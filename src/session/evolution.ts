import type { MentalState } from '../audio/states';

/**
 * Session evolution (PRD §12): the sound shouldn't stay static for an hour.
 * Each state has a designed arc over normalized session time t ∈ [0, 1] —
 * ramp-in, rise to a plateau, hold, then an ease-down whose tail lands in the
 * per-state end fade. Arcs are pure data evaluated by a pure function; the
 * engine applies the result *below* the profile abstraction, so presets, the
 * bandit, and user-edit detection never see arc churn (see
 * AudioEngine.setArcModulation). Everything is deterministic in t: no
 * randomness, so the same moment of a session always sounds the same.
 */

export interface ArcPoint {
  at: number; // normalized session time, 0..1
  value: number;
}

/** Piecewise curve: smoothstep-eased between points, clamped outside them. */
export interface ArcTrack {
  points: ArcPoint[]; // sorted ascending by `at`
}

export interface ArcDefinition {
  /** Multiplies every layer level and the isochronic depth. */
  intensity: ArcTrack;
  /** Added to the binaural beat (the §12 "10 → 15 → stable → 12" motion). */
  beatOffsetHz: ArcTrack;
  /** Multiplies the master lowpass cutoff (sleep darkens as it descends). */
  lowpassScale: ArcTrack;
}

export interface ArcModulation {
  intensity: number;
  beatOffsetHz: number;
  lowpassScale: number;
}

export const IDENTITY_MODULATION: ArcModulation = {
  intensity: 1,
  beatOffsetHz: 0,
  lowpassScale: 1,
};

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

export function evaluateTrack(track: ArcTrack, t: number): number {
  const points = track.points;
  if (points.length === 0) return 1;
  if (t <= points[0].at) return points[0].value;
  const last = points[points.length - 1];
  if (t >= last.at) return last.value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (t > b.at) continue;
    const a = points[i - 1];
    const x = (t - a.at) / (b.at - a.at);
    return a.value + (b.value - a.value) * smoothstep(x);
  }
  return last.value;
}

export function evaluateArc(def: ArcDefinition, t01: number): ArcModulation {
  const t = Math.min(1, Math.max(0, t01));
  return {
    intensity: evaluateTrack(def.intensity, t),
    beatOffsetHz: evaluateTrack(def.beatOffsetHz, t),
    lowpassScale: evaluateTrack(def.lowpassScale, t),
  };
}

const FLAT: ArcTrack = { points: [{ at: 0, value: 1 }] };

/** Where a wake-up rise lands: full intensity, open filter, a faster beat. */
export const WAKE_UP_TARGET: ArcModulation = {
  intensity: 1,
  beatOffsetHz: 3,
  lowpassScale: 1,
};

/** Sampling step used to preserve a sparse base track's shape up to the knee. */
const RISE_SAMPLE_STEP = 0.05;

function withRise(track: ArcTrack, knee: number, target: number): ArcTrack {
  // Re-sample the base up to the knee: a base segment that straddles the knee
  // (sleep's single 0 → 1 descent) would otherwise be re-eased between its
  // last kept point and the knee and change shape before the rise begins.
  const points: ArcPoint[] = [];
  for (let at = 0; at < knee - 1e-9; at += RISE_SAMPLE_STEP) {
    points.push({ at, value: evaluateTrack(track, at) });
  }
  points.push({ at: knee, value: evaluateTrack(track, knee) }, { at: 1, value: target });
  return { points };
}

/**
 * Wake-up variant of an arc: identical up to the knee at 1 - riseFraction,
 * then a smooth rise to WAKE_UP_TARGET over the last part of the session
 * (louder, brighter, a faster beat - sleep's tracking pulse follows it). The
 * base arc's own tail is dropped: a sleep arc that only ever descends would
 * otherwise fight the rise.
 */
export function withWakeUp(base: ArcDefinition, riseFraction: number): ArcDefinition {
  const knee = 1 - Math.min(0.9, Math.max(0.01, riseFraction));
  return {
    intensity: withRise(base.intensity, knee, WAKE_UP_TARGET.intensity),
    beatOffsetHz: withRise(base.beatOffsetHz, knee, WAKE_UP_TARGET.beatOffsetHz),
    lowpassScale: withRise(base.lowpassScale, knee, WAKE_UP_TARGET.lowpassScale),
  };
}

export interface WakeUp {
  /** Length of the closing rise, in seconds. */
  riseSec: number;
}

/** The arc a plain (non-program) session follows; the state's own arc when no wake-up. */
export function resolveArc(
  state: MentalState,
  opts: { wakeUp?: WakeUp; durationSec: number },
): ArcDefinition {
  const base = STATE_ARCS[state];
  if (!opts.wakeUp || opts.durationSec <= 0) return base;
  return withWakeUp(base, opts.wakeUp.riseSec / opts.durationSec);
}

/**
 * Per-state arcs. Offsets stay small so `beat + offset` remains inside each
 * state's character band (the engine still clamps ≥ 0.5 Hz). Focus/energy
 * ramp in below the plateau and ease down at the end; relax/meditation
 * (PRD §8 variation: medium) add one slow deterministic undulation across the
 * plateau; sleep only ever descends — darker, slower, softer — with no rise.
 * Arousal builds in gently, swells once across the plateau, and eases down
 * while the filter warms.
 */
export const STATE_ARCS: Record<MentalState, ArcDefinition> = {
  focus: {
    intensity: {
      points: [
        { at: 0, value: 0.85 },
        { at: 0.12, value: 1 },
        { at: 0.8, value: 1 },
        { at: 1, value: 0.9 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: -2 },
        { at: 0.35, value: 0 },
        { at: 0.75, value: 0 },
        { at: 1, value: -1.5 },
      ],
    },
    lowpassScale: FLAT,
  },
  relax: {
    intensity: {
      points: [
        { at: 0, value: 1 },
        { at: 0.25, value: 0.92 },
        { at: 0.5, value: 0.97 },
        { at: 0.75, value: 0.88 },
        { at: 1, value: 0.85 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: 0 },
        { at: 0.5, value: -1 },
        { at: 0.72, value: -0.6 },
        { at: 1, value: -1.5 },
      ],
    },
    lowpassScale: {
      points: [
        { at: 0, value: 1 },
        { at: 1, value: 0.85 },
      ],
    },
  },
  sleep: {
    intensity: {
      points: [
        { at: 0, value: 1 },
        { at: 1, value: 0.8 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: 0 },
        { at: 1, value: -1.5 },
      ],
    },
    lowpassScale: {
      points: [
        { at: 0, value: 1 },
        { at: 1, value: 0.6 },
      ],
    },
  },
  energy: {
    intensity: {
      points: [
        { at: 0, value: 0.85 },
        { at: 0.15, value: 1 },
        { at: 0.85, value: 1 },
        { at: 1, value: 0.92 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: -3 },
        { at: 0.3, value: 0 },
        { at: 0.8, value: 0 },
        { at: 1, value: -2 },
      ],
    },
    lowpassScale: FLAT,
  },
  meditation: {
    intensity: {
      points: [
        { at: 0, value: 0.9 },
        { at: 0.2, value: 1 },
        { at: 0.45, value: 0.92 },
        { at: 0.7, value: 1 },
        { at: 1, value: 0.88 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: 0 },
        { at: 0.6, value: -1 },
        { at: 0.8, value: -0.6 },
        { at: 1, value: -1.2 },
      ],
    },
    lowpassScale: FLAT,
  },
  arousal: {
    intensity: {
      points: [
        { at: 0, value: 0.85 },
        { at: 0.2, value: 1 },
        { at: 0.5, value: 0.94 },
        { at: 0.75, value: 1 },
        { at: 1, value: 0.88 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: 0 },
        { at: 0.55, value: -1 },
        { at: 0.8, value: -0.5 },
        { at: 1, value: -1.5 },
      ],
    },
    lowpassScale: {
      points: [
        { at: 0, value: 1 },
        { at: 1, value: 0.85 },
      ],
    },
  },
  // Flow ramps in from beta (-4 Hz) so the gamma edge builds instead of
  // slamming in, holds the plateau, then eases off for the wrap-up.
  flow: {
    intensity: {
      points: [
        { at: 0, value: 0.8 },
        { at: 0.15, value: 1 },
        { at: 0.8, value: 1 },
        { at: 1, value: 0.9 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: -4 },
        { at: 0.3, value: 0 },
        { at: 0.85, value: 0 },
        { at: 1, value: -2 },
      ],
    },
    lowpassScale: FLAT,
  },
  // Calm settles like relax: a gentle descent with a slight warm-down. The
  // beat offset never touches the 0.1 Hz breathing pulse (it isn't tracking).
  calm: {
    intensity: {
      points: [
        { at: 0, value: 1 },
        { at: 0.3, value: 0.94 },
        { at: 0.6, value: 0.97 },
        { at: 1, value: 0.85 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: 0 },
        { at: 0.6, value: -1 },
        { at: 1, value: -1.5 },
      ],
    },
    lowpassScale: {
      points: [
        { at: 0, value: 1 },
        { at: 1, value: 0.85 },
      ],
    },
  },
  // Creative undulates like meditation — drift down toward theta with one
  // mid-session lift to keep the texture from flatlining.
  creative: {
    intensity: {
      points: [
        { at: 0, value: 0.9 },
        { at: 0.2, value: 1 },
        { at: 0.5, value: 0.92 },
        { at: 0.75, value: 1 },
        { at: 1, value: 0.88 },
      ],
    },
    beatOffsetHz: {
      points: [
        { at: 0, value: 0 },
        { at: 0.5, value: -1 },
        { at: 0.75, value: -0.5 },
        { at: 1, value: -1.2 },
      ],
    },
    lowpassScale: FLAT,
  },
};
