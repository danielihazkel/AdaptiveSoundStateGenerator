/**
 * Download name for an exported session, e.g. `resonance-focus-60min.mp3`
 * or `resonance-deep-work-45min.mp3` from a preset/program label.
 */
export function exportFilename(label: string, minutes: number): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session';
  return `resonance-${slug}-${minutes}min.mp3`;
}
