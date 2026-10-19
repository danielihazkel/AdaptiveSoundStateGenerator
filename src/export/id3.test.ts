import { describe, expect, it } from 'vitest';
import { buildId3Tag, synchsafe } from './id3';

/** Minimal ID3v2.3 reader, independent of the writer: frame id → body bytes. */
function readTag(tag: Uint8Array): { version: number; frames: Map<string, Uint8Array> } {
  expect(String.fromCharCode(...tag.subarray(0, 3))).toBe('ID3');
  const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  expect(size).toBe(tag.length - 10);
  const frames = new Map<string, Uint8Array>();
  let at = 10;
  while (at < tag.length) {
    const id = String.fromCharCode(...tag.subarray(at, at + 4));
    const len = new DataView(tag.buffer, tag.byteOffset + at + 4, 4).getUint32(0);
    frames.set(id, tag.subarray(at + 10, at + 10 + len));
    at += 10 + len;
  }
  expect(at).toBe(tag.length);
  return { version: tag[3], frames };
}

/** Decode a UTF-16LE-with-BOM string (no terminator). */
function utf16(bytes: Uint8Array): string {
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
  let s = '';
  for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return s;
}

describe('synchsafe', () => {
  it('packs seven bits per byte', () => {
    expect([...synchsafe(0)]).toEqual([0, 0, 0, 0]);
    expect([...synchsafe(127)]).toEqual([0, 0, 0, 127]);
    expect([...synchsafe(128)]).toEqual([0, 0, 1, 0]);
    expect([...synchsafe(2 ** 28 - 1)]).toEqual([127, 127, 127, 127]);
    expect(() => synchsafe(2 ** 28)).toThrow(RangeError);
  });
});

describe('buildId3Tag', () => {
  it('writes a v2.3 tag whose text frames round-trip, emoji included', () => {
    const { version, frames } = readTag(
      buildId3Tag({ title: '🌙 Sleep · 45 min', artist: 'Resonance', album: 'Sleep', genre: 'Ambient' }),
    );
    expect(version).toBe(3);
    expect([...frames.keys()]).toEqual(['TIT2', 'TPE1', 'TALB', 'TCON']);
    for (const [id, text] of [
      ['TIT2', '🌙 Sleep · 45 min'],
      ['TPE1', 'Resonance'],
      ['TALB', 'Sleep'],
      ['TCON', 'Ambient'],
    ] as const) {
      const body = frames.get(id)!;
      expect(body[0], id).toBe(1); // UTF-16
      expect(utf16(body.subarray(1))).toBe(text);
    }
  });

  it('writes the comment with a language and an empty description', () => {
    const body = readTag(buildId3Tag({ title: 't', artist: 'a', comment: 'Brown noise, 6 Hz beat' })).frames.get('COMM')!;
    expect(body[0]).toBe(1);
    expect(String.fromCharCode(...body.subarray(1, 4))).toBe('eng');
    // Empty description: BOM + 00 00, then the text.
    expect([...body.subarray(4, 8)]).toEqual([0xff, 0xfe, 0, 0]);
    expect(utf16(body.subarray(8))).toBe('Brown noise, 6 Hz beat');
  });

  it('embeds front-cover art verbatim', () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);
    const body = readTag(buildId3Tag({ title: 't', artist: 'a', cover: { mime: 'image/png', data: png } })).frames.get('APIC')!;
    expect(body[0]).toBe(0);
    const mimeEnd = body.indexOf(0, 1);
    expect(String.fromCharCode(...body.subarray(1, mimeEnd))).toBe('image/png');
    expect(body[mimeEnd + 1]).toBe(3); // front cover
    expect(body[mimeEnd + 2]).toBe(0); // empty description
    expect([...body.subarray(mimeEnd + 3)]).toEqual([...png]);
  });

  it('omits optional frames that are not given', () => {
    expect([...readTag(buildId3Tag({ title: 't', artist: 'a' })).frames.keys()]).toEqual(['TIT2', 'TPE1']);
  });
});
