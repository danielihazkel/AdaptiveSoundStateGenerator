/**
 * Last-resort surface for errors nothing else caught: unhandled promise
 * rejections and uncaught exceptions outside React's render tree (audio
 * callbacks, timers, dynamic imports). The app keeps running — a playing
 * session must never be killed by a background failure — but the user is
 * told, the same way storage failures are surfaced.
 *
 * Plain external store (useSyncExternalStore-compatible); no React import so
 * it is testable in node and usable before the app mounts.
 */
export interface AppError {
  message: string;
  at: number; // epoch ms
  /** A lazily-loaded screen chunk failed to fetch (stale service worker / offline). */
  chunkLoad: boolean;
}

const MAX_MESSAGE_CHARS = 120;

let current: AppError | null = null;
const listeners = new Set<() => void>();

/**
 * Vite/browsers phrase a failed dynamic import several ways; all of them mean
 * the same thing for us: the deployed chunk is gone or unreachable.
 */
export function isChunkLoadError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'ChunkLoadError') return true;
  const message = errorMessage(err);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|Loading CSS chunk/i.test(
    message,
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export function reportAppError(err: unknown): void {
  const raw = errorMessage(err).trim() || 'Unknown error';
  current = {
    message: raw.length > MAX_MESSAGE_CHARS ? raw.slice(0, MAX_MESSAGE_CHARS - 1) + '…' : raw,
    at: Date.now(),
    chunkLoad: isChunkLoadError(err),
  };
  for (const l of listeners) l();
}

export function getAppError(): AppError | null {
  return current;
}

export function clearAppError(): void {
  if (current === null) return;
  current = null;
  for (const l of listeners) l();
}

export function subscribeAppErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Wire the window-level handlers once at boot. Returns an uninstaller (tests). */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onRejection = (event: PromiseRejectionEvent) => reportAppError(event.reason);
  const onError = (event: ErrorEvent) => reportAppError(event.error ?? event.message);
  target.addEventListener('unhandledrejection', onRejection);
  target.addEventListener('error', onError);
  return () => {
    target.removeEventListener('unhandledrejection', onRejection);
    target.removeEventListener('error', onError);
  };
}

/** Test hook. */
export function resetAppErrors(): void {
  current = null;
  listeners.clear();
}
