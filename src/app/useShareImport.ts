import { useEffect, useState } from 'react';
import {
  decodeShare,
  readShareHash,
  validateSharePayload,
  type SharePayload,
} from '../share/shareLink';

export type PendingShare = { payload: SharePayload } | { error: string };

/**
 * Picks a `#share=` token off the URL on first load, clears it from the
 * address bar (so a reload doesn't re-offer it), and decodes it for the
 * import prompt.
 */
export function useShareImport() {
  const [pending, setPending] = useState<PendingShare | null>(null);

  useEffect(() => {
    const token = readShareHash(window.location.hash);
    if (!token) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    let cancelled = false;
    void (async () => {
      let result: PendingShare;
      try {
        const validation = validateSharePayload(await decodeShare(token));
        result = validation.ok ? { payload: validation.payload } : { error: validation.error };
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'This link could not be opened.' };
      }
      if (!cancelled) setPending(result);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { pending, dismiss: () => setPending(null) };
}
