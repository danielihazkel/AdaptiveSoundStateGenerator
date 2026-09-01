import type { ProgramModulation } from '../programs/evaluator';
import type { ArcModulation } from '../session/evolution';
import type { BreathPattern } from './breathing';
import {
  AMBIENCE_TRIM,
  BASS_MAX_DB,
  BINAURAL_TRIM,
  BREATH_MIN_DEPTH,
  HARMONY_TRIM,
  MONO_SUBSTITUTE_MIN_DEPTH,
  NOISE_TRIM,
  TONE_TRIM,
} from './mixPolicy';
import { MAX_PULSE_RATE_HZ } from './states';
import type { AmbienceType, NoiseType, SoundProfile } from './types';

/**
 * The pure half of AudioEngine.applyAll: everything the engine needs to know
 * to drive its node graph, computed from the profile and its three side
 * channels (evolution arc, timed program, guided breathing) plus the mono
 * fallback. No audio objects touched — fully unit-testable.
 *
 * Every level here already includes its per-layer trim and is 0 when the
 * layer is disabled, so the engine only ramps values.
 */
export interface ComposeInput {
  profile: SoundProfile;
  arc: ArcModulation;
  program: ProgramModulation | null;
  breath: BreathPattern | null;
  monoMode: boolean;
}

export type PulseParams =
  | { mode: 'breath'; pattern: BreathPattern; depth: number }
  | { mode: 'pattern'; bpm: number; complexity: number; depth: number }
  | { mode: 'simple'; rate: number; depth: number };

export interface EffectiveParams {
  tone: { frequency: number; warmth: number; level: number };
  binaural: { carrier: number; beat: number; level: number };
  noise: { type: NoiseType; level: number };
  ambience: { type: AmbienceType; level: number };
  ambience2: { type: AmbienceType; level: number };
  pulse: PulseParams;
  harmony: {
    rootHz: number;
    richness: number;
    movement: number;
    softness: number;
    level: number;
  };
  /** Low-shelf gain in dB (0..BASS_MAX_DB). */
  bassDb: number;
  stereoWidth: number;
  lowpassHz: number;
}

export function composeEffectiveParams(input: ComposeInput): EffectiveParams {
  const p = input.profile;
  const mod = input.arc;
  const pm = input.program;
  const substitute = input.monoMode && p.binaural.enabled;

  // Arc composition (PRD §12): the beat drifts by an offset, every layer
  // level and the pulse depth scale with the arc intensity, and the lowpass
  // can darken. The states.ts coherence rule survives modulation: a pulse
  // rate that tracked the base beat tracks the modulated beat. An active
  // program replaces the arc: its segment intensity/lowpass take over, its
  // texture scalers multiply per-layer levels, and the beat stays unshifted
  // (programs shape rhythm through BPM, not beat offsets).
  const beat = Math.max(0.5, p.binaural.beat + (pm ? 0 : mod.beatOffsetHz));
  const trackingBeat =
    p.isochronic.rate === Math.min(p.binaural.beat, MAX_PULSE_RATE_HZ);
  const arcGain = pm ? pm.intensity : mod.intensity;
  const lowpassHz = Math.max(
    200,
    p.lowpassHz * (pm ? pm.lowpassScale : mod.lowpassScale),
  );
  const noiseScale = pm?.noiseScale ?? 1;
  const ambienceScale = pm?.ambienceScale ?? 1;
  const toneScale = pm?.toneScale ?? 1;
  const harmonyScale = pm?.harmonyScale ?? 1;
  const bassScale = pm?.bassScale ?? 1;
  // A program segment may override tone warmth; it softens the pad too.
  const warmth = pm && pm.warmth !== null ? pm.warmth : p.tone.warmth;

  const toneEnabled = substitute ? true : p.tone.enabled;
  const toneFrequency = substitute ? p.binaural.carrier : p.tone.frequency;
  const toneLevel = (substitute ? p.binaural.level : p.tone.level) * arcGain * toneScale;
  const isoEnabled = substitute ? true : p.isochronic.enabled;
  const isoRate = substitute
    ? beat
    : trackingBeat
      ? Math.min(beat, MAX_PULSE_RATE_HZ)
      : p.isochronic.rate;
  const isoDepth =
    (substitute
      ? Math.max(p.isochronic.enabled ? p.isochronic.depth : 0, MONO_SUBSTITUTE_MIN_DEPTH)
      : p.isochronic.depth) * arcGain;

  // Mono substitution stays on the simple path: its pulsed-tone stand-in
  // for binaural must track the beat rate, not a musical BPM grid. Guided
  // breathing comes next: the user asked to breathe with the sound, so the
  // swell gets a floor even where the state's own pulse is nearly flat.
  const patternRhythm = substitute ? null : (pm?.rhythm ?? null);
  const patternMode =
    !substitute && (patternRhythm !== null || p.rhythm.mode === 'pattern');
  const breath = substitute ? null : input.breath;
  let pulse: PulseParams;
  if (breath) {
    pulse = {
      mode: 'breath',
      pattern: breath,
      depth: Math.max(isoEnabled ? isoDepth : 0, BREATH_MIN_DEPTH),
    };
  } else if (patternMode) {
    pulse = {
      mode: 'pattern',
      bpm: patternRhythm?.bpm ?? p.rhythm.bpm,
      complexity: patternRhythm?.complexity ?? p.rhythm.complexity,
      depth: isoEnabled ? isoDepth : 0,
    };
  } else {
    pulse = { mode: 'simple', rate: isoRate, depth: isoEnabled ? isoDepth : 0 };
  }

  return {
    tone: {
      frequency: toneFrequency,
      warmth,
      level: toneEnabled ? toneLevel * TONE_TRIM : 0,
    },
    binaural: {
      carrier: p.binaural.carrier,
      beat,
      level: p.binaural.enabled && !substitute ? p.binaural.level * arcGain * BINAURAL_TRIM : 0,
    },
    noise: {
      type: p.noise.type,
      level: p.noise.enabled ? p.noise.level * arcGain * noiseScale * NOISE_TRIM[p.noise.type] : 0,
    },
    ambience: {
      type: p.ambience.type,
      level: p.ambience.enabled
        ? p.ambience.level * arcGain * ambienceScale * AMBIENCE_TRIM[p.ambience.type]
        : 0,
    },
    // The second bed follows the same arc gain and program swell: a program
    // that lifts ambience lifts the whole bed.
    ambience2: {
      type: p.ambience2.type,
      level: p.ambience2.enabled
        ? p.ambience2.level * arcGain * ambienceScale * AMBIENCE_TRIM[p.ambience2.type]
        : 0,
    },
    pulse,
    harmony: {
      rootHz: p.harmony.rootHz,
      richness: p.harmony.richness,
      movement: p.harmony.movement,
      softness: warmth,
      level: p.harmony.enabled ? p.harmony.level * arcGain * harmonyScale * HARMONY_TRIM : 0,
    },
    bassDb: BASS_MAX_DB * Math.min(1, p.bass * bassScale),
    stereoWidth: p.stereoWidth,
    lowpassHz,
  };
}
