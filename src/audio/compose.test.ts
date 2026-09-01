import { describe, expect, it } from 'vitest';
import type { ProgramModulation } from '../programs/evaluator';
import { evaluateArc, IDENTITY_MODULATION, resolveArc, type ArcModulation } from '../session/evolution';
import { buildCandidateProfile, candidatesFor } from '../personalization/candidates';
import { BREATH_PATTERNS, type BreathPattern } from './breathing';
import { composeEffectiveParams, type ComposeInput, type EffectiveParams } from './compose';
import {
  AMBIENCE_TRIM,
  BASS_MAX_DB,
  BINAURAL_TRIM,
  BREATH_MIN_DEPTH,
  HARMONY_TRIM,
  MONO_SUBSTITUTE_MIN_DEPTH,
  NOISE_TRIM,
  TONE_TRIM,
  TYPE_FADE_SECONDS,
} from './mixPolicy';
import { MAX_PULSE_RATE_HZ, STATE_LIST, STATES } from './states';
import { AMBIENCE_TYPES, cloneProfile, type NoiseType, type SoundProfile } from './types';

/**
 * Oracle: a literal transliteration of AudioEngine.applyAll as it stood
 * before the composition was extracted (every `this.layer.setX(v)` became a
 * field assignment, in the same order, with the same expressions). This is
 * the specification compose.ts must match bit-for-bit — keep it verbatim.
 * Later additions (marked "Phase 9") are spelled out here in the same
 * literal style so the oracle stays the specification.
 */
function legacyCompose(input: ComposeInput): EffectiveParams {
  const p = input.profile;
  const mod = input.arc;
  const pm = input.program;
  const substitute = input.monoMode && p.binaural.enabled;

  // Phase 9: absolute program overrides, else the historic expressions.
  const beat =
    pm && pm.beatHz !== null
      ? Math.max(0.5, pm.beatHz)
      : Math.max(0.5, p.binaural.beat + (pm ? 0 : mod.beatOffsetHz));
  const carrier = pm && pm.carrierHz !== null ? pm.carrierHz : p.binaural.carrier;
  const noiseType = pm && pm.noiseType !== null ? pm.noiseType : p.noise.type;
  const ambienceType = pm && pm.ambienceType !== null ? pm.ambienceType : p.ambience.type;
  const richness = pm && pm.harmonyRichness !== null ? pm.harmonyRichness : p.harmony.richness;
  const fadeSec = pm ? pm.typeFadeSec : TYPE_FADE_SECONDS;
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
  const warmth = pm && pm.warmth !== null ? pm.warmth : p.tone.warmth;

  const toneEnabled = substitute ? true : p.tone.enabled;
  const toneFrequency = substitute ? carrier : p.tone.frequency;
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

  const out = {} as EffectiveParams;
  // this.tone.setFrequency / setCharacter / setLevel
  out.tone = {
    frequency: toneFrequency,
    warmth,
    level: toneEnabled ? toneLevel * TONE_TRIM : 0,
  };
  // this.binaural.setCarrier / setBeat / setLevel
  out.binaural = {
    carrier,
    beat,
    level: p.binaural.enabled && !substitute ? p.binaural.level * arcGain * BINAURAL_TRIM : 0,
  };
  // this.noise.setType(type, fadeSec) / setLevel
  out.noise = {
    type: noiseType,
    level: p.noise.enabled ? p.noise.level * arcGain * noiseScale * NOISE_TRIM[noiseType] : 0,
    fadeSec,
  };
  // this.ambience.setType(type, fadeSec) / setLevel
  out.ambience = {
    type: ambienceType,
    level: p.ambience.enabled
      ? p.ambience.level * arcGain * ambienceScale * AMBIENCE_TRIM[ambienceType]
      : 0,
    fadeSec,
  };
  // this.ambience2.setType(type, fadeSec) / setLevel
  out.ambience2 = {
    type: p.ambience2.type,
    level: p.ambience2.enabled
      ? p.ambience2.level * arcGain * ambienceScale * AMBIENCE_TRIM[p.ambience2.type]
      : 0,
    fadeSec,
  };
  const patternRhythm = substitute ? null : (pm?.rhythm ?? null);
  const patternMode =
    !substitute && (patternRhythm !== null || p.rhythm.mode === 'pattern');
  const breath = substitute ? null : input.breath;
  if (breath) {
    // this.pulse.setMode('breath'); this.pulse.setBreath(breath, anchor, depth)
    out.pulse = {
      mode: 'breath',
      pattern: breath,
      depth: Math.max(isoEnabled ? isoDepth : 0, BREATH_MIN_DEPTH),
    };
  } else if (patternMode) {
    // this.pulse.setMode('pattern'); this.pulse.setPattern(bpm, complexity, depth)
    out.pulse = {
      mode: 'pattern',
      bpm: patternRhythm?.bpm ?? p.rhythm.bpm,
      complexity: patternRhythm?.complexity ?? p.rhythm.complexity,
      depth: isoEnabled ? isoDepth : 0,
    };
  } else {
    // this.pulse.setMode('simple'); setRate(isoRate); setDepth(...)
    out.pulse = { mode: 'simple', rate: isoRate, depth: isoEnabled ? isoDepth : 0 };
  }
  // this.harmony.setRoot / setRichness / setMovement / setSoftness / setLevel
  out.harmony = {
    rootHz: p.harmony.rootHz,
    richness,
    movement: p.harmony.movement,
    softness: warmth,
    level: p.harmony.enabled ? p.harmony.level * arcGain * harmonyScale * HARMONY_TRIM : 0,
  };
  // ramp(this.bassShelf.gain, BASS_MAX_DB * Math.min(1, p.bass * bassScale))
  out.bassDb = BASS_MAX_DB * Math.min(1, p.bass * bassScale);
  // this.width.setWidth(p.stereoWidth)
  out.stereoWidth = p.stereoWidth;
  // ramp(this.lowpass.frequency, lowpassHz)
  out.lowpassHz = lowpassHz;
  return out;
}

const ARCS: ArcModulation[] = [
  IDENTITY_MODULATION,
  { intensity: 0.7, beatOffsetHz: 4, lowpassScale: 0.5 },
  { intensity: 1.15, beatOffsetHz: -30, lowpassScale: 0.005 }, // beat floor + lowpass floor
];

const PROGRAM: ProgramModulation = {
  intensity: 0.8,
  lowpassScale: 0.6,
  noiseScale: 1.4,
  ambienceScale: 0.5,
  toneScale: 1.2,
  harmonyScale: 1.6,
  bassScale: 3, // bass * scale > 1 hits the cap
  warmth: 0.9,
  rhythm: { bpm: 96, complexity: 0.4 },
  beatHz: null,
  carrierHz: null,
  noiseType: null,
  ambienceType: null,
  harmonyRichness: null,
  typeFadeSec: 8,
};
const PROGRAM_NO_RHYTHM: ProgramModulation = { ...PROGRAM, warmth: null, rhythm: null };
/** Phase 9: every absolute override set, beat below the floor to hit the clamp. */
const PROGRAM_OVERRIDES: ProgramModulation = {
  ...PROGRAM,
  beatHz: 0.2,
  carrierHz: 333,
  noiseType: 'blue',
  ambienceType: 'cafe',
  harmonyRichness: 0.05,
  typeFadeSec: 5,
};
const PROGRAMS: (ProgramModulation | null)[] = [
  null,
  PROGRAM,
  PROGRAM_NO_RHYTHM,
  PROGRAM_OVERRIDES,
];
const BREATHS: (BreathPattern | null)[] = [null, BREATH_PATTERNS.box];

function edgeProfiles(): SoundProfile[] {
  const base = STATES.relax.buildProfile(0.5);
  const out: SoundProfile[] = [];
  const nonTracking = cloneProfile(base);
  nonTracking.isochronic.rate = base.binaural.beat + 1.5;
  out.push(nonTracking);
  const pattern = cloneProfile(base);
  pattern.rhythm = { mode: 'pattern', bpm: 72, complexity: 0.3 };
  out.push(pattern);
  const highBeat = cloneProfile(base);
  highBeat.binaural.beat = 30; // tracking above MAX_PULSE_RATE_HZ
  highBeat.isochronic.rate = Math.min(30, MAX_PULSE_RATE_HZ);
  out.push(highBeat);
  for (const type of ['white', 'pink', 'brown', 'blue'] as NoiseType[]) {
    const p = cloneProfile(base);
    p.noise.type = type;
    p.noise.enabled = true;
    out.push(p);
  }
  for (const type of AMBIENCE_TYPES) {
    const p = cloneProfile(base);
    p.ambience.type = type;
    p.ambience.enabled = true;
    p.ambience2 = { enabled: true, type, level: 0.2 };
    out.push(p);
  }
  const everything = cloneProfile(base);
  everything.tone.enabled = true;
  everything.harmony.enabled = true;
  everything.bass = 0.5;
  everything.lowpassHz = 300;
  out.push(everything);
  const nothing = cloneProfile(base);
  nothing.tone.enabled = false;
  nothing.binaural.enabled = false;
  nothing.noise.enabled = false;
  nothing.isochronic.enabled = false;
  nothing.ambience.enabled = false;
  nothing.harmony.enabled = false;
  out.push(nothing);
  return out;
}

function* matrix(): Generator<ComposeInput> {
  const profiles: SoundProfile[] = [];
  for (const def of STATE_LIST) {
    for (const intensity of [0, 0.5, 1]) {
      for (const arm of candidatesFor(def.id)) {
        profiles.push(buildCandidateProfile(def.id, intensity, arm.id));
      }
    }
    profiles.push(
      STATES[def.id].buildProfile(0.5),
    );
  }
  profiles.push(...edgeProfiles());
  const stateArc = evaluateArc(
    resolveArc('sleep', { wakeUp: { riseSec: 300 }, durationSec: 1800 }),
    0.95,
  );
  for (const profile of profiles) {
    for (const arc of [...ARCS, stateArc]) {
      for (const program of PROGRAMS) {
        for (const breath of BREATHS) {
          for (const monoMode of [false, true]) {
            yield { profile, arc, program, breath, monoMode };
          }
        }
      }
    }
  }
}

describe('composeEffectiveParams', () => {
  it('matches the legacy applyAll composition exactly across the matrix', () => {
    let cases = 0;
    for (const input of matrix()) {
      const actual = composeEffectiveParams(input);
      const expected = legacyCompose(input);
      // toEqual on numbers is exact equality — floats must match bit-for-bit.
      expect(actual).toEqual(expected);
      cases += 1;
    }
    expect(cases).toBeGreaterThan(5000);
  });

  it('does not mutate its inputs', () => {
    const profile = STATES.focus.buildProfile(0.5);
    const before = JSON.stringify(profile);
    composeEffectiveParams({
      profile,
      arc: ARCS[1],
      program: PROGRAM,
      breath: BREATH_PATTERNS.box,
      monoMode: true,
    });
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('pins a representative sample of composed values', () => {
    const sample = STATE_LIST.map((def) => ({
      state: def.id,
      plain: composeEffectiveParams({
        profile: def.buildProfile(0.5),
        arc: IDENTITY_MODULATION,
        program: null,
        breath: null,
        monoMode: false,
      }),
      mono: composeEffectiveParams({
        profile: def.buildProfile(0.5),
        arc: ARCS[1],
        program: null,
        breath: null,
        monoMode: true,
      }),
      program: composeEffectiveParams({
        profile: def.buildProfile(0.5),
        arc: IDENTITY_MODULATION,
        program: PROGRAM,
        breath: null,
        monoMode: false,
      }),
    }));
    expect(sample).toMatchSnapshot();
  });
});
