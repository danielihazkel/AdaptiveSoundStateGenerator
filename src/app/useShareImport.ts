import { useEffect, useState } from 'react';
import {
  decodeShare,
  readShareHash,
  validateSharePayload,
  type SharePayload,
} from '../share/shareLink';
import { isSharePayloadFile } from '../share/sharePayloadFile';
import { onIncomingFile, type IncomingFile } from '../platform/nativeIncoming';

export type PendingShare = { payload: SharePayload } | { error: string };

/**
 * A file opened with / shared to the Android app, as an import prompt. Only
 * share payloads import this way; a full backup goes through "Your data",
 * which merges with a confirm step.
 */
export function pendingFromIncomingFile(file: IncomingFile): PendingShare {
  if (file.error !== undefined || file.text === undefined) {
    return { error: file.error ?? 'That file could not be read.' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(file.text);
  } catch {
    return { error: 'That file is not valid JSON.' };
  }
  if (!isSharePayloadFile(raw)) {
    return {
      error:
        'That file is not a shared program, sound or routine. A full backup imports from “Your data” on the setup screen.',
    };
  }
  const validation = validateSharePayload(raw);
  return validation.ok ? { payload: validation.payload } : { error: validation.error };
}

/**
 * Picks a `#share=` token off the URL on first load, clears it from the
 * address bar (so a reload doesn't re-offer it), and decodes it for the
 * import prompt. In the Android app, files opened with or shared to it
 * arrive here too.
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

  useEffect(() => onIncomingFile((file) => setPending(pendingFromIncomingFile(file))), []);

  return { pending, dismiss: () => setPending(null) };
}
