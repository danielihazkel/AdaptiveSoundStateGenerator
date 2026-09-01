import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_OPTIONS,
  exportMaxSeconds,
  normalizeExportOptions,
  WAV_MAX_SECONDS,
} from './options';
import { interleaveInt16 } from './pcm';
import { WAV_HEADER_BYTES, wavHeader } from './wav';

const ascii = (bytes: Uint8Array, offset: number, n: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + n));

describe('wavHeader', () => {
  it('writes a canonical 44-byte PCM header with the right sizes', () => {
    const dataBytes = 44100 * 2 * 2 * 3; // 3 s stereo 16-bit
    const h = wavHeader(44100, 2, dataBytes);
    const view = new DataView(h.buffer);
    expect(h.length).toBe(WAV_HEADER_BYTES);
    expect(ascii(h, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + dataBytes);
    expect(ascii(h, 8, 4)).toBe('WAVE');
    expect(ascii(h, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(h, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(dataBytes);
  });
});

describe('interleaveInt16', () => {
  it('interleaves L/R with the same scaling and clamping as the MP3 path', () => {
    const out = interleaveInt16(new Float32Array([1, -1, 0.5]), new Float32Array([2, -2, 0]));
    expect(Array.from(out)).toEqual([32767, 32767, -32768, -32768, 16384, 0]);
  });
});

describe('export options', () => {
  it('normalizes unknown or missing values to the defaults', () => {
    expect(normalizeExportOptions(undefined)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(normalizeExportOptions({ format: 'ogg', kbps: 999 })).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(normalizeExportOptions({ format: 'wav', kbps: 128 })).toEqual({ format: 'wav', kbps: 128 });
  });

  it('caps WAV exports at an hour and leaves MP3 at the overall cap', () => {
    expect(exportMaxSeconds({ format: 'wav', kbps: 192 }, 4 * 3600)).toBe(WAV_MAX_SECONDS);
    expect(exportMaxSeconds({ format: 'mp3', kbps: 192 }, 4 * 3600)).toBe(4 * 3600);
    expect(exportMaxSeconds({ format: 'wav', kbps: 192 }, 600)).toBe(600);
  });
});
