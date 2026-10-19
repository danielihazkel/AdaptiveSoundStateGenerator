// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NIGHTSTAND_DARK_AFTER_MS, NightstandOverlay } from './NightstandOverlay';

const cover = () => screen.queryByRole('button', { name: /show session controls/i });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NightstandOverlay', () => {
  it('goes dark after a quiet spell and lifts on a tap', () => {
    render(<NightstandOverlay active hold={false} clock="42:00" />);
    expect(cover()).toBeNull();
    act(() => vi.advanceTimersByTime(NIGHTSTAND_DARK_AFTER_MS));
    expect(cover()).not.toBeNull();
    expect(screen.getByText('42:00')).toBeTruthy();

    fireEvent.click(cover()!);
    expect(cover()).toBeNull();
    act(() => vi.advanceTimersByTime(NIGHTSTAND_DARK_AFTER_MS));
    expect(cover()).not.toBeNull();
  });

  it('a touch elsewhere restarts the quiet spell', () => {
    render(<NightstandOverlay active hold={false} clock="42:00" />);
    act(() => vi.advanceTimersByTime(NIGHTSTAND_DARK_AFTER_MS - 1_000));
    fireEvent.keyDown(document.body, { key: 'a' });
    act(() => vi.advanceTimersByTime(5_000));
    expect(cover()).toBeNull();
    act(() => vi.advanceTimersByTime(NIGHTSTAND_DARK_AFTER_MS));
    expect(cover()).not.toBeNull();
  });

  it('stays lifted while held and when inactive', () => {
    const { rerender } = render(<NightstandOverlay active hold clock="1:00" />);
    act(() => vi.advanceTimersByTime(NIGHTSTAND_DARK_AFTER_MS * 2));
    expect(cover()).toBeNull();
    rerender(<NightstandOverlay active={false} hold={false} clock="1:00" />);
    act(() => vi.advanceTimersByTime(NIGHTSTAND_DARK_AFTER_MS * 2));
    expect(cover()).toBeNull();
  });
});
