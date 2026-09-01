// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATES } from '../audio/states';
import { cloneProfile, type SoundProfile } from '../audio/types';
import { loadInProgress, loadSessions } from '../storage/storage';
import { defaultSettings, type Preset, type Settings } from '../storage/types';
import { fakeEngine, type FakeEngine } from '../test/fakeEngine';
import { OTHER_TAB_SESSION_MESSAGE, START_ERROR_MESSAGE } from '../ui/SafetyNotices';
import type { AdaptationLoop } from './useAdaptationLoop';
import type { Biometrics } from './useBiometrics';
import type { Coach } from './useCoach';
import { useSessionOrchestrator } from './useSessionOrchestrator';
import type { SetupSelection } from './useSetupSelection';

// No AudioContext under jsdom: the engine factory hands out the fake.
let engine: FakeEngine;
let createEngine: (profile: SoundProfile) => Promise<unknown>;
vi.mock('../audio/engine', () => ({
  AudioEngine: { create: (profile: SoundProfile) => createEngine(profile) },
}));
// The keep-alive creates and plays an <audio> element — jsdom has no media.
vi.mock('../platform/silentAudio', () => ({ playSilentKeepAlive: vi.fn() }));

function selectionStub(overrides: Partial<SetupSelection> = {}): SetupSelection {
  return {
    mentalState: 'focus',
    intensity: 0.5,
    minutes: 1,
    selectedPresetId: undefined,
    selectedProgramId: undefined,
    replay: null,
    endAt: null,
    openEnded: false,
    intervals: null,
    resolveMinutes: () => overrides.minutes ?? 1,
    ...overrides,
  } as SetupSelection;
}

function adaptationStub(): AdaptationLoop {
  return {
    microPrompt: null,
    onCheckpoint: vi.fn(),
    answerPrompt: vi.fn(),
    getMeta: vi.fn(() => null),
    beginSession: vi.fn(),
    noteVolumeTweak: vi.fn(),
    disable: vi.fn(),
    finalizeSegments: vi.fn(() => undefined),
  };
}

const biometrics = {
  resetForSession: vi.fn(),
  wasUsed: () => false,
  getSamples: () => [],
} as unknown as Biometrics;
const coach = { consumeApplied: () => false, reset: vi.fn() } as unknown as Coach;

function setup(opts: { settings?: Partial<Settings>; selection?: Partial<SetupSelection>; presets?: Preset[] } = {}) {
  const callbacks = {
    onSessionStored: vi.fn(),
    onPresetSaved: vi.fn(),
    onFinished: vi.fn(),
    onSessionStarted: vi.fn(),
  };
  const adaptation = adaptationStub();
  const hook = renderHook(() =>
    useSessionOrchestrator({
      settings: { ...defaultSettings, ...opts.settings },
      selection: selectionStub(opts.selection),
      presets: opts.presets ?? [],
      programs: [],
      adaptation,
      biometrics,
      coach,
      ...callbacks,
    }),
  );
  return { ...hook, callbacks, adaptation };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  engine = fakeEngine();
  createEngine = async (profile) => {
    engine.applyProfile(profile);
    return engine;
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSessionOrchestrator', () => {
  it('begin: serves the state default during cold start, starts the engine, checkpoints', async () => {
    const { result, callbacks } = setup();
    await act(async () => {
      await result.current.begin();
    });
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(callbacks.onSessionStarted).toHaveBeenCalledTimes(1);
    expect(result.current.starting).toBe(false);
    expect(result.current.startError).toBeNull();
    expect(result.current.liveProfile).toEqual(STATES.focus.buildProfile(0.5));
    const checkpoint = loadInProgress();
    expect(checkpoint).toMatchObject({
      state: 'focus',
      plannedDurationSec: 60,
      servedArmId: 'prior',
      servedBy: 'prior',
      elapsedSec: 0,
    });
  });

  it('records a completed session and routes to the feedback screen', async () => {
    const { result, callbacks, adaptation } = setup();
    await act(async () => {
      await result.current.begin();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(callbacks.onFinished).toHaveBeenCalledWith('feedback');
    expect(callbacks.onSessionStored).toHaveBeenCalledTimes(1);
    expect(adaptation.finalizeSegments).toHaveBeenCalledWith(60);
    const sessions = loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      state: 'focus',
      intensity: 0.5,
      plannedDurationSec: 60,
      actualDurationSec: 60,
      completed: true,
      customized: false,
      volumeAdjustments: 0,
      servedArmId: 'prior',
      servedBy: 'prior',
      monoMode: false,
    });
    expect(loadInProgress()).toBeNull();
    expect(result.current.getLastSession()).toMatchObject({ recordId: sessions[0].id, completed: true });
  });

  it('a completed sleep session skips the rating (the morning prompt asks instead)', async () => {
    const { result, callbacks } = setup({ selection: { mentalState: 'sleep', minutes: 2 } });
    await act(async () => {
      await result.current.begin();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(125_000);
    });
    expect(callbacks.onFinished).toHaveBeenCalledWith('setup');
    expect(loadSessions()[0]).toMatchObject({ state: 'sleep', completed: true });
  });

  it('an early stop is recorded as not completed and still rated', async () => {
    const { result, callbacks } = setup();
    await act(async () => {
      await result.current.begin();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      result.current.stop();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(callbacks.onFinished).toHaveBeenCalledWith('feedback');
    expect(loadSessions()[0]).toMatchObject({ completed: false, actualDurationSec: 10 });
  });

  it('a preset session plays the preset and stays out of the bandit', async () => {
    const preset: Preset = {
      id: 'p1',
      name: 'Mine',
      createdAt: new Date().toISOString(),
      state: 'focus',
      intensity: 0.8,
      profile: (() => {
        const p = STATES.focus.buildProfile(0.8);
        p.noise.type = 'white';
        return p;
      })(),
    };
    const { result, adaptation } = setup({ presets: [preset], selection: { selectedPresetId: 'p1' } });
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.liveProfile?.noise.type).toBe('white');
    expect(adaptation.beginSession).toHaveBeenCalledWith(
      expect.objectContaining({ servedArmId: null, intensity: 0.8 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    const record = loadSessions()[0];
    expect(record.presetId).toBe('p1');
    expect(record.servedBy).toBe('preset');
    expect(record.servedArmId).toBeUndefined();
  });

  it('separates volume tweaks (implicit signal) from sound customization', async () => {
    const { result, adaptation } = setup();
    await act(async () => {
      await result.current.begin();
    });
    const base = result.current.liveProfile!;
    const louder = cloneProfile(base);
    louder.masterVolume = Math.min(0.85, base.masterVolume + 0.1);
    act(() => result.current.handleProfileChange(louder));
    expect(adaptation.noteVolumeTweak).toHaveBeenCalledTimes(1);
    expect(adaptation.disable).not.toHaveBeenCalled();
    expect(engine.applyProfile).toHaveBeenLastCalledWith(louder);

    const retuned = cloneProfile(louder);
    retuned.binaural.beat += 2;
    act(() => result.current.handleProfileChange(retuned));
    expect(adaptation.disable).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(loadSessions()[0]).toMatchObject({ volumeAdjustments: 1, customized: true });
  });

  it('surfaces an engine start failure instead of rejecting', async () => {
    createEngine = async () => {
      throw new Error('AudioContext blocked');
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, callbacks } = setup();
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.startError).toBe(START_ERROR_MESSAGE);
    expect(result.current.starting).toBe(false);
    expect(callbacks.onSessionStarted).not.toHaveBeenCalled();
    expect(loadInProgress()).toBeNull();
    consoleError.mockRestore();
  });

  it('refuses to start while another tab holds the session lock, and holds it itself', async () => {
    let holder: string | null = 'other-tab';
    const locks = {
      request: async (_name: string, _opts: unknown, cb: (lock: object | null) => Promise<unknown>) => {
        if (holder) return cb(null);
        holder = 'me';
        try {
          return await cb({});
        } finally {
          holder = null;
        }
      },
    };
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    try {
      const { result, callbacks } = setup();
      await act(async () => {
        await result.current.begin();
      });
      expect(result.current.startError).toBe(OTHER_TAB_SESSION_MESSAGE);
      expect(callbacks.onSessionStarted).not.toHaveBeenCalled();
      expect(engine.start).not.toHaveBeenCalled();

      holder = null;
      await act(async () => {
        await result.current.begin();
      });
      expect(result.current.startError).toBeNull();
      expect(holder).toBe('me');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(holder).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    }
  });

  it('saves a preset from the finished session', async () => {
    const { result, callbacks } = setup();
    await act(async () => {
      await result.current.begin();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    act(() => result.current.storePreset('Keep this', result.current.getLastSession()));
    expect(callbacks.onPresetSaved).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('resonance.v1.presets')!).items[0]).toMatchObject({
      name: 'Keep this',
      state: 'focus',
    });
  });
});
