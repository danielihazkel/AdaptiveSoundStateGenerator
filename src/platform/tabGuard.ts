/**
 * Detects a second Resonance tab on the same origin. Storage is read-modify-
 * write with no cross-tab coordination (see personalizer.ts), and two tabs
 * would each run their own audio engine — so the app warns rather than
 * silently clobbering. Detection only; nothing is locked.
 *
 * Protocol over BroadcastChannel: a new tab posts `hello`; every existing tab
 * answers `present`. Receiving either message means another tab is open
 * (a `hello` tells an old tab that a new one just arrived).
 */
export const TAB_CHANNEL_NAME = 'resonance.tabs';

type TabMessage = { type: 'hello' } | { type: 'present' };

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
