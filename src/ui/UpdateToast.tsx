import { useSyncExternalStore } from 'react';
import {
  applyUpdate,
  dismissUpdate,
  getUpdateStatus,
  subscribeUpdateReady,
} from '../app/swUpdate';

/**
 * "A new version is ready" — the user-facing half of the prompt-style
 * service-worker registration. Nothing reloads until Update is tapped.
 */
export function UpdateToast() {
  const status = useSyncExternalStore(subscribeUpdateReady, getUpdateStatus, getUpdateStatus);
  if (status === 'idle' || status === 'dismissed') return null;
  return (
    <div className="notice toast" role="status">
      {status === 'scheduled' ? (
        <span>Updating when your session ends.</span>
      ) : (
        <>
          <span>A new version of Resonance is ready.</span>
          <span className="toast-actions">
            <button type="button" className="chip" onClick={applyUpdate}>
              Update
            </button>
            <button type="button" className="chip" onClick={dismissUpdate}>
              Later
            </button>
          </span>
        </>
      )}
    </div>
  );
}
