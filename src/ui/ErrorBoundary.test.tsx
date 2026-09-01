// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetReloadGate, setReloadBusy } from '../app/reloadGate';
import { markUpdateReady, resetSwUpdate, setUpdateHandler } from '../app/swUpdate';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ error }: { error: unknown }): never {
  throw error;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetReloadGate();
  resetSwUpdate();
  // React logs caught render errors; keep the test output quiet.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('degrades a throwing child to a notice with Try again', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('kaboom');
      return <p>recovered</p>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('kaboom');
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('offers Reload for a failed chunk fetch, deferred while the app is busy', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(
      <ErrorBoundary>
        <Bomb error={new TypeError('Failed to fetch dynamically imported module: /a.js')} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("couldn't be loaded");
    setReloadBusy(true);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).not.toHaveBeenCalled();
    setReloadBusy(false);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('applies a waiting service-worker update instead of a plain reload', async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    setUpdateHandler(apply);
    markUpdateReady();
    render(
      <ErrorBoundary>
        <Bomb error={Object.assign(new Error('x'), { name: 'ChunkLoadError' })} />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('uses a custom fallback when given', () => {
    render(
      <ErrorBoundary fallback={(err) => <em>custom: {String((err as Error).message)}</em>}>
        <Bomb error={new Error('why')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom: why')).toBeInTheDocument();
  });
});
