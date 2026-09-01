import { useCallback, useRef, useState } from 'react';
import type { ExportSelection } from './offlineRenderer';
import { exportSessionAudio, type ExportProgress } from './exportSession';
import { normalizeExportOptions, type ExportOptions } from './options';

export interface Mp3Exporter {
  /** Non-null while an export is running. */
  progress: ExportProgress | null;
  /** Outcome of the last export (saved / cancelled / failed), until the next one starts. */
  message: string | null;
  start: (sel: ExportSelection, label: string) => Promise<void>;
  cancel: () => void;
  /** Format and bitrate every Download button uses. */
  options: ExportOptions;
  setOptions: (next: ExportOptions) => void;
}

/**
 * One app-wide audio export at a time. Every Download button (setup, program
 * editor, lab) drives this same state machine, so progress, cancel, format
 * and the outcome message behave identically wherever the export was
 * started. The options live wherever the caller keeps them (settings) —
 * this hook only reads the current value at start time.
 */
export function useMp3Export(persisted: {
  options: ExportOptions | undefined;
  onOptionsChange: (next: ExportOptions) => void;
}): Mp3Exporter {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const options = normalizeExportOptions(persisted.options);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const start = useCallback(async (sel: ExportSelection, label: string) => {
    if (abortRef.current) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setMessage(null);
    setProgress({ phase: 'rendering', fraction: 0 });
    try {
      await exportSessionAudio(sel, label, setProgress, abort.signal, optionsRef.current);
      setMessage('Saved — check your downloads. It plays in any audio player.');
    } catch (err) {
      if (abort.signal.aborted) {
        setMessage('Download cancelled.');
      } else {
        console.error('Audio export failed', err);
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

  return { progress, message, start, cancel, options, setOptions: persisted.onOptionsChange };
}
