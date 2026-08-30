import { mixOverlap } from './crossfade';
import { Mp3Stream } from './encodeMp3';
import { exportFilename } from './filename';
import { renderSessionChunks, type ExportSelection } from './offlineRenderer';
import {
  CHUNK_CROSSFADE_SEC,
  EXPORT_MAX_SECONDS,
  EXPORT_SAMPLE_RATE,
} from './renderTimeline';

export interface ExportProgress {
  phase: 'rendering' | 'encoding';
  /** 0..1 — overall while rendering, then the encoder catching up. */
  fraction: number;
}

/**
 * End-to-end MP3 export: chunked offline render → streaming worker MP3
 * encode → browser download. Each rendered chunk is seamed onto the previous
 * one with an equal-power crossfade and handed straight to the encoder, so
 * exports of any length hold at most one chunk in memory. Rejects with
 * AbortError when cancelled via the signal, and with whatever the
 * render/encode threw otherwise (e.g. an allocation failure on low-memory
 * devices).
 */
export async function exportSessionMp3(
  sel: ExportSelection,
  label: string,
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const crossN = Math.round(CHUNK_CROSSFADE_SEC * EXPORT_SAMPLE_RATE);
  let rendering = true;
  const stream = new Mp3Stream(
    EXPORT_SAMPLE_RATE,
    (encoded, pushed) => {
      if (!rendering && pushed > 0) {
        onProgress({ phase: 'encoding', fraction: Math.min(1, encoded / pushed) });
      }
    },
    signal,
  );
  // The previous chunk's final CHUNK_CROSSFADE_SEC, held back for the seam.
  let tail: { left: Float32Array; right: Float32Array } | null = null;

  try {
    await renderSessionChunks(
      sel,
      (buffer, chunk) => {
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        // Discard the settle part of the lead; the remainder is the overlap
        // region that gets crossfaded with the previous chunk's tail.
        const skip = chunk.leadSec > 0 ? Math.round(chunk.leadSec * EXPORT_SAMPLE_RATE) - crossN : 0;
        if (tail) {
          mixOverlap(tail.left, left.subarray(skip, skip + crossN));
          mixOverlap(tail.right, right.subarray(skip, skip + crossN));
        }
        const end = chunk.last ? left.length : left.length - crossN;
        tail = chunk.last ? null : { left: left.slice(end), right: right.slice(end) };
        stream.push(buffer, skip, end, chunk.last);
      },
      (fraction) => onProgress({ phase: 'rendering', fraction }),
      signal,
    );
    rendering = false;
    onProgress({ phase: 'encoding', fraction: 0 });
    const blob = await stream.finish();

    const minutes = Math.round(Math.min(sel.durationSec, EXPORT_MAX_SECONDS) / 60);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFilename(label, minutes);
    anchor.click();
    // Revoking synchronously after click() can race the download on some
    // browsers with large blobs; a minute is plenty for the save to begin.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    // Make sure a render failure also tears down the encoder worker.
    void stream.finish().catch(() => undefined);
    throw err;
  }
}
