import { LOWPASS_OPEN_HZ, type SoundProfile } from './types';

/**
 * Mental state profiles (PRD §8, §15). Each state maps the user-facing
 * intensity slider (0..1, labelled per state — never "Hz") onto a concrete
 * SoundProfile. Focus/relax/sleep numbers come from PRD §8; energy,
 * meditation and arousal are experimental proposals. These are sound
 * environments that may help — not scientifically guaranteed effects (PRD §13).
 *
 * Intensity direction differs by state: relax/sleep/arousal get *deeper* as
 * intensity rises (beat frequency falls), focus/energy get *sharper* (beat
 * rises).
 * The isochronic rate tracks the binaural beat in most states so the engine's
 * mono-fallback substitution stays coherent.
 */
export type MentalState =
  | 'focus'
  | 'relax'
  | 'sleep'
  | 'energy'
  | 'meditation'
  | 'arousal'
  | 'flow'
  | 'calm'
  | 'creative';

export interface StateDefinition {
  id: MentalState;
  label: string;
  emoji: string;
  description: string;
  intensityLabels: [string, string];
  buildProfile(intensity: number): SoundProfile;
  end: {
    fadeSeconds: number;
    chime: 'optional' | 'none';
  };
  noDrivingWarning: boolean;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

const DEFAULT_MASTER_VOLUME = 0.5;

/**
 * Most states use the legacy simple pulse; emitted explicitly (not left to
 * normalizeProfile) so profile fingerprints never differ by field presence.
 * Fresh object per call — profiles are mutated downstream.
 */
function simpleRhythm(): SoundProfile['rhythm'] {
  return { mode: 'simple', bpm: 80, complexity: 0 };
}

/** Same contract as simpleRhythm: emitted explicitly, disabled = legacy sound. */
function disabledHarmony(): SoundProfile['harmony'] {
  return { enabled: false, level: 0.25, richness: 0.5, movement: 0.3, rootHz: 110 };
}

/** The second ambience bed is a user choice, never part of a state prior. */
function disabledAmbience2(): SoundProfile['ambience2'] {
  return { enabled: false, type: 'ocean', level: 0.1 };
}

/** Isochronic pulses above ~16 Hz stop being perceived as rhythm. */
export const MAX_PULSE_RATE_HZ = 16;

export const STATES: Record<MentalState, StateDefinition> = {
  focus: {
    id: 'focus',
    label: 'Focus',
    emoji: '🎯',
    description: 'Steady masking noise with a rising rhythmic edge.',
    intensityLabels: ['Relaxed', 'Intense'],
    end: { fadeSeconds: 1.5, chime: 'optional' },
    noDrivingWarning: false,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      const beat = lerp(10, 18, t);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        tone: { enabled: false, frequency: 220, level: 0.1, warmth: 0.5 },
        binaural: { enabled: true, carrier: 200, beat, level: 0.25 },
        noise: { enabled: true, type: 'brown', level: lerp(0.25, 0.45, t) },
        isochronic: {
          enabled: true,
          rate: Math.min(beat, MAX_PULSE_RATE_HZ),
          depth: lerp(0.06, 0.15, t),
        },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'rain', level: 0.05 }, // PRD §8
        ambience2: disabledAmbience2(),
        harmony: disabledHarmony(),
        bass: 0,
        stereoWidth: 0.7,
        lowpassHz: LOWPASS_OPEN_HZ,
      };
    },
  },
  relax: {
    id: 'relax',
    label: 'Relax',
    emoji: '🧘',
    description: 'Soft pink noise that settles as you sink deeper.',
    intensityLabels: ['Gentle', 'Deep'],
    end: { fadeSeconds: 4, chime: 'none' },
    noDrivingWarning: true,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      const beat = lerp(10, 6, t);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        // Warmth 0.8 softens the harmony pad even with the tone disabled.
        tone: { enabled: false, frequency: 220, level: 0.1, warmth: 0.8 },
        binaural: { enabled: true, carrier: 180, beat, level: 0.2 },
        noise: { enabled: true, type: 'pink', level: lerp(0.3, 0.15, t) },
        isochronic: { enabled: true, rate: beat, depth: lerp(0.08, 0.03, t) },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'ocean', level: 0.4 }, // PRD §8
        ambience2: disabledAmbience2(),
        harmony: {
          enabled: true,
          level: lerp(0.08, 0.14, t),
          richness: 0.4,
          movement: 0.3,
          rootHz: 110,
        },
        bass: 0.1,
        stereoWidth: 0.8,
        lowpassHz: LOWPASS_OPEN_HZ,
      };
    },
  },
  sleep: {
    id: 'sleep',
    label: 'Sleep',
    emoji: '😴',
    description: 'Dark, low rumble with softened highs, fading out slowly.',
    intensityLabels: ['Light', 'Deep'],
    end: { fadeSeconds: 60, chime: 'none' }, // fades to silence, never a chime (PRD §4)
    noDrivingWarning: true,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      const beat = lerp(6, 2, t);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        tone: { enabled: false, frequency: 220, level: 0.1, warmth: 0.5 },
        binaural: { enabled: true, carrier: 140, beat, level: 0.15 },
        // Brown stays the default masking bed; the bandit's noise-alt arm offers
        // pink, whose slow-wave-sleep benefit has direct evidence (Papalambros 2017).
        noise: { enabled: true, type: 'brown', level: lerp(0.3, 0.45, t) },
        isochronic: { enabled: true, rate: beat, depth: lerp(0.05, 0.02, t) },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'space', level: 0.15 }, // dark, sits under the 2 kHz lowpass
        ambience2: disabledAmbience2(),
        harmony: disabledHarmony(),
        bass: lerp(0.1, 0.2, t), // body under the lowpass without raising it
        stereoWidth: 0.5,
        lowpassHz: 2000, // PRD §8: high_frequencies reduced
      };
    },
  },
  energy: {
    id: 'energy',
    label: 'Energy',
    emoji: '⚡',
    description: 'Bright noise and a driving pulse to lift you up.',
    intensityLabels: ['Steady', 'Charged'],
    end: { fadeSeconds: 1.5, chime: 'optional' },
    noDrivingWarning: false,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        tone: { enabled: false, frequency: 220, level: 0.1, warmth: 0.5 },
        binaural: { enabled: true, carrier: 240, beat: lerp(14, 30, t), level: 0.25 },
        noise: { enabled: true, type: 'blue', level: lerp(0.1, 0.22, t) },
        // In pattern mode the rate is inert — depth still sets the pulse depth.
        isochronic: {
          enabled: true,
          rate: Math.min(lerp(8, 14, t), MAX_PULSE_RATE_HZ),
          depth: lerp(0.15, 0.35, t),
        },
        // Driving groove: ~120-140 BPM sits in the music-tempo arousal range.
        rhythm: { mode: 'pattern', bpm: lerp(115, 140, t), complexity: lerp(0.3, 0.55, t) },
        ambience: { enabled: false, type: 'wind', level: 0.1 }, // bright pulse wants no bed
        ambience2: disabledAmbience2(),
        harmony: disabledHarmony(),
        bass: lerp(0.1, 0.25, t),
        stereoWidth: 0.9,
        lowpassHz: LOWPASS_OPEN_HZ,
      };
    },
  },
  meditation: {
    id: 'meditation',
    label: 'Meditation',
    emoji: '🧘‍♂️',
    description: 'A soft drone over gentle noise, slowing with depth.',
    intensityLabels: ['Light', 'Deep'],
    end: { fadeSeconds: 4, chime: 'none' },
    noDrivingWarning: true,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      const beat = lerp(8, 4, t);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        tone: { enabled: true, frequency: 210, level: lerp(0.06, 0.12, t), warmth: 0.7 },
        binaural: { enabled: true, carrier: 160, beat, level: 0.25 },
        noise: { enabled: true, type: 'pink', level: lerp(0.2, 0.1, t) },
        isochronic: { enabled: true, rate: beat, depth: lerp(0.05, 0.12, t) },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'wind', level: 0.15 },
        ambience2: disabledAmbience2(),
        harmony: {
          enabled: true,
          level: lerp(0.1, 0.16, t),
          richness: 0.5,
          movement: 0.4,
          rootHz: 105, // octave under the 210 Hz drone
        },
        bass: 0.1,
        stereoWidth: 0.7,
        lowpassHz: LOWPASS_OPEN_HZ,
      };
    },
  },
  arousal: {
    id: 'arousal',
    label: 'Arousal',
    emoji: '🌹',
    description: 'A warm, slow pulse over soft lows — relaxed but awake.',
    intensityLabels: ['Gentle', 'Passionate'],
    end: { fadeSeconds: 6, chime: 'none' }, // a chime would break the mood
    noDrivingWarning: true,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      const beat = lerp(8, 6, t); // low-alpha → theta edge: relaxed but awake
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        tone: { enabled: true, frequency: 160, level: lerp(0.08, 0.14, t), warmth: 0.85 },
        binaural: { enabled: true, carrier: 150, beat, level: 0.2 },
        noise: { enabled: true, type: 'brown', level: lerp(0.25, 0.18, t) },
        isochronic: { enabled: true, rate: beat, depth: lerp(0.08, 0.18, t) },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'ocean', level: 0.25 }, // slow breathing-like bed
        ambience2: disabledAmbience2(),
        harmony: { enabled: true, level: 0.1, richness: 0.35, movement: 0.3, rootHz: 98 },
        bass: 0,
        stereoWidth: 0.85,
        lowpassHz: 6000, // warm softened highs — between sleep's 2000 and open
      };
    },
  },
  flow: {
    id: 'flow',
    label: 'Deep Work',
    emoji: '🌊',
    description: 'Deep masking with a gamma edge for locked-in work.',
    intensityLabels: ['Settled', 'Locked in'],
    end: { fadeSeconds: 1.5, chime: 'optional' },
    noDrivingWarning: false,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      // Gamma entrainment: 40 Hz is the most-studied stimulation frequency for
      // attention/working memory. Carrier 240 keeps beat perception strong
      // (strongest ~200-450 Hz, Oster 1973). The mono fallback pulses the
      // carrier tone at the raw beat — up to 40 Hz AM, i.e. the gamma flicker
      // stimulus itself, so it stays coherent without headphones.
      const beat = lerp(18, 40, t);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        tone: { enabled: false, frequency: 220, level: 0.1, warmth: 0.5 },
        binaural: { enabled: true, carrier: 240, beat, level: 0.25 },
        noise: { enabled: true, type: 'brown', level: lerp(0.3, 0.45, t) },
        isochronic: {
          enabled: true,
          rate: Math.min(beat, MAX_PULSE_RATE_HZ),
          depth: lerp(0.05, 0.1, t), // subtle — the gamma beat is the driver
        },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'rain', level: 0.05 },
        ambience2: disabledAmbience2(),
        harmony: disabledHarmony(),
        bass: 0,
        stereoWidth: 0.6,
        lowpassHz: LOWPASS_OPEN_HZ,
      };
    },
  },
  calm: {
    id: 'calm',
    label: 'Calm',
    emoji: '🌬️',
    description: 'A slow breathing swell over warm pads — unwind and reset.',
    intensityLabels: ['Settling', 'Deep calm'],
    end: { fadeSeconds: 6, chime: 'none' },
    noDrivingWarning: true,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        // Warmth 0.8 softens the harmony pad even with the tone disabled.
        tone: { enabled: false, frequency: 220, level: 0.1, warmth: 0.8 },
        binaural: { enabled: true, carrier: 200, beat: lerp(10, 8, t), level: 0.2 },
        noise: { enabled: true, type: 'pink', level: lerp(0.25, 0.12, t) },
        // Breathing pacer, not entrainment: the pulse deliberately does NOT
        // track the beat. 0.15→0.1 Hz = 9→6 breaths/min; ~6 breaths/min is the
        // resonance-frequency breathing standard (HRV biofeedback, Lehrer &
        // Gevirtz) — follow the swell to slow your breath.
        isochronic: { enabled: true, rate: lerp(0.15, 0.1, t), depth: lerp(0.25, 0.35, t) },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'ocean', level: 0.35 }, // nature sound aids stress recovery (Alvarsson 2010)
        ambience2: disabledAmbience2(),
        harmony: {
          enabled: true,
          level: lerp(0.1, 0.16, t),
          richness: 0.35,
          movement: 0.25,
          rootHz: 110,
        },
        bass: 0.15,
        stereoWidth: 0.8,
        lowpassHz: 8000,
      };
    },
  },
  creative: {
    id: 'creative',
    label: 'Creative',
    emoji: '💡',
    description: 'A drifting, evolving pad on the edge of daydream.',
    intensityLabels: ['Open', 'Deep drift'],
    end: { fadeSeconds: 4, chime: 'none' },
    noDrivingWarning: true,
    buildProfile(intensity) {
      const t = clamp01(intensity);
      // Theta-alpha border (~6-9 Hz): the band associated with hypnagogic
      // imagery and divergent thinking.
      const beat = lerp(9, 6, t);
      return {
        masterVolume: DEFAULT_MASTER_VOLUME,
        tone: { enabled: false, frequency: 220, level: 0.1, warmth: 0.7 },
        binaural: { enabled: true, carrier: 220, beat, level: 0.22 },
        noise: { enabled: true, type: 'pink', level: lerp(0.2, 0.1, t) },
        isochronic: { enabled: true, rate: beat, depth: lerp(0.06, 0.1, t) },
        rhythm: simpleRhythm(),
        ambience: { enabled: true, type: 'space', level: 0.2 },
        ambience2: disabledAmbience2(),
        harmony: {
          enabled: true,
          level: lerp(0.1, 0.18, t),
          richness: lerp(0.45, 0.6, t),
          movement: 0.7, // high — an always-evolving texture for ideation
          rootHz: 146.8, // D3
        },
        bass: 0,
        stereoWidth: 0.9,
        lowpassHz: LOWPASS_OPEN_HZ,
      };
    },
  },
};

export const STATE_LIST: StateDefinition[] = [
  STATES.focus,
  STATES.relax,
  STATES.sleep,
  STATES.energy,
  STATES.meditation,
  STATES.arousal,
  STATES.flow,
  STATES.calm,
  STATES.creative,
];
