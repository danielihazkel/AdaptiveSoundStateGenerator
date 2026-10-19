/** Bytes in a canonical PCM WAV header. */
export const WAV_HEADER_BYTES = 44;
export const WAV_BITS_PER_SAMPLE = 16;

/**
 * Canonical 44-byte RIFF/WAVE header for 16-bit PCM. `dataBytes` is the
 * length of the sample data that follows; sizes are written once the whole
 * stream has been counted, so the header is built last and prepended.
 */
export function wavHeader(sampleRate: number, channels: number, dataBytes: number): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  const blockAlign = channels * (WAV_BITS_PER_SAMPLE / 8);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/**
 * A RIFF `LIST`/`INFO` chunk (title, artist, …) to append after the data
 * chunk — the WAV counterpart of an MP3's ID3 tag. Values are UTF-8,
 * NUL-terminated and padded to an even length, as RIFF requires; the caller
 * adds the chunk's length to the RIFF size in the header.
 */
export function wavInfoChunk(fields: Partial<Record<'INAM' | 'IART' | 'IPRD' | 'IGNR' | 'ICMT', string>>): Uint8Array {
  const encoder = new TextEncoder();
  const subchunks: Uint8Array[] = [];
  for (const [id, value] of Object.entries(fields)) {
    if (!value) continue;
    const text = encoder.encode(value);
    const size = text.length + 1; // NUL terminator
    const chunk = new Uint8Array(8 + size + (size % 2));
    chunk.set(encoder.encode(id), 0);
    new DataView(chunk.buffer).setUint32(4, size, true);
    chunk.set(text, 8);
    subchunks.push(chunk);
  }
  const body = subchunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(encoder.encode('LIST'), 0);
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  out.set(encoder.encode('INFO'), 8);
  let at = 12;
  for (const c of subchunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
