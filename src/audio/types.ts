export type NoiseType = 'white' | 'pink' | 'brown' | 'blue';

/** Ambience that is only ever synthesized from shaped noise (PRD §6E). */
export type SynthAmbienceType = 'rain' | 'ocean' | 'wind' | 'space';
/**
 * Ambience that is synthesized by default but upgrades to a looped recording
 * when one is shipped in public/ambience/ (PRD §6E).
 */
export type SampleAmbienceType = 'forest' | 'fireplace' | 'cafe';
export type AmbienceType = SynthAmbienceType | SampleAmbienceType;

export const SYNTH_AMBIENCE_TYPES: readonly SynthAmbienceType[] = [
  'rain',
  'ocean',
  'wind',
  'space',
];
export const SAMPLE_AMBIENCE_TYPES: readonly SampleAmbienceType[] = [
  'forest',
  'fireplace',
  'cafe',
];

/**
 * Runtime parameter model for the generated soundscape (PRD §5).
 * Mono/speaker fallback is deliberately NOT part of the profile — it is a
 * device/output setting on the engine, so saved presets never bake it in.
 */
/**
 * 'simple' = the original single-sine-LFO isochronic pulse. 'pattern' = the
 * BPM-based scheduled pulse engine with subdivisions and accents.
 */
export type RhythmMode = 'simple' | 'pattern';

export interface SoundProfile {
  masterVolume: number; // 0..1
  tone: {
    enabled: boolean;
    frequency: number; // Hz
    level: number; // 0..1
    /**
     * 0 = mathematically pure sine; 1 = fully softened (PRD §7: gentle
     * detuning, harmonic stacking, low-pass filtering against fatigue).
     */
    warmth: number; // 0..1
  };
  binaural: {
    enabled: boolean;
    carrier: number; // Hz, center frequency
    beat: number; // Hz, perceived beat = |right - left|
    level: number; // 0..1
  };
  noise: {
    enabled: boolean;
    type: NoiseType;
    level: number; // 0..1
  };
  isochronic: {
    enabled: boolean;
    rate: number; // Hz, 0.5..16 — pulses above ~16 Hz stop reading as rhythm
    depth: number; // 0..1 amplitude modulation depth
  };
  /**
   * How the isochronic pulse is produced. `isochronic.enabled`/`depth` gate
   * and scale both modes; pattern mode only reinterprets *when* pulses happen
   * (musical BPM + complexity instead of a fixed-rate sine wobble).
   */
  rhythm: {
    mode: RhythmMode;
    bpm: number; // 30..200, pattern mode only
    complexity: number; // 0..1, pattern mode only — subdivisions/accents fade in
  };
  /** Third mix bus alongside noise and tone (PRD §6D/§6E) — pleasantness + masking. */
  ambience: {
    enabled: boolean;
    type: AmbienceType;
    level: number; // 0..1
  };
  /**
   * Harmonic pad: stacked intervals (root/fifth/octave/third) over rootHz
   * with slow internal movement — real harmonic content beyond the single
   * tone. `richness` fades upper voices in continuously; `movement` drives
   * very slow free-running undulation ("harmonic movement").
   */
  harmony: {
    enabled: boolean;
    level: number; // 0..1
    richness: number; // 0..1
    movement: number; // 0..1
    rootHz: number; // 30..1000
  };
  /** Low-shelf boost at 150 Hz: 0 → 0 dB (legacy identical) .. 1 → +6 dB. */
  bass: number; // 0..1
  stereoWidth: number; // 0..1: 0 = mono-ish, 1 = full width (binaural exempt)
  /** Master lowpass cutoff in Hz — PRD §8 "high_frequencies: reduced" for sleep. */
  lowpassHz: number;
}

/** Effectively "no filtering" — kept finite so it can always be ramped. */
export const LOWPASS_OPEN_HZ = 18000;

export const defaultProfile: SoundProfile = {
  masterVolume: 0.5,
  tone: { enabled: false, frequency: 220, level: 0.2, warmth: 0.5 },
  binaural: { enabled: true, carrier: 200, beat: 10, level: 0.25 },
  noise: { enabled: true, type: 'brown', level: 0.35 },
  isochronic: { enabled: false, rate: 10, depth: 0.1 },
  rhythm: { mode: 'simple', bpm: 80, complexity: 0 },
  ambience: { enabled: false, type: 'rain', level: 0.1 },
  harmony: { enabled: false, level: 0.25, richness: 0.5, movement: 0.3, rootHz: 110 },
  bass: 0,
  stereoWidth: 0.7,
  lowpassHz: LOWPASS_OPEN_HZ,
};

export function cloneProfile(profile: SoundProfile): SoundProfile {
  return structuredClone(profile);
}

const NOISE_TYPES: readonly NoiseType[] = ['white', 'pink', 'brown', 'blue'];
const RHYTHM_MODES: readonly RhythmMode[] = ['simple', 'pattern'];
/** Every ambience type, in picker order — all always playable. */
export const AMBIENCE_TYPES: readonly AmbienceType[] = [
  ...SYNTH_AMBIENCE_TYPES,
  ...SAMPLE_AMBIENCE_TYPES,
];

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Completes and sanitizes a profile of any vintage. Presets and session
 * records persist profiles verbatim under a schema version that never
 * migrates, so profiles saved before a field existed come back without it —
 * feeding those to the engine would ramp AudioParams to NaN. Every profile
 * ingress (storage reads, transfer imports, insights) must pass through here.
 */
export function normalizeProfile(raw: unknown): SoundProfile {
  const d = defaultProfile;
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    Partial<Record<string, unknown>> | unknown
  >;
  const tone = (p.tone ?? {}) as Record<string, unknown>;
  const binaural = (p.binaural ?? {}) as Record<string, unknown>;
  const noise = (p.noise ?? {}) as Record<string, unknown>;
  const isochronic = (p.isochronic ?? {}) as Record<string, unknown>;
  const rhythm = (p.rhythm ?? {}) as Record<string, unknown>;
  const ambience = (p.ambience ?? {}) as Record<string, unknown>;
  const harmony = (p.harmony ?? {}) as Record<string, unknown>;
  return {
    masterVolume: num(p.masterVolume, d.masterVolume, 0, 1),
    tone: {
      enabled: bool(tone.enabled, d.tone.enabled),
      frequency: num(tone.frequency, d.tone.frequency, 20, 8000),
      level: num(tone.level, d.tone.level, 0, 1),
      warmth: num(tone.warmth, d.tone.warmth, 0, 1),
    },
    binaural: {
      enabled: bool(binaural.enabled, d.binaural.enabled),
      carrier: num(binaural.carrier, d.binaural.carrier, 20, 1500),
      beat: num(binaural.beat, d.binaural.beat, 0.5, 40),
      level: num(binaural.level, d.binaural.level, 0, 1),
    },
    noise: {
      enabled: bool(noise.enabled, d.noise.enabled),
      type: oneOf(noise.type, NOISE_TYPES, d.noise.type),
      level: num(noise.level, d.noise.level, 0, 1),
    },
    isochronic: {
      enabled: bool(isochronic.enabled, d.isochronic.enabled),
      rate: num(isochronic.rate, d.isochronic.rate, 0.1, 40),
      depth: num(isochronic.depth, d.isochronic.depth, 0, 1),
    },
    // Profiles saved before `rhythm` existed come back without it and must
    // sound identical: the defaults land on simple mode, the legacy path.
    rhythm: {
      mode: oneOf(rhythm.mode, RHYTHM_MODES, d.rhythm.mode),
      bpm: num(rhythm.bpm, d.rhythm.bpm, 30, 200),
      complexity: num(rhythm.complexity, d.rhythm.complexity, 0, 1),
    },
    ambience: {
      enabled: bool(ambience.enabled, d.ambience.enabled),
      type: oneOf(ambience.type, AMBIENCE_TYPES, d.ambience.type),
      level: num(ambience.level, d.ambience.level, 0, 1),
    },
    // Profiles saved before harmony/bass existed come back without them and
    // must sound identical: harmony defaults to disabled, bass to 0 dB.
    harmony: {
      enabled: bool(harmony.enabled, d.harmony.enabled),
      level: num(harmony.level, d.harmony.level, 0, 1),
      richness: num(harmony.richness, d.harmony.richness, 0, 1),
      movement: num(harmony.movement, d.harmony.movement, 0, 1),
      rootHz: num(harmony.rootHz, d.harmony.rootHz, 30, 1000),
    },
    bass: num(p.bass, d.bass, 0, 1),
    stereoWidth: num(p.stereoWidth, d.stereoWidth, 0, 1),
    lowpassHz: num(p.lowpassHz, d.lowpassHz, 100, LOWPASS_OPEN_HZ),
  };
}
