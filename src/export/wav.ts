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
