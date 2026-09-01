import { mixOverlap } from './crossfade';
import { EncodeStream } from './encodeMp3';
import { downloadBlob } from '../platform/download';
import { exportFilename } from './filename';
import { renderSessionChunks, type ExportSelection } from './offlineRenderer';
import { DEFAULT_EXPORT_OPTIONS, exportMaxSeconds, type ExportOptions } from './options';
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
 * End-to-end audio export: chunked offline render → streaming worker encode
 * (MP3 or WAV) → browser download. Each rendered chunk is seamed onto the
 * previous one with an equal-power crossfade and handed straight to the
 * encoder, so exports of any length hold at most one chunk in memory.
 * Rejects with AbortError when cancelled via the signal, and with whatever
 * the render/encode threw otherwise (e.g. an allocation failure on
 * low-memory devices).
 */
export async function exportSessionAudio(
  selection: ExportSelection,
  label: string,
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): Promise<void> {
  // WAV cannot be as long as MP3 (uncompressed); trim the request up front so
  // the render plan, the file and the filename all agree.
  const maxSec = exportMaxSeconds(options, EXPORT_MAX_SECONDS);
  const sel: ExportSelection =
    selection.durationSec > maxSec ? { ...selection, durationSec: maxSec } : selection;
  const crossN = Math.round(CHUNK_CROSSFADE_SEC * EXPORT_SAMPLE_RATE);
  let rendering = true;
  const stream = new EncodeStream(
    EXPORT_SAMPLE_RATE,
    (encoded, pushed) => {
      if (!rendering && pushed > 0) {
        onProgress({ phase: 'encoding', fraction: Math.min(1, encoded / pushed) });
      }
    },
    signal,
    options,
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

    const minutes = Math.round(Math.min(sel.durationSec, maxSec) / 60);
    downloadBlob(blob, exportFilename(label, minutes, options.format));
  } catch (err) {
    // Make sure a render failure also tears down the encoder worker.
    void stream.finish().catch(() => undefined);
    throw err;
  }
}
