import { stateArtworkPng } from '../platform/artwork';
import { ChunkSeamer } from './chunkSeamer';
import { exportTags, tagExport } from './tagExport';

async function coverFor(sel: ExportSelection) {
  const data = await stateArtworkPng(sel.state).catch(() => null);
  return data ? { mime: 'image/png', data } : undefined;
}
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
  const seamer = new ChunkSeamer(crossN, EXPORT_SAMPLE_RATE);

  try {
    await renderSessionChunks(
      sel,
      (buffer, chunk) => {
        const { start, end } = seamer.seam(buffer, chunk);
        stream.push(buffer, start, end, chunk.last);
      },
      (fraction) => onProgress({ phase: 'rendering', fraction }),
      signal,
    );
    rendering = false;
    onProgress({ phase: 'encoding', fraction: 0 });
    const encoded = await stream.finish();
    const blob = await tagExport(encoded, options.format, {
      ...exportTags(sel, label),
      cover: await coverFor(sel),
    }).catch(() => encoded); // a tag is a nicety — never lose the file over one

    const minutes = Math.round(Math.min(sel.durationSec, maxSec) / 60);
    downloadBlob(blob, exportFilename(label, minutes, options.format));
  } catch (err) {
    // Make sure a render failure also tears down the encoder worker.
    void stream.finish().catch(() => undefined);
    throw err;
  }
}
