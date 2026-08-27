import { encodeToMp3 } from './encodeMp3';
import { exportFilename } from './filename';
import { renderSessionToBuffer, type ExportSelection } from './offlineRenderer';
import { EXPORT_MAX_SECONDS } from './renderTimeline';

export interface ExportProgress {
  phase: 'rendering' | 'encoding';
  /** 0..1 within the current phase. */
  fraction: number;
}

/**
 * End-to-end MP3 export: offline render → worker MP3 encode → browser
 * download (the DataPanel anchor idiom). Rejects with AbortError when
 * cancelled via the signal, and with whatever the render/encode threw
 * otherwise (e.g. an allocation failure on low-memory devices).
 */
export async function exportSessionMp3(
  sel: ExportSelection,
  label: string,
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const buffer = await renderSessionToBuffer(
    sel,
    (fraction) => onProgress({ phase: 'rendering', fraction }),
    signal,
  );
  const blob = await encodeToMp3(
    buffer,
    (fraction) => onProgress({ phase: 'encoding', fraction }),
    signal,
  );
  const minutes = Math.round(Math.min(sel.durationSec, EXPORT_MAX_SECONDS) / 60);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(label, minutes);
  anchor.click();
  URL.revokeObjectURL(url);
}
