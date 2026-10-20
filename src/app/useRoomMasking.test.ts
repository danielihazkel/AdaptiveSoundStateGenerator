// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../audio/engine';
import { MAX_MASKING_BOOST } from '../audio/mixPolicy';
import { useRoomMasking } from './useRoomMasking';

let setMasking: ReturnType<typeof vi.fn>;

function setup(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  setMasking = vi.fn();
  const engine = { setMasking } as unknown as AudioEngine;
  return renderHook(() => useRoomMasking({ getEngine: () => engine }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

const lastGain = () => setMasking.mock.calls.at(-1)![0] as number;

describe('useRoomMasking (simulated room)', () => {
  it('a room that fills up lifts the beds toward +3 dB, never past it; stop puts them back', async () => {
    const { result } = setup('?simroom=loud');
    act(() => result.current.start(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000); // baseline minute
    });
    expect(lastGain()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(lastGain()).toBeGreaterThan(1.3);
    expect(Math.max(...setMasking.mock.calls.map((c) => c[0] as number))).toBeLessThanOrEqual(MAX_MASKING_BOOST);
    expect(result.current.getMaxBoostDb()).toBeGreaterThan(2);
    act(() => result.current.stop());
    expect(lastGain()).toBe(1);
  });

  it('a quiet room never boosts, and an inactive leg holds the beds flat', async () => {
    const quiet = setup('?simroom=quiet');
    act(() => quiet.result.current.start(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(lastGain()).toBe(1);
    act(() => quiet.result.current.stop());
    quiet.unmount();

    const loud = setup('?simroom=loud');
    act(() => loud.result.current.start(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(lastGain()).toBe(1);
    act(() => loud.result.current.stop());
  });
});
