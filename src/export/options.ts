/** Download format and, for MP3, the bitrate. Persisted in Settings.export. */
export type ExportFormat = 'mp3' | 'wav';

export interface ExportOptions {
  format: ExportFormat;
  /** MP3 bitrate in kbps; ignored for WAV. */
  kbps: number;
}

export const EXPORT_FORMATS: readonly ExportFormat[] = ['mp3', 'wav'];
export const EXPORT_BITRATES: readonly number[] = [128, 192, 256];
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = { format: 'mp3', kbps: 192 };

/**
 * WAV is uncompressed 16-bit stereo (~10 MB/min): an hour is already
 * ~635 MB, and phones cannot hold a longer file in memory to save it.
 */
export const WAV_MAX_SECONDS = 60 * 60;

export function normalizeExportOptions(raw: unknown): ExportOptions {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ExportOptions>;
  return {
    format: EXPORT_FORMATS.includes(p.format as ExportFormat)
      ? (p.format as ExportFormat)
      : DEFAULT_EXPORT_OPTIONS.format,
    kbps: EXPORT_BITRATES.includes(p.kbps as number) ? (p.kbps as number) : DEFAULT_EXPORT_OPTIONS.kbps,
  };
}

/** The longest export the format can produce. */
export function exportMaxSeconds(options: ExportOptions, overallMax: number): number {
  return options.format === 'wav' ? Math.min(WAV_MAX_SECONDS, overallMax) : overallMax;
}

export function exportMime(format: ExportFormat): string {
  return format === 'wav' ? 'audio/wav' : 'audio/mpeg';
}
