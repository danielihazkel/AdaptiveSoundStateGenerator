import { STATES, clamp01, type MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { newId } from '../storage/id';
import { defaultProgram, type Program, type ProgramSegment } from './types';

/**
 * Program templates: curated starting points for the "New program" flow.
 * Beyond the mechanical ones (blank / build arc), the context templates
 * implement emotionally progressive designs — the goal is an increasingly
 * engaging, pleasant, intimate auditory environment, not "more activation".
 * Each context couples a base sound (harmonic pad, bass, brightness,
 * ambience) with a phase arc over BPM, complexity, harmony, bass, and warmth.
 */
export interface ProgramTemplate {
  id: string;
  label: string;
  emoji?: string;
  description: string;
  build(state: MentalState, intensity: number): Program;
}

/** Fields a context overrides on top of its base state's profile. */
interface BaseOverrides {
  harmony: { level: number; richness: number; movement: number; rootHz: number };
  bass: number;
  lowpassHz: number;
  ambience: { type: SoundProfile['ambience']['type']; level: number };
  stereoWidth: number;
  isoDepth: number;
}

/** Per-phase values; intensity gets a small +t lift like defaultProgram. */
interface PhaseSpec {
  endMin: number | null;
  label: string;
  description: string;
  intensity: number; // at t = 0.5
  bpmRange: [number, number];
  complexity: number;
  harmonyScale: number;
  bassScale: number;
  ambienceScale: number;
  warmth: number;
}

function contextProfile(base: MentalState, intensity: number, o: BaseOverrides): SoundProfile {
  const profile = STATES[base].buildProfile(intensity);
  // The pad replaces the single tone; the evaluator always supplies a
  // pattern rhythm, so the profile's own rhythm block stays 'simple'.
  profile.tone.enabled = false;
  profile.isochronic.enabled = true;
  profile.isochronic.depth = o.isoDepth;
  profile.harmony = { enabled: true, ...o.harmony };
  profile.bass = o.bass;
  profile.lowpassHz = o.lowpassHz;
  profile.ambience = { enabled: true, ...o.ambience };
  profile.stereoWidth = o.stereoWidth;
  return profile;
}

function contextTemplate(
  id: string,
  label: string,
  emoji: string,
  description: string,
  baseState: MentalState,
  overrides: BaseOverrides,
  phases: PhaseSpec[],
): ProgramTemplate {
  return {
    id,
    label,
    emoji,
    description,
    build(_state, intensity) {
      const t = clamp01(intensity);
      let cursor = 0;
      const segments: ProgramSegment[] = phases.map((phase) => {
        const startMin = cursor;
        if (phase.endMin !== null) cursor = phase.endMin;
        return {
          id: newId(),
          startMin,
          endMin: phase.endMin,
          label: phase.label,
          description: phase.description,
          // Center the listed value at t=0.5, lifting/lowering ±0.1 with t.
          intensity: clamp01(phase.intensity + 0.2 * (t - 0.5)),
          bpmRange: [...phase.bpmRange] as [number, number],
          complexity: phase.complexity,
          harmonyScale: phase.harmonyScale,
          bassScale: phase.bassScale,
          ambienceScale: phase.ambienceScale,
          warmth: phase.warmth,
        };
      });
      return {
        id: newId(),
        name: label,
        createdAt: new Date().toISOString(),
        baseState,
        baseIntensity: t,
        baseProfile: contextProfile(baseState, t, overrides),
        segments,
      };
    },
  };
}

/**
 * Per-phase values for session-arc templates. Unlike PhaseSpec, texture
 * scalers are optional (absent = ride the base state's own tuned profile) and
 * warmth is still required on every phase so the evaluator's null-mixing snap
 * path never triggers.
 */
interface ArcPhaseSpec {
  endMin: number | null;
  label: string;
  description: string;
  intensity: number; // at t = 0.5
  bpmRange: [number, number];
  complexity: number;
  warmth: number;
  noiseScale?: number;
  ambienceScale?: number;
  lowpassScale?: number;
  harmonyScale?: number;
}

/**
 * Session-arc templates (deep work, wind-down, nap…): unlike contexts they
 * keep the base state's own profile — tone drone, harmony, bass and all —
 * and only shape the session over time. Programs can't move the binaural
 * beat, so descents are carved with intensity, lowpass, and the scalers.
 */
function arcTemplate(
  id: string,
  label: string,
  emoji: string,
  description: string,
  baseState: MentalState,
  phases: ArcPhaseSpec[],
  options?: { endChime?: boolean },
): ProgramTemplate {
  return {
    id,
    label,
    emoji,
    description,
    build(_state, intensity) {
      const t = clamp01(intensity);
      const profile = STATES[baseState].buildProfile(t);
      // The evaluator's pattern pulse needs the depth source active.
      profile.isochronic.enabled = true;
      let cursor = 0;
      const segments: ProgramSegment[] = phases.map((phase) => {
        const startMin = cursor;
        if (phase.endMin !== null) cursor = phase.endMin;
        const segment: ProgramSegment = {
          id: newId(),
          startMin,
          endMin: phase.endMin,
          label: phase.label,
          description: phase.description,
          // Center the listed value at t=0.5, lifting/lowering ±0.1 with t.
          intensity: clamp01(phase.intensity + 0.2 * (t - 0.5)),
          bpmRange: [...phase.bpmRange] as [number, number],
          complexity: phase.complexity,
          warmth: phase.warmth,
        };
        if (phase.noiseScale !== undefined) segment.noiseScale = phase.noiseScale;
        if (phase.ambienceScale !== undefined) segment.ambienceScale = phase.ambienceScale;
        if (phase.lowpassScale !== undefined) segment.lowpassScale = phase.lowpassScale;
        if (phase.harmonyScale !== undefined) segment.harmonyScale = phase.harmonyScale;
        return segment;
      });
      const program: Program = {
        id: newId(),
        name: label,
        createdAt: new Date().toISOString(),
        baseState,
        baseIntensity: t,
        baseProfile: profile,
        segments,
      };
      if (options?.endChime) program.endChime = true;
      return program;
    },
  };
}

const blank: ProgramTemplate = {
  id: 'blank',
  label: 'Blank',
  description: 'One open-ended phase — design everything yourself.',
  build(state, intensity) {
    const t = clamp01(intensity);
    return {
      id: newId(),
      name: 'New program',
      createdAt: new Date().toISOString(),
      baseState: state,
      baseIntensity: t,
      baseProfile: STATES[state].buildProfile(t),
      segments: [
        {
          id: newId(),
          startMin: 0,
          endMin: null,
          label: 'Phase 1',
          intensity: 0.5,
          bpmRange: [70, 80],
          complexity: 0,
        },
      ],
    };
  },
};

const buildArc: ProgramTemplate = {
  id: 'buildArc',
  label: 'Build arc',
  description: 'Warm-up → pulse → build → peak → sustain over 25+ minutes.',
  build: (state, intensity) => ({ ...defaultProgram(state, intensity), name: 'Build arc' }),
};

const intimate = contextTemplate(
  'intimate',
  'Intimate',
  '💗',
  'Warm and close: slow build from calm to a rich, immersive peak.',
  'relax',
  {
    harmony: { level: 0.3, richness: 0.65, movement: 0.4, rootHz: 110 },
    bass: 0.4,
    lowpassHz: 7000,
    ambience: { type: 'ocean', level: 0.25 },
    stereoWidth: 0.55,
    isoDepth: 0.08,
  },
  [
    { endMin: 5, label: 'Warm opening', description: 'Warm, calm, intimate', intensity: 0.45, bpmRange: [75, 80], complexity: 0.1, harmonyScale: 0.9, bassScale: 0.8, ambienceScale: 1.2, warmth: 0.85 },
    { endMin: 12, label: 'Rising interest', description: 'Increasing rhythmic interest', intensity: 0.55, bpmRange: [82, 88], complexity: 0.3, harmonyScale: 1.1, bassScale: 0.9, ambienceScale: 1.0, warmth: 0.8 },
    { endMin: 20, label: 'Blossom', description: 'High pleasantness, richer harmony', intensity: 0.7, bpmRange: [88, 94], complexity: 0.5, harmonyScale: 1.3, bassScale: 1.0, ambienceScale: 1.1, warmth: 0.8 },
    { endMin: 30, label: 'Peak', description: 'Fullest rhythm, bass, and immersion', intensity: 0.85, bpmRange: [92, 96], complexity: 0.7, harmonyScale: 1.4, bassScale: 1.3, ambienceScale: 1.5, warmth: 0.75 },
    { endMin: null, label: 'Afterglow', description: 'Soft sustained warmth', intensity: 0.6, bpmRange: [80, 88], complexity: 0.35, harmonyScale: 1.2, bassScale: 0.9, ambienceScale: 1.2, warmth: 0.9 },
  ],
);

const romantic = contextTemplate(
  'romantic',
  'Romantic',
  '🌹',
  'Gentle and tender — soft harmony, low tempo, rainy warmth.',
  'relax',
  {
    harmony: { level: 0.35, richness: 0.7, movement: 0.5, rootHz: 98 },
    bass: 0.3,
    lowpassHz: 6000,
    ambience: { type: 'rain', level: 0.3 },
    stereoWidth: 0.6,
    isoDepth: 0.06,
  },
  [
    { endMin: 6, label: 'Candlelight', description: 'Soft and unhurried', intensity: 0.4, bpmRange: [68, 74], complexity: 0.05, harmonyScale: 1.0, bassScale: 0.8, ambienceScale: 1.2, warmth: 0.9 },
    { endMin: 14, label: 'Closer', description: 'Gently gathering warmth', intensity: 0.5, bpmRange: [72, 78], complexity: 0.2, harmonyScale: 1.1, bassScale: 0.9, ambienceScale: 1.1, warmth: 0.85 },
    { endMin: 24, label: 'Devotion', description: 'Fuller harmony, steady pulse', intensity: 0.65, bpmRange: [76, 84], complexity: 0.35, harmonyScale: 1.3, bassScale: 1.0, ambienceScale: 1.2, warmth: 0.85 },
    { endMin: null, label: 'Embrace', description: 'Held, warm, unending', intensity: 0.55, bpmRange: [72, 80], complexity: 0.25, harmonyScale: 1.2, bassScale: 0.9, ambienceScale: 1.2, warmth: 0.9 },
  ],
);

const sensual = contextTemplate(
  'sensual',
  'Sensual',
  '🕯️',
  'Deep and slow-burning — low root, present bass, darker tone.',
  'relax',
  {
    harmony: { level: 0.3, richness: 0.5, movement: 0.35, rootHz: 82.4 },
    bass: 0.55,
    lowpassHz: 5000,
    ambience: { type: 'ocean', level: 0.2 },
    stereoWidth: 0.5,
    isoDepth: 0.1,
  },
  [
    { endMin: 5, label: 'Slow burn', description: 'Low and unhurried', intensity: 0.5, bpmRange: [70, 76], complexity: 0.15, harmonyScale: 1.0, bassScale: 1.0, ambienceScale: 1.0, warmth: 0.85 },
    { endMin: 12, label: 'Heat', description: 'Pulse gains weight', intensity: 0.6, bpmRange: [76, 84], complexity: 0.35, harmonyScale: 1.1, bassScale: 1.2, ambienceScale: 0.9, warmth: 0.8 },
    { endMin: 22, label: 'Deep', description: 'Full bass, driving rhythm', intensity: 0.75, bpmRange: [84, 92], complexity: 0.55, harmonyScale: 1.2, bassScale: 1.4, ambienceScale: 0.9, warmth: 0.75 },
    { endMin: null, label: 'Glow', description: 'Warm and settled', intensity: 0.65, bpmRange: [80, 88], complexity: 0.4, harmonyScale: 1.1, bassScale: 1.2, ambienceScale: 1.0, warmth: 0.85 },
  ],
);

const playful = contextTemplate(
  'playful',
  'Playful',
  '🎈',
  'Light and lively — brighter, quicker, sparkling movement.',
  'relax',
  {
    harmony: { level: 0.28, richness: 0.7, movement: 0.6, rootHz: 146.8 },
    bass: 0.25,
    lowpassHz: 10000,
    ambience: { type: 'rain', level: 0.15 },
    stereoWidth: 0.75,
    isoDepth: 0.12,
  },
  [
    { endMin: 4, label: 'Spark', description: 'A bright opening', intensity: 0.55, bpmRange: [84, 92], complexity: 0.3, harmonyScale: 1.0, bassScale: 0.9, ambienceScale: 1.0, warmth: 0.65 },
    { endMin: 10, label: 'Tease', description: 'Rhythm starts to skip', intensity: 0.65, bpmRange: [92, 100], complexity: 0.5, harmonyScale: 1.1, bassScale: 1.0, ambienceScale: 0.9, warmth: 0.6 },
    { endMin: 18, label: 'Dance', description: 'Full playful motion', intensity: 0.75, bpmRange: [98, 108], complexity: 0.7, harmonyScale: 1.2, bassScale: 1.1, ambienceScale: 0.9, warmth: 0.6 },
    { endMin: null, label: 'Sparkle', description: 'Light on its feet', intensity: 0.65, bpmRange: [92, 102], complexity: 0.55, harmonyScale: 1.1, bassScale: 1.0, ambienceScale: 1.0, warmth: 0.65 },
  ],
);

const fantasy = contextTemplate(
  'fantasy',
  'Fantasy',
  '✨',
  'Wide and otherworldly — spacious pads, drifting harmony.',
  'meditation',
  {
    harmony: { level: 0.35, richness: 0.8, movement: 0.7, rootHz: 110 },
    bass: 0.2,
    lowpassHz: 8000,
    ambience: { type: 'space', level: 0.35 },
    stereoWidth: 0.9,
    isoDepth: 0.06,
  },
  [
    { endMin: 6, label: 'Threshold', description: 'Stepping through', intensity: 0.4, bpmRange: [66, 72], complexity: 0.05, harmonyScale: 1.0, bassScale: 0.9, ambienceScale: 1.3, warmth: 0.9 },
    { endMin: 15, label: 'Drift', description: 'Harmonies begin to move', intensity: 0.55, bpmRange: [70, 78], complexity: 0.2, harmonyScale: 1.2, bassScale: 1.0, ambienceScale: 1.2, warmth: 0.85 },
    { endMin: 25, label: 'Wonder', description: 'Richest, widest moment', intensity: 0.65, bpmRange: [74, 82], complexity: 0.35, harmonyScale: 1.4, bassScale: 1.0, ambienceScale: 1.2, warmth: 0.85 },
    { endMin: null, label: 'Beyond', description: 'Suspended, endless', intensity: 0.55, bpmRange: [70, 78], complexity: 0.25, harmonyScale: 1.3, bassScale: 0.9, ambienceScale: 1.3, warmth: 0.9 },
  ],
);

const passionate = contextTemplate(
  'passionate',
  'Passionate',
  '🔥',
  'Strong and driving — high tempo and complexity, weighty bass.',
  'relax',
  {
    harmony: { level: 0.3, richness: 0.6, movement: 0.4, rootHz: 98 },
    bass: 0.5,
    lowpassHz: 7000,
    ambience: { type: 'ocean', level: 0.12 },
    stereoWidth: 0.6,
    isoDepth: 0.15,
  },
  [
    { endMin: 4, label: 'Ignite', description: 'Immediate presence', intensity: 0.6, bpmRange: [88, 94], complexity: 0.35, harmonyScale: 1.0, bassScale: 1.0, ambienceScale: 0.9, warmth: 0.85 },
    { endMin: 10, label: 'Surge', description: 'Momentum builds fast', intensity: 0.7, bpmRange: [92, 100], complexity: 0.55, harmonyScale: 1.1, bassScale: 1.2, ambienceScale: 0.8, warmth: 0.8 },
    { endMin: 20, label: 'Fever', description: 'Peak drive and weight', intensity: 0.85, bpmRange: [98, 105], complexity: 0.8, harmonyScale: 1.2, bassScale: 1.4, ambienceScale: 0.8, warmth: 0.8 },
    { endMin: null, label: 'Ember', description: 'Still glowing', intensity: 0.7, bpmRange: [92, 100], complexity: 0.6, harmonyScale: 1.1, bassScale: 1.1, ambienceScale: 0.9, warmth: 0.85 },
  ],
);

const deepWork90 = arcTemplate(
  'deepWork90',
  'Deep Work 90',
  '🧠',
  'One ultradian work block: settle in, two deep stretches, a breather between.',
  'flow',
  [
    { endMin: 10, label: 'Settle', description: 'Ease into the work', intensity: 0.5, bpmRange: [70, 80], complexity: 0.05, warmth: 0.7, ambienceScale: 1.3 },
    { endMin: 40, label: 'Deep block 1', description: 'Full engagement', intensity: 0.8, bpmRange: [78, 88], complexity: 0.2, warmth: 0.6 },
    { endMin: 50, label: 'Trough', description: 'A softer breather mid-cycle', intensity: 0.55, bpmRange: [72, 80], complexity: 0.1, warmth: 0.75, ambienceScale: 1.4, lowpassScale: 0.85 },
    { endMin: 80, label: 'Deep block 2', description: 'Second deep stretch', intensity: 0.85, bpmRange: [80, 90], complexity: 0.25, warmth: 0.6 },
    { endMin: null, label: 'Wind-down', description: 'Ease off and wrap up', intensity: 0.55, bpmRange: [72, 80], complexity: 0.1, warmth: 0.75 },
  ],
);

const sleepWindDown = arcTemplate(
  'sleepWindDown',
  'Sleep Wind-Down',
  '🌙',
  'A slow descent into sleep — darker, softer, quieter with each phase.',
  'sleep',
  [
    { endMin: 10, label: 'Drift', description: 'Lights lowering', intensity: 0.5, bpmRange: [60, 66], complexity: 0, warmth: 0.9, ambienceScale: 1.3, lowpassScale: 1 },
    { endMin: 25, label: 'Descend', description: 'Thoughts slowing', intensity: 0.65, bpmRange: [55, 62], complexity: 0, warmth: 0.95, lowpassScale: 0.8 },
    { endMin: 40, label: 'Deepen', description: 'Darker and heavier', intensity: 0.8, bpmRange: [50, 58], complexity: 0, warmth: 1, lowpassScale: 0.6, noiseScale: 1.1, ambienceScale: 0.7 },
    { endMin: null, label: 'Under', description: 'Barely there', intensity: 0.85, bpmRange: [48, 54], complexity: 0, warmth: 1, lowpassScale: 0.45, ambienceScale: 0.4 },
  ],
);

const powerNap26 = arcTemplate(
  'powerNap26',
  'Power Nap 26',
  '⏰',
  'A ~26-minute nap: quick descent, a dark hold, then a bright wake-up with a chime.',
  'sleep',
  [
    { endMin: 6, label: 'Let go', description: 'Quick descent', intensity: 0.6, bpmRange: [55, 62], complexity: 0, warmth: 0.95, lowpassScale: 0.9 },
    { endMin: 20, label: 'Nap', description: 'Dark, still hold', intensity: 0.85, bpmRange: [50, 56], complexity: 0, warmth: 1, lowpassScale: 0.55, ambienceScale: 0.5 },
    { endMin: 24, label: 'Rise', description: 'Coming back up', intensity: 0.45, bpmRange: [70, 80], complexity: 0.15, warmth: 0.8, lowpassScale: 0.9, noiseScale: 0.7 },
    { endMin: null, label: 'Wake', description: 'Bright and clear', intensity: 0.25, bpmRange: [85, 95], complexity: 0.3, warmth: 0.7, lowpassScale: 1, noiseScale: 0.5, ambienceScale: 1.2 },
  ],
  { endChime: true }, // the waker — overrides sleep's chime-less end
);

const pomodoroFocus = arcTemplate(
  'pomodoroFocus',
  'Pomodoro Focus',
  '🍅',
  'Two 25-minute work sprints with 5-minute rests, then keep going.',
  'focus',
  [
    { endMin: 25, label: 'Work 1', description: 'First sprint', intensity: 0.75, bpmRange: [82, 92], complexity: 0.35, warmth: 0.6 },
    { endMin: 30, label: 'Rest', description: 'Step away', intensity: 0.35, bpmRange: [64, 72], complexity: 0, warmth: 0.85, ambienceScale: 1.6, lowpassScale: 0.7 },
    { endMin: 55, label: 'Work 2', description: 'Second sprint', intensity: 0.8, bpmRange: [84, 94], complexity: 0.4, warmth: 0.6 },
    { endMin: 60, label: 'Rest', description: 'Step away again', intensity: 0.35, bpmRange: [64, 72], complexity: 0, warmth: 0.85, ambienceScale: 1.6, lowpassScale: 0.7 },
    { endMin: null, label: 'Work on', description: 'Keep the rhythm going', intensity: 0.75, bpmRange: [82, 92], complexity: 0.35, warmth: 0.6 },
  ],
);

const meditationJourney = arcTemplate(
  'meditationJourney',
  'Meditation Journey',
  '🕉️',
  'Arrive, descend into depth, and return — the drone stays with you.',
  'meditation',
  [
    { endMin: 5, label: 'Arrive', description: 'Settle onto the cushion', intensity: 0.4, bpmRange: [62, 68], complexity: 0, warmth: 0.8 },
    { endMin: 15, label: 'Descend', description: 'Deepening attention', intensity: 0.6, bpmRange: [58, 64], complexity: 0, warmth: 0.85, harmonyScale: 1.2, lowpassScale: 0.9 },
    { endMin: 25, label: 'Deep', description: 'The still center', intensity: 0.85, bpmRange: [54, 60], complexity: 0, warmth: 0.9, harmonyScale: 1.4, lowpassScale: 0.75 },
    { endMin: null, label: 'Return', description: 'Gently surfacing', intensity: 0.5, bpmRange: [62, 68], complexity: 0, warmth: 0.8, harmonyScale: 1.1, lowpassScale: 1 },
  ],
);

export const PROGRAM_TEMPLATES: readonly ProgramTemplate[] = [
  blank,
  buildArc,
  intimate,
  romantic,
  sensual,
  playful,
  fantasy,
  passionate,
  deepWork90,
  sleepWindDown,
  powerNap26,
  pomodoroFocus,
  meditationJourney,
];

export const ARC_TEMPLATE_IDS: readonly string[] = [
  'deepWork90',
  'sleepWindDown',
  'powerNap26',
  'pomodoroFocus',
  'meditationJourney',
];

export const CONTEXT_TEMPLATE_IDS: readonly string[] = [
  'intimate',
  'romantic',
  'sensual',
  'playful',
  'fantasy',
  'passionate',
];
