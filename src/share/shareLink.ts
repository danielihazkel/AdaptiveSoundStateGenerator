import { STATES, type MentalState } from '../audio/states';
import { normalizeProfile, type SoundProfile } from '../audio/types';
import { normalizeProgram, type Program } from '../programs/types';

/**
 * Shareable links (no backend): a program or a saved sound is serialized
 * into the URL hash — `#share=<token>` — and the receiving app offers to
 * import it. Tokens are deflate-compressed JSON in base64url, prefixed
 * `z.`; browsers without CompressionStream fall back to plain JSON (`j.`).
 * Everything that comes out of a token is re-validated and normalized as if
 * it were an imported file.
 */
export interface SharedPreset {
  name: string;
  state: MentalState;
  intensity: number;
  profile: SoundProfile;
}

export type SharePayload =
  | { v: 1; kind: 'program'; program: Program }
  | { v: 1; kind: 'preset'; preset: SharedPreset };

export const SHARE_HASH_KEY = 'share';
/** Comfortably inside every modern browser's URL limit. */
export const MAX_SHARE_URL_LENGTH = 8000;
export const MAX_SHARE_NAME_LENGTH = 60;

export class ShareError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'malformed' | 'too-long',
    message: string,
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

// --- base64url ---------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new ShareError('malformed', 'This link is damaged.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- compression ---------------------------------------------------------------

type StreamCtor = new (format: string) => { readable: ReadableStream; writable: WritableStream };

function compressionStream(): StreamCtor | null {
  const g = globalThis as { CompressionStream?: StreamCtor };
  return typeof g.CompressionStream === 'function' ? g.CompressionStream : null;
}

function decompressionStream(): StreamCtor | null {
  const g = globalThis as { DecompressionStream?: StreamCtor };
  return typeof g.DecompressionStream === 'function' ? g.DecompressionStream : null;
}

async function pipe(Ctor: StreamCtor, bytes: Uint8Array): Promise<Uint8Array> {
  // 'deflate' (zlib-wrapped) rather than 'deflate-raw': supported everywhere
  // CompressionStream exists, for six bytes of overhead.
  const stream = new Ctor('deflate');
  const writer = stream.writable.getWriter();
  const done = writer.write(bytes).then(() => writer.close());
  const out = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  await done;
  return out;
}

// --- encode / decode -------------------------------------------------------------

export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const Deflate = compressionStream();
  if (Deflate) return `z.${toBase64Url(await pipe(Deflate, json))}`;
  return `j.${toBase64Url(json)}`;
}

export async function decodeShare(token: string): Promise<unknown> {
  const dot = token.indexOf('.');
  if (dot !== 1) throw new ShareError('malformed', 'This link is not a Resonance share link.');
  const scheme = token[0];
  const bytes = fromBase64Url(token.slice(2));
  let json: Uint8Array;
  if (scheme === 'z') {
    const Inflate = decompressionStream();
    if (!Inflate) {
      throw new ShareError('unsupported', 'This browser cannot open compressed share links.');
    }
    try {
      json = await pipe(Inflate, bytes);
    } catch {
      throw new ShareError('malformed', 'This link is damaged.');
    }
  } else if (scheme === 'j') {
    json = bytes;
  } else {
    throw new ShareError('malformed', 'This link is not a Resonance share link.');
  }
  try {
    return JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new ShareError('malformed', 'This link is damaged.');
  }
}

// --- validation ----------------------------------------------------------------

export type ShareValidation =
  | { ok: true; payload: SharePayload }
  | { ok: false; error: string };

function isMentalState(value: unknown): value is MentalState {
  return typeof value === 'string' && value in STATES;
}

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim().slice(0, MAX_SHARE_NAME_LENGTH) : '';
  return name.length > 0 ? name : fallback;
}

/** Same spirit as validateBundle: enough shape that import can't corrupt storage. */
export function validateSharePayload(raw: unknown): ShareValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'This link does not contain a Resonance program or sound.' };
  }
  const p = raw as Partial<SharePayload> & { program?: unknown; preset?: unknown };
  if (p.v !== 1) {
    return { ok: false, error: 'This link was made by a newer version of Resonance.' };
  }
  if (p.kind === 'program') {
    const program = p.program as Partial<Program> | undefined;
    if (typeof program !== 'object' || program === null || !Array.isArray(program.segments)) {
      return { ok: false, error: 'This link does not contain a valid program.' };
    }
    const normalized = normalizeProgram({ ...program, name: cleanName(program.name, 'Shared program') });
    return { ok: true, payload: { v: 1, kind: 'program', program: normalized } };
  }
  if (p.kind === 'preset') {
    const preset = p.preset as Partial<SharedPreset> | undefined;
    if (
      typeof preset !== 'object' ||
      preset === null ||
      !isMentalState(preset.state) ||
      typeof preset.profile !== 'object' ||
      preset.profile === null
    ) {
      return { ok: false, error: 'This link does not contain a valid sound.' };
    }
    const intensity =
      typeof preset.intensity === 'number' && Number.isFinite(preset.intensity)
        ? Math.min(1, Math.max(0, preset.intensity))
        : 0.5;
    return {
      ok: true,
      payload: {
        v: 1,
        kind: 'preset',
        preset: {
          name: cleanName(preset.name, 'Shared sound'),
          state: preset.state,
          intensity,
          profile: normalizeProfile(preset.profile),
        },
      },
    };
  }
  return { ok: false, error: 'This link does not contain a Resonance program or sound.' };
}

// --- URL plumbing ----------------------------------------------------------------

/** The share token in a location hash, or null. */
export function readShareHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get(SHARE_HASH_KEY);
  return token && token.length > 0 ? token : null;
}

export async function buildShareUrl(payload: SharePayload, base: string): Promise<string> {
  const token = await encodeShare(payload);
  const url = `${base}#${SHARE_HASH_KEY}=${token}`;
  if (url.length > MAX_SHARE_URL_LENGTH) {
    throw new ShareError('too-long', 'This program is too large to fit in a link.');
  }
  return url;
}
