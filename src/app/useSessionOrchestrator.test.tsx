// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATES } from '../audio/states';
import { cloneProfile, type SoundProfile } from '../audio/types';
import { buildCandidateProfile } from '../personalization/candidates';
import { SCENE_BY_ID, scenePreset } from '../scenes/scenes';
import { SessionController } from '../session/sessionController';
import { defaultProgram, programMinDurationSec, type Program } from '../programs/types';
import { loadInProgress, loadSessions } from '../storage/storage';
import { defaultSettings, type Preset, type Settings } from '../storage/types';
import { fakeEngine, type FakeEngine } from '../test/fakeEngine';
import { OTHER_TAB_SESSION_MESSAGE, START_ERROR_MESSAGE } from '../ui/SafetyNotices';
import type { AdaptationLoop } from './useAdaptationLoop';
import type { Biometrics } from './useBiometrics';
import type { Coach } from './useCoach';
import type { Motion } from './useMotion';
import type { RoomMasking } from './useRoomMasking';
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
    getCurrentArmId: vi.fn(() => null),
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
const motion = {
  possible: false,
  start: vi.fn(async () => {}),
  resetForSession: vi.fn(),
  wasUsed: () => false,
  getSamples: () => [],
} as unknown as Motion;
const roomMasking = {
  possible: false,
  start: vi.fn(),
  setActive: vi.fn(),
  stop: vi.fn(),
  getMaxBoostDb: () => null,
} as unknown as RoomMasking;

function setup(
  opts: {
    settings?: Partial<Settings>;
    selection?: Partial<SetupSelection>;
    presets?: Preset[];
    programs?: Program[];
  } = {},
) {
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
      programs: opts.programs ?? [],
      adaptation,
      biometrics,
      motion,
      roomMasking,
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

  it('a pinned arm ("Try this one") plays exactly that arm, ignoring the selection, with no check-ins', async () => {
    const start = vi.spyOn(SessionController.prototype, 'start');
    const { result } = setup({
      selection: { mentalState: 'relax', intensity: 0.2, selectedPresetId: 'ignored', openEnded: true },
    });
    await act(async () => {
      await result.current.begin({ pinArm: { state: 'focus', armId: 'bass-up', intensity: 0.7 } });
    });
    expect(result.current.liveProfile).toEqual(buildCandidateProfile('focus', 0.7, 'bass-up'));
    expect(result.current.getServedInfo()).toMatchObject({
      kind: 'served',
      served: { armId: 'bass-up', servedBy: 'pinned' },
    });
    // No adaptation checkpoints: the user picked this sound on purpose.
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'focus', checkpointSec: undefined, openEnded: false }),
    );
    start.mockRestore();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(loadSessions()[0]).toMatchObject({
      state: 'focus',
      intensity: 0.7,
      servedArmId: 'bass-up',
      servedBy: 'pinned',
    });
  });

  it('Phase 17: a scene plays as a virtual preset — tagged, no arm, no check-ins', async () => {
    const campfire = scenePreset(SCENE_BY_ID.get('scene:campfire')!);
    const { result, adaptation } = setup({
      presets: [campfire],
      selection: { mentalState: 'relax', selectedPresetId: 'scene:campfire' },
    });
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.liveProfile?.ambience.type).toBe('fireplace');
    expect(adaptation.beginSession).toHaveBeenCalledWith(expect.objectContaining({ servedArmId: null }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(loadSessions()[0]).toMatchObject({ presetId: 'scene:campfire', servedBy: 'preset' });
    expect(loadSessions()[0].servedArmId).toBeUndefined();
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

  it('counts one volume tweak per gesture, not per slider input event', async () => {
    const { result, adaptation } = setup();
    await act(async () => {
      await result.current.begin();
    });
    // A slider drag fires onChange for every step it passes through.
    const drag = (from: number, steps: number) => {
      for (let i = 1; i <= steps; i++) {
        const next = cloneProfile(result.current.liveProfile!);
        next.masterVolume = from + i * 0.01;
        act(() => result.current.handleProfileChange(next));
        act(() => vi.advanceTimersByTime(30));
      }
    };
    drag(0.5, 10);
    expect(adaptation.noteVolumeTweak).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2_000));
    drag(0.6, 5);
    expect(adaptation.noteVolumeTweak).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(loadSessions()[0]).toMatchObject({ volumeAdjustments: 2, customized: false });
  });

  it('plays a routine leg by leg: one record each, no fade between, one rating screen', async () => {
    const { result, callbacks, adaptation } = setup();
    const routine = {
      id: 'r1',
      name: 'Kick-off',
      createdAt: '2026-10-19T08:00:00.000Z',
      legs: [
        { state: 'energy' as const, intensity: 0.5, minutes: 1 },
        { state: 'focus' as const, intensity: 0.6, minutes: 1 },
      ],
    };
    await act(async () => {
      await result.current.beginRoutine(routine);
    });
    expect(callbacks.onSessionStarted).toHaveBeenCalledTimes(1);
    expect(result.current.routineLeg).toEqual({ id: 'r1', name: 'Kick-off', leg: 0, legs: 2 });
    expect(loadInProgress()).toMatchObject({ state: 'energy', routine: { leg: 0 } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    // Leg one is recorded, leg two is playing — with no end fade in between.
    let sessions = loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ state: 'energy', completed: true, routine: { id: 'r1', leg: 0, legs: 2 } });
    expect(engine.endSession).not.toHaveBeenCalled();
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(callbacks.onFinished).not.toHaveBeenCalled();
    expect(result.current.routineLeg?.leg).toBe(1);
    expect(adaptation.beginSession).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'focus' }));
    expect(loadInProgress()).toMatchObject({ state: 'focus', routine: { leg: 1 } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    sessions = loadSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ state: 'focus', routine: { leg: 1, legs: 2 } });
    expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
    expect(callbacks.onFinished).toHaveBeenCalledWith('feedback');
    expect(result.current.routineLeg).toBeNull();
    expect(result.current.getLastSession()?.routineLegs).toEqual([
      { recordId: sessions[1].id, state: 'energy' },
    ]);
  });

  it('Phase 17: a routine leg can run a saved program — its sound and phases, no bandit', async () => {
    const program = { ...defaultProgram('relax', 0.3), id: 'prog-1', name: 'Unwind' };
    const { result, adaptation } = setup({ programs: [program] });
    const continueWith = vi.spyOn(SessionController.prototype, 'continueWith');
    const routine = {
      id: 'r3',
      name: 'Work then unwind',
      createdAt: '2026-10-19T08:00:00.000Z',
      legs: [
        { state: 'focus' as const, intensity: 0.5, minutes: 1 },
        // The leg's own state/depth are ignored: the program owns them.
        { state: 'energy' as const, intensity: 0.9, minutes: 1, programId: 'prog-1' },
      ],
    };
    await act(async () => {
      await result.current.beginRoutine(routine);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(continueWith).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'relax',
        intensity: program.baseIntensity,
        program,
        checkpointSec: undefined,
        breathing: undefined,
        // At least the program's closed phases.
        durationSec: programMinDurationSec(program),
      }),
    );
    expect(adaptation.beginSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'relax', servedArmId: null }),
    );
    expect(result.current.getSessionProgram()).toBe(program);
    expect(result.current.getServedInfo()).toEqual({ kind: 'program', served: null });
    expect(loadInProgress()).toMatchObject({ state: 'relax', programId: 'prog-1', routine: { leg: 1 } });
    continueWith.mockRestore();
  });

  it('Phase 17: a routine before-mood lands on the final leg, and is context only where its axis applies', async () => {
    const { result, adaptation } = setup();
    await act(async () => {
      await result.current.beginRoutine(
        {
          id: 'r5',
          name: 'Into focus',
          createdAt: '2026-10-19T08:00:00.000Z',
          legs: [
            { state: 'energy', intensity: 0.5, minutes: 1 },
            { state: 'focus', intensity: 0.5, minutes: 1 },
          ],
        },
        { moodBefore: 2 },
      );
    });
    // Leg one (energy) is on another axis: no mood there.
    expect(adaptation.beginSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'energy', moodBefore: undefined }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(adaptation.beginSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'focus', moodBefore: 2 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    const [last, first] = loadSessions();
    expect(first.moodBefore).toBeUndefined();
    expect(last).toMatchObject({ state: 'focus', moodBefore: 2 });
    expect(result.current.getLastSession()?.moodBefore).toBe(2);
  });

  it('Phase 17: a leg whose program was deleted plays a served sound instead', async () => {
    const { result, adaptation } = setup();
    await act(async () => {
      await result.current.beginRoutine({
        id: 'r4',
        name: 'Gone',
        createdAt: '2026-10-19T08:00:00.000Z',
        legs: [
          { state: 'focus', intensity: 0.5, minutes: 1, programId: 'deleted' },
          { state: 'relax', intensity: 0.5, minutes: 1 },
        ],
      });
    });
    expect(adaptation.beginSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'focus', servedArmId: 'prior' }),
    );
    expect(result.current.getSessionProgram()).toBeNull();
  });

  it('stopping mid-routine ends the routine at that leg', async () => {
    const { result, callbacks } = setup();
    const routine = {
      id: 'r2',
      name: 'Two',
      createdAt: '2026-10-19T08:00:00.000Z',
      legs: [
        { state: 'focus' as const, intensity: 0.5, minutes: 1 },
        { state: 'relax' as const, intensity: 0.5, minutes: 1 },
      ],
    };
    await act(async () => {
      await result.current.beginRoutine(routine);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      result.current.stop();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(loadSessions()).toHaveLength(1);
    expect(loadSessions()[0]).toMatchObject({ completed: false, routine: { leg: 0 } });
    expect(callbacks.onFinished).toHaveBeenCalledWith('feedback');
    expect(result.current.routineLeg).toBeNull();
    expect(result.current.getLastSession()?.routineLegs).toBeUndefined();
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

  it('records the optional mood going in, through the crash checkpoint too', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.begin({ moodBefore: 2 });
    });
    expect(loadInProgress()).toMatchObject({ moodBefore: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(loadSessions()[0].moodBefore).toBe(2);
    expect(result.current.getLastSession()?.moodBefore).toBe(2);
  });
});
