import { describe, expect, it, vi } from 'vitest';
import { HR_MEASUREMENT, HR_SERVICE, NativeBleHeartRateSource, type BleClientLike } from './nativeBleHr';
import type { BiometricSample, BiometricStatus } from './types';

function fakeClient() {
  let notify: ((value: DataView) => void) | null = null;
  let onDisconnect: ((id: string) => void) | null = null;
  const client = {
    initialize: vi.fn().mockResolvedValue(undefined),
    requestDevice: vi.fn().mockResolvedValue({ deviceId: 'strap-1' }),
    connect: vi.fn(async (_id: string, cb?: (id: string) => void) => {
      onDisconnect = cb ?? null;
    }),
    startNotifications: vi.fn(
      async (_id: string, _s: string, _c: string, cb: (value: DataView) => void) => {
        notify = cb;
      },
    ),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  return {
    client,
    get: () => Promise.resolve(client as BleClientLike),
    send: (bytes: number[]) => notify?.(new DataView(new Uint8Array(bytes).buffer)),
    drop: () => onDisconnect?.('strap-1'),
  };
}

describe('NativeBleHeartRateSource', () => {
  it('connects to the standard heart-rate profile and streams parsed samples', async () => {
    const fake = fakeClient();
    const source = new NativeBleHeartRateSource(fake.get);
    const statuses: BiometricStatus[] = [];
    source.onStatusChange = (s) => statuses.push(s);
    const samples: BiometricSample[] = [];
    source.subscribe((s) => samples.push(s));

    await source.connect();
    expect(fake.client.initialize).toHaveBeenCalledWith({ androidNeverForLocation: true });
    expect(fake.client.requestDevice).toHaveBeenCalledWith({ services: [HR_SERVICE] });
    expect(fake.client.startNotifications).toHaveBeenCalledWith(
      'strap-1',
      HR_SERVICE,
      HR_MEASUREMENT,
      expect.any(Function),
    );
    expect(statuses).toEqual(['connecting', 'connected']);

    // flags 0x10: uint8 HR + one RR interval (1024 = 1000 ms).
    fake.send([0x10, 62, 0x00, 0x04]);
    fake.send([0x00, 0]); // implausible, dropped
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ heartRateBpm: 62, rrIntervalsMs: [1000] });
  });

  it('initializes once across reconnects', async () => {
    const fake = fakeClient();
    const source = new NativeBleHeartRateSource(fake.get);
    await source.connect();
    source.disconnect();
    await source.connect();
    expect(fake.client.initialize).toHaveBeenCalledTimes(1);
  });

  it('a strap dropping out reads as disconnected', async () => {
    const fake = fakeClient();
    const source = new NativeBleHeartRateSource(fake.get);
    await source.connect();
    fake.drop();
    expect(source.getStatus()).toBe('disconnected');
  });

  it('a cancelled picker leaves it disconnected and rethrows', async () => {
    const fake = fakeClient();
    fake.client.requestDevice.mockRejectedValueOnce(new Error('cancelled'));
    const source = new NativeBleHeartRateSource(fake.get);
    await expect(source.connect()).rejects.toThrow('cancelled');
    expect(source.getStatus()).toBe('disconnected');
  });

  it('a strap that connects but refuses notifications is an error, and is let go', async () => {
    const fake = fakeClient();
    fake.client.startNotifications.mockRejectedValueOnce(new Error('gatt'));
    const source = new NativeBleHeartRateSource(fake.get);
    await expect(source.connect()).rejects.toThrow('gatt');
    expect(source.getStatus()).toBe('error');
    await Promise.resolve();
    expect(fake.client.disconnect).toHaveBeenCalledWith('strap-1');
  });

  it('disconnect() releases the device', async () => {
    const fake = fakeClient();
    const source = new NativeBleHeartRateSource(fake.get);
    await source.connect();
    source.disconnect();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.client.disconnect).toHaveBeenCalledWith('strap-1');
    expect(source.getStatus()).toBe('disconnected');
  });
});
