import { useSyncExternalStore } from 'react';
import type { SessionController, SessionSnapshot } from './sessionController';

/** Subscribes a component to the session controller's phase/timer snapshot. */
export function useSession(controller: SessionController): SessionSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
