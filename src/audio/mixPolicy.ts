import type { AmbienceType, NoiseType } from './types';

/**
 * Mixing policy shared by the realtime engine, the offline renderer, and the
 * pure composition step (compose.ts): fade times and the per-layer trims that
 * make equal slider values sound roughly equally loud. Tuned by ear.
 */
export const FADE_IN_SECONDS = 1.5; // PRD §13: always fade in, no sudden loud sounds
export const FADE_OUT_SECONDS = 1.0;
export const PAUSE_FADE_SECONDS = 0.3;
export const MONO_SWITCH_DIP_SECONDS = 0.15;
export const CHIME_SECONDS = 2.0;
/** Wake-up alarm: the chime repeats at this spacing until dismissed. */
export const ALARM_REPEAT_SECONDS = 4;
/**
 * Noise-colour / ambience-type crossfade inside the worklets for an ordinary
 * (slider / preset / arm) switch. Programs pass their own, longer fade.
 */
export const TYPE_FADE_SECONDS = 0.1;

/**
 * Per-layer trim so equal slider values sound roughly equally loud (a sine at
 * 0.5 is far louder than pink noise at 0.5). Together with the master limiter
 * and the UI's 0.85 master-volume cap, this is the MVP substitute for the
 * PRD §13 LUFS loudness ceiling. Tuned by ear.
 */
export const TONE_TRIM = 0.5;
export const BINAURAL_TRIM = 0.5;
/** Four equal-power-normalized pad voices — start below TONE_TRIM, tuned by ear. */
export const HARMONY_TRIM = 0.4;
/** Bass low-shelf peak boost; capped here even when a program scales bass up. */
export const BASS_MAX_DB = 6;
export const NOISE_TRIM: Record<NoiseType, number> = {
  white: 0.35,
  pink: 0.5,
  brown: 0.8,
  blue: 0.3,
};
export const AMBIENCE_TRIM: Record<AmbienceType, number> = {
  rain: 0.5,
  ocean: 0.6,
  wind: 0.55,
  space: 0.7,
  forest: 0.6,
  fireplace: 0.6,
  cafe: 0.6,
};

/** Depth floor for the mono-fallback pulse substitution (see engine.ts). */
export const MONO_SUBSTITUTE_MIN_DEPTH = 0.35;
/** Guided breathing must be audible as a swell: relax/meditation pulses are 3-12 % deep. */
export const BREATH_MIN_DEPTH = 0.3;
