/**
 * Minimal ID3v2.3 tag writer for exported MP3s: title, artist, album, genre,
 * a comment, and optional front-cover art — enough for a phone's player or a
 * car stereo to show something better than a filename. Pure; lamejs writes
 * no tags of its own, so the tag is simply prepended to the encoded frames.
 *
 * Text frames are UTF-16 with a BOM (encoding 1), so emoji and accented
 * labels survive; v2.3 is what the widest range of players reads.
 */

export interface AudioTags {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  comment?: string;
  /** Front cover, e.g. a PNG. */
  cover?: { mime: string; data: Uint8Array };
}

const UTF16 = 1;
const LATIN1 = 0;

function utf16WithBom(text: string, terminate: boolean): Uint8Array {
  const units = text.length + (terminate ? 1 : 0);
  const out = new Uint8Array(2 + units * 2);
  out[0] = 0xff; // BOM, little-endian
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i); // UTF-16 code unit — surrogates pass through
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out; // a terminator, if asked for, is the trailing 00 00 already zeroed
}

function latin1(text: string, terminate: boolean): Uint8Array {
  const out = new Uint8Array(text.length + (terminate ? 1 : 0));
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function frame(id: string, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(10);
  header.set(latin1(id, false), 0);
  // v2.3 frame sizes are plain 32-bit big-endian (only the tag size is synchsafe).
  new DataView(header.buffer).setUint32(4, body.length);
  return concat([header, body]);
}

function textFrame(id: string, text: string): Uint8Array {
  return frame(id, concat([Uint8Array.of(UTF16), utf16WithBom(text, false)]));
}

/** 28-bit synchsafe integer: seven bits per byte, high bit always clear. */
export function synchsafe(n: number): Uint8Array {
  if (n < 0 || n >= 2 ** 28) throw new RangeError('ID3 tag too large');
  return Uint8Array.of((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);
}

export function buildId3Tag(tags: AudioTags): Uint8Array {
  const frames: Uint8Array[] = [textFrame('TIT2', tags.title), textFrame('TPE1', tags.artist)];
  if (tags.album) frames.push(textFrame('TALB', tags.album));
  if (tags.genre) frames.push(textFrame('TCON', tags.genre));
  if (tags.comment) {
    frames.push(
      frame(
        'COMM',
        concat([
          Uint8Array.of(UTF16),
          latin1('eng', false),
          utf16WithBom('', true), // empty, terminated short description
          utf16WithBom(tags.comment, false),
        ]),
      ),
    );
  }
  if (tags.cover) {
    frames.push(
      frame(
        'APIC',
        concat([
          Uint8Array.of(LATIN1),
          latin1(tags.cover.mime, true),
          Uint8Array.of(0x03), // picture type: front cover
          Uint8Array.of(0), // empty, terminated description
          tags.cover.data,
        ]),
      ),
    );
  }
  const body = concat(frames);
  const header = concat([latin1('ID3', false), Uint8Array.of(3, 0, 0), synchsafe(body.length)]);
  return concat([header, body]);
}
