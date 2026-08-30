/**
 * Defers a page reload (service-worker update) while something would be lost
 * by it: a playing session or an MP3 export in progress. The app marks itself
 * busy/idle; a reload requested while busy runs as soon as it goes idle.
 */
let busy = false;
let pending: (() => void) | null = null;

export function setReloadBusy(next: boolean): void {
  busy = next;
  if (!busy && pending) {
    const run = pending;
    pending = null;
    run();
  }
}

export function requestReload(reload: () => void): void {
  if (busy) {
    pending = reload;
    return;
  }
  reload();
}

/** Test hook. */
export function resetReloadGate(): void {
  busy = false;
  pending = null;
}
