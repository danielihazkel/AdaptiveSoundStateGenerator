import { describe, expect, it } from 'vitest';
import { parseHeartRateMeasurement } from './webBluetoothHr';

function view(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

describe('parseHeartRateMeasurement', () => {
  it('reads an 8-bit heart rate when flag bit 0 is clear', () => {
    expect(parseHeartRateMeasurement(view([0x00, 72]))).toBe(72);
    // Other flag bits (energy expended, RR intervals) must not matter.
    expect(parseHeartRateMeasurement(view([0x16, 65, 0x01, 0x02]))).toBe(65);
  });

  it('reads a 16-bit little-endian heart rate when flag bit 0 is set', () => {
    expect(parseHeartRateMeasurement(view([0x01, 0xb4, 0x00]))).toBe(180); // 0x00b4
  });

  it('rejects implausible and malformed readings', () => {
    expect(parseHeartRateMeasurement(view([0x00, 0]))).toBeNull();
    expect(parseHeartRateMeasurement(view([0x01, 0x2c, 0x01]))).toBeNull(); // 300 bpm
    expect(parseHeartRateMeasurement(view([0x00]))).toBeNull(); // flags only
    expect(parseHeartRateMeasurement(view([0x01, 0x48]))).toBeNull(); // truncated u16
  });
});
