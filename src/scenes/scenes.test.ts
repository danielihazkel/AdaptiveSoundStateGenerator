import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { normalizeProfile } from '../audio/types';
import { isSceneId, SCENE_BY_ID, SCENES, scenePreset, scenesFor } from './scenes';

describe('scenes (Phase 17)', () => {
  it('have unique, stable scene: ids and live in real states', () => {
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(SCENES.length);
    for (const s of SCENES) {
      expect(isSceneId(s.id)).toBe(true);
      expect(STATES[s.state]).toBeDefined();
      expect(SCENE_BY_ID.get(s.id)).toBe(s);
    }
    expect(isSceneId('my-preset')).toBe(false);
    expect(isSceneId(undefined)).toBe(false);
  });

  it('build complete, normalized profiles that keep their state’s beat', () => {
    for (const s of SCENES) {
      for (const depth of [0, s.intensity, 1]) {
        const profile = s.build(depth);
        expect(normalizeProfile(profile)).toEqual(profile);
        expect(profile.binaural.beat).toBe(STATES[s.state].buildProfile(depth).binaural.beat);
        expect(profile.ambience.enabled).toBe(true);
        expect(profile.masterVolume).toBe(STATES[s.state].buildProfile(depth).masterVolume);
      }
    }
  });

  it('play as a virtual preset at the scene’s own depth', () => {
    const night = SCENE_BY_ID.get('scene:night-train')!;
    const preset = scenePreset(night);
    expect(preset).toMatchObject({ id: 'scene:night-train', name: 'Night train', state: 'sleep', intensity: night.intensity });
    expect(preset.profile).toEqual(night.build(night.intensity));
    expect(scenePreset(night)).toEqual(preset);
    expect(scenesFor('sleep').map((s) => s.id)).toContain('scene:night-train');
    expect(scenesFor('energy')).toEqual([]);
  });
});
