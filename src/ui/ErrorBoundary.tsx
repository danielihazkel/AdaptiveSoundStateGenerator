import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorMessage, isChunkLoadError } from '../app/appErrors';
import { requestReload } from '../app/reloadGate';
import { applyUpdate, getUpdateReady } from '../app/swUpdate';

interface Props {
  children: ReactNode;
  /** Custom fallback; the default is a notice with Reload / Try again. */
  fallback?: (error: unknown, reset: () => void) => ReactNode;
}

interface State {
  error: unknown | null;
}

/**
 * Reload the page. A lazily-loaded chunk that fails to fetch usually means a
 * new build was deployed and the old chunk is gone — if a service-worker
 * update is waiting, applying it *is* the reload. Either way it goes through
 * reloadGate so a playing session or a running export is never cut off.
 */
export function reloadForChunkError(): void {
  if (getUpdateReady()) {
    applyUpdate();
  } else {
    requestReload(() => window.location.reload());
  }
}

/**
 * Catches render errors below it so one broken screen degrades to a notice
 * instead of a blank app. Give it a `key` that changes with the screen so
 * navigating away resets it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Screen crashed:', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} onReset={this.reset} />;
  }
}

export function DefaultFallback({ error, onReset }: { error: unknown; onReset: () => void }) {
  const chunk = isChunkLoadError(error);
  return (
    <div className="notice warning error-fallback" role="alert">
      <span>
        {chunk
          ? "This part of the app couldn't be loaded — it may have been updated since you opened it."
          : `Something went wrong here (${errorMessage(error)}). Your data is safe; if this keeps happening, export it from “Your data”.`}
      </span>
      {chunk ? (
        <button type="button" className="chip" onClick={reloadForChunkError}>
          Reload
        </button>
      ) : (
        <button type="button" className="chip" onClick={onReset}>
          Try again
        </button>
      )}
    </div>
  );
}
