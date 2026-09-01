// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_TIMEOUT_SEC } from '../adaptation/adaptation';
import type { AudioEngine } from '../audio/engine';
import { ADAPT_RAMP_TIME_CONSTANT } from '../audio/ramp';
import { STATES } from '../audio/states';
import type { SessionController } from '../session/sessionController';
import { fakeEngine, type FakeEngine } from '../test/fakeEngine';
import { useAdaptationLoop, type SessionMeta } from './useAdaptationLoop';

let engine: FakeEngine;
let controller: { applyProfile: ReturnType<typeof vi.fn> };
const setLiveProfile = vi.fn();

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    state: 'focus',
    intensity: 0.5,
    mode: 'explore',
    coachUsed: false,
    servedArmId: 'prior',
    ...overrides,
  };
}

function setup() {
  return renderHook(() =>
    useAdaptationLoop({
      getEngine: () => engine as unknown as AudioEngine,
      getController: () => controller as unknown as SessionController,
      getHrSamples: () => [],
      setLiveProfile,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  engine = fakeEngine(STATES.focus.buildProfile(0.5));
  controller = { applyProfile: vi.fn() };
  setLiveProfile.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAdaptationLoop', () => {
  it('shows the check-in at a checkpoint and "worse" glides to a different arm', () => {
    const { result } = setup();
    act(() => result.current.beginSession(meta()));
    expect(result.current.microPrompt).toBeNull();
    act(() => result.current.onCheckpoint({ index: 0, elapsedSec: 600 }));
    expect(result.current.microPrompt).toEqual({ index: 0, elapsedSec: 600 });

    act(() => result.current.answerPrompt('worse'));
    expect(result.current.microPrompt).toBeNull();
    expect(controller.applyProfile).toHaveBeenCalledTimes(1);
    const [next, timeConstant] = controller.applyProfile.mock.calls[0];
    expect(timeConstant).toBe(ADAPT_RAMP_TIME_CONSTANT);
    // The user's volume is never stomped by an adaptation switch.
    expect(next.masterVolume).toBe(engine.getProfile()!.masterVolume);
    expect(setLiveProfile).toHaveBeenCalledWith(next);

    const segments = result.current.finalizeSegments(1200)!;
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ armId: 'prior', startSec: 0, endSec: 600, response: 'worse', trigger: 'initial' });
    expect(segments[1].armId).not.toBe('prior');
    expect(segments[1]).toMatchObject({ startSec: 600, endSec: 1200, trigger: 'explicit' });
  });

  it('"better" keeps the arm but the answer is still recorded', () => {
    const { result } = setup();
    act(() => result.current.beginSession(meta()));
    act(() => result.current.onCheckpoint({ index: 0, elapsedSec: 600 }));
    act(() => result.current.answerPrompt('better'));
    expect(controller.applyProfile).not.toHaveBeenCalled();
    const segments = result.current.finalizeSegments(900)!;
    expect(segments.map((s) => s.armId)).toEqual(['prior', 'prior']);
    expect(segments[0].response).toBe('better');
  });

  it('an unanswered prompt times out and counts as no signal', () => {
    const { result } = setup();
    act(() => result.current.beginSession(meta()));
    act(() => result.current.onCheckpoint({ index: 0, elapsedSec: 600 }));
    act(() => {
      vi.advanceTimersByTime(PROMPT_TIMEOUT_SEC * 1000 + 10);
    });
    expect(result.current.microPrompt).toBeNull();
    expect(controller.applyProfile).not.toHaveBeenCalled();
    // Nothing adapted → the record keeps the legacy single-arm shape.
    expect(result.current.finalizeSegments(900)).toBeUndefined();
  });

  it('sleep never prompts and never switches', () => {
    const { result } = setup();
    act(() => result.current.beginSession(meta({ state: 'sleep' })));
    act(() => result.current.onCheckpoint({ index: 0, elapsedSec: 600 }));
    expect(result.current.microPrompt).toBeNull();
    expect(controller.applyProfile).not.toHaveBeenCalled();
    expect(result.current.finalizeSegments(1200)).toBeUndefined();
  });

  it('presets / programs (no served arm) and manual control opt out', () => {
    const { result } = setup();
    act(() => result.current.beginSession(meta({ servedArmId: null })));
    act(() => result.current.onCheckpoint({ index: 0, elapsedSec: 600 }));
    expect(result.current.microPrompt).toBeNull();
    expect(result.current.finalizeSegments(900)).toBeUndefined();

    act(() => result.current.beginSession(meta()));
    act(() => result.current.onCheckpoint({ index: 0, elapsedSec: 600 }));
    expect(result.current.microPrompt).not.toBeNull();
    act(() => result.current.disable());
    expect(result.current.microPrompt).toBeNull();
    act(() => result.current.onCheckpoint({ index: 1, elapsedSec: 1200 }));
    expect(result.current.microPrompt).toBeNull();
  });

  it('volume tweaks are attributed to the open segment', () => {
    const { result } = setup();
    act(() => result.current.beginSession(meta()));
    act(() => {
      result.current.noteVolumeTweak();
      result.current.noteVolumeTweak();
    });
    act(() => result.current.onCheckpoint({ index: 0, elapsedSec: 600 }));
    act(() => result.current.answerPrompt('same'));
    const segments = result.current.finalizeSegments(700)!;
    expect(segments[0].volumeAdjustments).toBe(2);
    expect(segments[1].volumeAdjustments).toBe(0);
  });
});
