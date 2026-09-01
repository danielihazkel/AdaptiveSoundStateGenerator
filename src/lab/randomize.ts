import { LOWPASS_OPEN_HZ, cloneProfile, type NoiseType, type SoundProfile } from '../audio/types';

/**
 * Lab-only exploration: a random but *listenable* profile. Ranges mirror the
 * AdvancedPanel slider bounds; levels are capped conservatively (matching the
 * candidates.ts caps) so a random draw can surprise but never blast. Master
 * volume is deliberately never touched — it is the user's safety control.
 * `rand` is injected so tests can seed it.
 */
export function randomizeProfile(
  base: SoundProfile,
  rand: () => number = Math.random,
): SoundProfile {
  const draft = cloneProfile(base);
  const between = (min: number, max: number) => min + (max - min) * rand();
  const pick = <T>(options: readonly T[]): T =>
    options[Math.min(options.length - 1, Math.floor(rand() * options.length))];

  draft.noise.enabled = rand() < 0.85;
  draft.noise.type = pick<NoiseType>(['white', 'pink', 'brown', 'blue']);
  draft.noise.level = between(0.1, 0.6);

  draft.binaural.enabled = rand() < 0.7;
  draft.binaural.carrier = Math.round(between(100, 400));
  draft.binaural.beat = Math.round(between(2, 20) * 2) / 2;
  draft.binaural.level = between(0.1, 0.4);

  draft.tone.enabled = rand() < 0.35;
  draft.tone.frequency = Math.round(between(120, 600));
  draft.tone.level = between(0.05, 0.2);
  draft.tone.warmth = between(0.3, 0.9);

  draft.isochronic.enabled = rand() < 0.8;
  draft.isochronic.rate = Math.round(between(1, 14) * 2) / 2;
  draft.isochronic.depth = between(0.05, 0.4);

  draft.rhythm.mode = rand() < 0.5 ? 'simple' : 'pattern';
  draft.rhythm.bpm = Math.round(between(60, 140));
  draft.rhythm.complexity = between(0, 0.8);

  draft.harmony.enabled = rand() < 0.45;
  draft.harmony.level = between(0.1, 0.4);
  draft.harmony.richness = between(0.2, 0.9);
  draft.harmony.movement = between(0.1, 0.7);
  draft.harmony.rootHz = Math.round(between(60, 300));

  draft.bass = between(0, 0.6);

  // A room half the time, and never drenched.
  draft.space.level = rand() < 0.5 ? 0 : between(0.05, 0.35);
  draft.space.size = between(0.2, 0.9);

  // Only synth ambience — a random draw must never depend on shipped assets.
  draft.ambience.enabled = rand() < 0.6;
  draft.ambience.type = pick(['rain', 'ocean', 'wind', 'space'] as const);
  draft.ambience.level = between(0.05, 0.4);
  // A second bed now and then — always synth, always quieter than the first.
  draft.ambience2.enabled = draft.ambience.enabled && rand() < 0.3;
  draft.ambience2.type = pick(['rain', 'ocean', 'wind', 'space'] as const);
  draft.ambience2.level = between(0.03, 0.2);

  draft.stereoWidth = between(0.4, 1);
  draft.lowpassHz = Math.round(between(2000, LOWPASS_OPEN_HZ));
  return draft;
}
