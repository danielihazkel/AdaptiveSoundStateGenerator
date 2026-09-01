/**
 * Detects a second Resonance tab on the same origin. Storage is read-modify-
 * write with no cross-tab coordination (see personalizer.ts), and two tabs
 * would each run their own audio engine — so the app warns, and a *session*
 * takes a Web Lock (acquireSessionLock) so two tabs can never both be
 * playing and resolving outcomes at once.
 *
 * Protocol over BroadcastChannel: a new tab posts `hello`; every existing tab
 * answers `present`. Receiving either message means another tab is open
 * (a `hello` tells an old tab that a new one just arrived).
 */
export const TAB_CHANNEL_NAME = 'resonance.tabs';

type TabMessage = { type: 'hello' } | { type: 'present' };

export const SESSION_LOCK_NAME = 'resonance.session';

export type LockRelease = () => void;

/**
 * Claim "a session is playing in this tab" (Web Locks API). Resolves with a
 * release function, or null when another tab already holds it. Browsers
 * without Web Locks always grant — best-effort, as before. The lock is held
 * until released, and the browser drops it if the tab dies.
 */
export function acquireSessionLock(
  locks: LockManager | undefined = (globalThis.navigator as Navigator | undefined)?.locks,
): Promise<LockRelease | null> {
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    let release: () => void = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    locks
      .request(SESSION_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        resolve(() => release());
        await held;
      })
      .catch(() => resolve(() => {}));
  });
}

export function subscribeTabPresence(onOtherTab: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(TAB_CHANNEL_NAME);
  } catch {
    return () => {};
  }
  channel.onmessage = (event: MessageEvent<TabMessage>) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') channel.postMessage({ type: 'present' } satisfies TabMessage);
    if (msg.type === 'hello' || msg.type === 'present') onOtherTab();
  };
  channel.postMessage({ type: 'hello' } satisfies TabMessage);
  return () => {
    channel.onmessage = null;
    channel.close();
  };
}
