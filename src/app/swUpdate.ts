import { requestReload } from './reloadGate';

/**
 * Service-worker update flow (vite-plugin-pwa `registerType: 'prompt'`).
 * A new build is *announced*, never applied on its own: the UpdateToast asks,
 * and only "Update" reloads — still through reloadGate, so a tap mid-session
 * or mid-export waits until nothing would be lost.
 *
 * Plain external store, no `virtual:pwa-register` import, so it's testable
 * in node; main.tsx wires the real `updateSW` in as the handler.
 */
export type UpdateStatus =
  /** Nothing waiting. */
  | 'idle'
  /** A new build is installed and waiting; the toast is showing. */
  | 'ready'
  /** The user tapped Update while busy; reloads as soon as the app is idle. */
  | 'scheduled'
  /** The user tapped Later; stays hidden until the next `markUpdateReady`. */
  | 'dismissed';

let status: UpdateStatus = 'idle';
let handler: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateStatus): void {
  if (status === next) return;
  status = next;
  for (const l of listeners) l();
}

export function setUpdateHandler(apply: () => void): void {
  handler = apply;
}

/** onNeedRefresh: a waiting service worker is ready to take over. */
export function markUpdateReady(): void {
  if (status === 'scheduled') return; // already on its way
  set('ready');
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function getUpdateReady(): boolean {
  return status === 'ready' || status === 'scheduled' || status === 'dismissed';
}

export function subscribeUpdateReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The user's explicit choice to update. Goes through reloadGate: if a session
 * or export is running the reload is queued and the toast says so.
 */
export function applyUpdate(): void {
  if (!handler) return;
  const apply = handler;
  set('scheduled');
  requestReload(() => {
    set('idle');
    apply();
  });
}

export function dismissUpdate(): void {
  if (status === 'ready') set('dismissed');
}

/** Test hook. */
export function resetSwUpdate(): void {
  status = 'idle';
  handler = null;
  listeners.clear();
}
