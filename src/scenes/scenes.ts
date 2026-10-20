import { STATES, type MentalState } from '../audio/states';
import { normalizeProfile, type SoundProfile } from '../audio/types';
import type { Preset } from '../storage/types';

/**
 * Scenes (Phase 17): curated starting points with a sense of place — a
 * rainy library, a night train, a campfire — built from the layers the
 * engine already has (ambience beds, noise colour, the harmonic pad, bass,
 * room). Each is a state's default sound with a few overrides, so a scene
 * keeps its state's beat, pulse and arc.
 *
 * In play a scene behaves exactly like a saved sound: it is offered to the
 * session as a preset with the stable id `scene:<id>` (scenePreset), so the
 * record says presetId 'scene:…' / servedBy 'preset' — no bandit credit
 * (no source arm resolves), no mid-session adaptation, outside the
 * personalization-lift comparison.
 */
export interface Scene {
  /** Stable — persisted as SessionRecord.presetId. */
  id: `scene:${string}`;
  name: string;
  emoji: string;
  description: string;
  state: MentalState;
  /** Depth the scene plays at. */
  intensity: number;
  build(intensity: number): SoundProfile;
}

type Overrides = (p: SoundProfile) => void;

function scene(
  id: string,
  name: string,
  emoji: string,
  description: string,
  state: MentalState,
  intensity: number,
  overrides: Overrides,
): Scene {
  return {
    id: `scene:${id}`,
    name,
    emoji,
    description,
    state,
    intensity,
    build(depth: number) {
      const profile = STATES[state].buildProfile(depth);
      overrides(profile);
      return normalizeProfile(profile);
    },
  };
}

export const SCENES: readonly Scene[] = [
  scene('rainy-library', 'Rainy library', '📚', 'Steady rain on tall windows, a hush, a soft pad far off.', 'focus', 0.5, (p) => {
    p.ambience = { enabled: true, type: 'rain', level: 0.35 };
    p.noise = { ...p.noise, type: 'pink', level: Math.min(p.noise.level, 0.2) };
    p.harmony = { enabled: true, level: 0.08, richness: 0.3, movement: 0.2, rootHz: 130 };
    p.tone.warmth = Math.max(p.tone.warmth, 0.6);
    p.lowpassHz = Math.min(p.lowpassHz, 9000);
    p.space = { level: 0.15, size: 0.7 };
  }),
  scene('ocean-study', 'Ocean study', '🌊', 'Slow waves under a desk lamp — wide, even, unhurried.', 'focus', 0.45, (p) => {
    p.ambience = { enabled: true, type: 'ocean', level: 0.3 };
    p.noise = { ...p.noise, type: 'pink', level: Math.min(p.noise.level, 0.2) };
    p.stereoWidth = Math.max(p.stereoWidth, 0.8);
  }),
  scene('cafe-corner', 'Café corner', '☕', 'A murmuring café and the odd clink, for ideas that like company.', 'creative', 0.5, (p) => {
    p.ambience = { enabled: true, type: 'cafe', level: 0.4 };
    p.noise = { ...p.noise, type: 'brown', level: Math.min(p.noise.level, 0.15) };
  }),
  scene('campfire', 'Campfire', '🔥', 'A crackling fire, a warm low pad, the night close around.', 'relax', 0.45, (p) => {
    p.ambience = { enabled: true, type: 'fireplace', level: 0.45 };
    p.ambience2 = { enabled: true, type: 'wind', level: 0.12 };
    p.harmony = { enabled: true, level: 0.18, richness: 0.5, movement: 0.4, rootHz: 110 };
    p.bass = Math.max(p.bass, 0.25);
    p.lowpassHz = Math.min(p.lowpassHz, 6000);
    p.space = { level: 0.2, size: 0.4 };
  }),
  scene('forest-dawn', 'Forest dawn', '🌲', 'First birds in the trees, an open sky, a slow breath of a pad.', 'meditation', 0.5, (p) => {
    p.ambience = { enabled: true, type: 'forest', level: 0.4 };
    p.harmony = { ...p.harmony, enabled: true, richness: 0.5, movement: 0.5 };
    p.space = { level: 0.3, size: 0.8 };
  }),
  scene('night-train', 'Night train', '🚆', 'A low, endless rumble and wind past the window — rocked to sleep.', 'sleep', 0.5, (p) => {
    p.noise = { ...p.noise, enabled: true, type: 'brown', level: Math.max(p.noise.level, 0.45) };
    p.ambience = { enabled: true, type: 'wind', level: 0.18 };
    p.bass = Math.max(p.bass, 0.45);
    p.lowpassHz = Math.min(p.lowpassHz, 2500);
  }),
  scene('rain-on-roof', 'Rain on the roof', '🌧️', 'Soft rain overhead and a deep, dark hush beneath it.', 'sleep', 0.45, (p) => {
    p.ambience = { enabled: true, type: 'rain', level: 0.4 };
    p.noise = { ...p.noise, enabled: true, type: 'brown', level: Math.min(Math.max(p.noise.level, 0.25), 0.35) };
    p.lowpassHz = Math.min(p.lowpassHz, 3000);
  }),
];

export const SCENE_BY_ID: ReadonlyMap<string, Scene> = new Map(SCENES.map((s) => [s.id, s]));

export function scenesFor(state: MentalState): Scene[] {
  return SCENES.filter((s) => s.state === state);
}

/** The scene as the session sees it: a (virtual, never stored) preset. */
export function scenePreset(s: Scene): Preset {
  return {
    id: s.id,
    name: s.name,
    // Fixed, so the object is stable across renders and imports.
    createdAt: '2026-10-20T00:00:00.000Z',
    state: s.state,
    intensity: s.intensity,
    profile: s.build(s.intensity),
  };
}

export function isSceneId(id: string | undefined): boolean {
  return id !== undefined && id.startsWith('scene:');
}
