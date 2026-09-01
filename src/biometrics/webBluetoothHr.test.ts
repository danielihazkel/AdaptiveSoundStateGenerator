import { describe, expect, it } from 'vitest';
import { parseHeartRateMeasurement } from './webBluetoothHr';

function view(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

describe('parseHeartRateMeasurement', () => {
  it('reads an 8-bit heart rate when flag bit 0 is clear', () => {
    expect(parseHeartRateMeasurement(view([0x00, 72]))).toEqual({
      bpm: 72,
      rrIntervalsMs: [],
    });
  });

  it('reads a 16-bit little-endian heart rate when flag bit 0 is set', () => {
    expect(parseHeartRateMeasurement(view([0x01, 0xb4, 0x00]))).toEqual({
      bpm: 180, // 0x00b4
      rrIntervalsMs: [],
    });
  });

  it('reads RR intervals (uint16 LE, 1/1024 s) when flag bit 4 is set', () => {
    // flags 0x16 = bits 1,2,4 — RR present, no energy expended.
    const parsed = parseHeartRateMeasurement(view([0x16, 65, 0x01, 0x02]));
    expect(parsed!.bpm).toBe(65);
    expect(parsed!.rrIntervalsMs).toHaveLength(1);
    expect(parsed!.rrIntervalsMs[0]).toBeCloseTo((0x0201 * 1000) / 1024, 3); // ≈ 501 ms
    // Multiple RR values in one packet.
    const multi = parseHeartRateMeasurement(view([0x10, 60, 0x00, 0x04, 0x00, 0x04]));
    expect(multi!.rrIntervalsMs).toEqual([1000, 1000]);
  });

  it('skips the energy-expended field before the RR intervals (flag bit 3)', () => {
    // flags 0x18 = energy expended + RR; energy 0x1234 is skipped.
    const parsed = parseHeartRateMeasurement(view([0x18, 70, 0x34, 0x12, 0x00, 0x04]));
    expect(parsed!.bpm).toBe(70);
    expect(parsed!.rrIntervalsMs).toEqual([1000]);
    // 16-bit HR + energy + RR: offsets shift by one.
    const wide = parseHeartRateMeasurement(view([0x19, 0x46, 0x00, 0x34, 0x12, 0x00, 0x02]));
    expect(wide!.bpm).toBe(70);
    expect(wide!.rrIntervalsMs).toEqual([500]);
  });

  it('ignores RR bytes when flag bit 4 is clear and tolerates a trailing odd byte', () => {
    expect(parseHeartRateMeasurement(view([0x00, 72, 0x00, 0x04]))!.rrIntervalsMs).toEqual([]);
    expect(
      parseHeartRateMeasurement(view([0x10, 72, 0x00, 0x04, 0x99]))!.rrIntervalsMs,
    ).toEqual([1000]); // the dangling byte is not half an interval
  });

  it('rejects implausible and malformed readings', () => {
    expect(parseHeartRateMeasurement(view([0x00, 0]))).toBeNull();
    expect(parseHeartRateMeasurement(view([0x01, 0x2c, 0x01]))).toBeNull(); // 300 bpm
    expect(parseHeartRateMeasurement(view([0x00]))).toBeNull(); // flags only
    expect(parseHeartRateMeasurement(view([0x01, 0x48]))).toBeNull(); // truncated u16
  });
});
