import { vi } from 'vitest';
import { cloneProfile, type SoundProfile } from '../audio/types';

/**
 * A stand-in for AudioEngine with no AudioContext: every method the session
 * controller, orchestrator and adaptation loop call, as spies, plus a live
 * profile so `getProfile()` round-trips. Shared by the hook/component tests;
 * the controller's own suite keeps its smaller local stub.
 */
export function fakeEngine(initial?: SoundProfile) {
  const contextListeners = new Set<(state: AudioContextState) => void>();
  let profile: SoundProfile | null = initial ? cloneProfile(initial) : null;
  let mono = false;
  const engine = {
    subscribeContextState: vi.fn((listener: (state: AudioContextState) => void) => {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    }),
    emitContextState: (state: AudioContextState) => {
      for (const l of contextListeners) l(state);
    },
    getProfile: vi.fn(() => (profile ? cloneProfile(profile) : null)),
    applyProfile: vi.fn((next: SoundProfile) => {
      profile = cloneProfile(next);
    }),
    setArcModulation: vi.fn(),
    setProgramModulation: vi.fn(),
    setBreathPattern: vi.fn(),
    setMonoMode: vi.fn((on: boolean) => {
      mono = on;
    }),
    get isMonoMode() {
      return mono;
    },
    get isPlaying() {
      return true;
    },
    contextState: 'running' as AudioContextState,
    playCue: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn(),
    startAlarm: vi.fn(),
    stopAlarm: vi.fn(),
    dispose: vi.fn(),
  };
  return engine;
}

export type FakeEngine = ReturnType<typeof fakeEngine>;
