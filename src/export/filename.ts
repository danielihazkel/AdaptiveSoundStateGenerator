import type { ExportFormat } from './options';

/**
 * Download name for an exported session, e.g. `resonance-focus-60min.mp3`
 * or `resonance-deep-work-45min.wav` from a preset/program label.
 */
export function exportFilename(label: string, minutes: number, format: ExportFormat = 'mp3'): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session';
  return `resonance-${slug}-${minutes}min.${format}`;
}
