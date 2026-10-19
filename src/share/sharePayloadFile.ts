import type { SharePayload } from './shareLink';

/**
 * A share payload saved as a file — the fallback when a program is too big
 * for a link. The same JSON a link carries, so importing it goes through the
 * same validation. Distinguished from a full data export (transfer.ts) by
 * its `kind` field: a backup bundle has none.
 */

/** Longest URL a phone camera still scans comfortably as a QR code. */
export const MAX_QR_URL_LENGTH = 1500;
export const SHARE_FILE_SUFFIX = '.resonance.json';

export function isSharePayloadFile(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const p = raw as { v?: unknown; kind?: unknown };
  return p.v === 1 && (p.kind === 'program' || p.kind === 'preset' || p.kind === 'routine');
}

export function sharePayloadFilename(payload: SharePayload): string {
  const name =
    payload.kind === 'program'
      ? payload.program.name
      : payload.kind === 'routine'
        ? payload.routine.name
        : payload.preset.name;
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || payload.kind;
  return `resonance-${payload.kind}-${slug}${SHARE_FILE_SUFFIX}`;
}

/** What a share file's confirmation should say it contains. */
export function describeSharePayload(payload: SharePayload): string {
  if (payload.kind === 'program') {
    return `the program “${payload.program.name}” (${payload.program.segments.length} phases)`;
  }
  if (payload.kind === 'routine') {
    return `the routine “${payload.routine.name}” (${payload.routine.legs.length} parts)`;
  }
  return `the saved sound “${payload.preset.name}” for ${payload.preset.state}`;
}
