// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function Harness(props: { onSpace: () => void; enabled?: boolean; modal?: boolean }) {
  useKeyboardShortcuts({ ' ': props.onSpace }, props.enabled);
  return (
    <div>
      <h1 tabIndex={-1}>Heading</h1>
      <input aria-label="text" />
      <button type="button">Pause</button>
      {props.modal && <div role="dialog" aria-modal="true" />}
    </div>
  );
}

describe('useKeyboardShortcuts', () => {
  it('fires from the page and suppresses the default scroll', () => {
    const onSpace = vi.fn();
    const { getByText } = render(<Harness onSpace={onSpace} />);
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    getByText('Heading').dispatchEvent(event);
    expect(onSpace).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves keys to inputs and buttons that own them', () => {
    const onSpace = vi.fn();
    const { getByLabelText, getByText } = render(<Harness onSpace={onSpace} />);
    fireEvent.keyDown(getByLabelText('text'), { key: ' ' });
    // Space on a focused button already clicks it — a second toggle would undo it.
    fireEvent.keyDown(getByText('Pause'), { key: ' ' });
    expect(onSpace).not.toHaveBeenCalled();
  });

  it('ignores modifiers, open dialogs and a disabled hook', () => {
    const onSpace = vi.fn();
    const { rerender } = render(<Harness onSpace={onSpace} />);
    fireEvent.keyDown(document.body, { key: ' ', ctrlKey: true });
    rerender(<Harness onSpace={onSpace} modal />);
    fireEvent.keyDown(document.body, { key: ' ' });
    rerender(<Harness onSpace={onSpace} enabled={false} />);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(onSpace).not.toHaveBeenCalled();
  });
});
