import { useCallback, useRef, useState } from 'react';
import type { ExportSelection } from './offlineRenderer';
import { exportSessionMp3, type ExportProgress } from './exportSession';

export interface Mp3Exporter {
  /** Non-null while an export is running. */
  progress: ExportProgress | null;
  /** Outcome of the last export (saved / cancelled / failed), until the next one starts. */
  message: string | null;
  start: (sel: ExportSelection, label: string) => Promise<void>;
  cancel: () => void;
}

/**
 * One app-wide MP3 export at a time. Every Download button (setup, program
 * editor, lab) drives this same state machine, so progress, cancel and the
 * outcome message behave identically wherever the export was started.
 */
export function useMp3Export(): Mp3Exporter {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (sel: ExportSelection, label: string) => {
    if (abortRef.current) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setMessage(null);
    setProgress({ phase: 'rendering', fraction: 0 });
    try {
      await exportSessionMp3(sel, label, setProgress, abort.signal);
      setMessage('Saved — check your downloads. It plays in any audio player.');
    } catch (err) {
      if (abort.signal.aborted) {
        setMessage('Download cancelled.');
      } else {
        console.error('MP3 export failed', err);
        setMessage(
          'Could not create the file — this device may be low on memory. Try a shorter duration.',
        );
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { progress, message, start, cancel };
}
