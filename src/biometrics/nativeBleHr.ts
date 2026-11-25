import type { BiometricSample, BiometricSource, BiometricStatus } from './types';
import { parseHeartRateMeasurement } from './webBluetoothHr';

/**
 * Heart-rate strap in the Android app, where the WebView has no Web
 * Bluetooth: the same standard GATT profile (service 0x180D, measurement
 * characteristic 0x2A37) through @capacitor-community/bluetooth-le, which
 * shows the system's device picker. Samples are parsed by the same pure
 * parseHeartRateMeasurement the web source uses.
 */
export const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';

/** The slice of BleClient this source uses (injectable for tests). */
export interface BleClientLike {
  initialize(options?: { androidNeverForLocation?: boolean }): Promise<void>;
  requestDevice(options?: { services?: string[] }): Promise<{ deviceId: string }>;
  connect(deviceId: string, onDisconnect?: (deviceId: string) => void): Promise<void>;
  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    callback: (value: DataView) => void,
  ): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
}

async function defaultClient(): Promise<BleClientLike> {
  const { BleClient } = await import('@capacitor-community/bluetooth-le');
  return BleClient;
}

export class NativeBleHeartRateSource implements BiometricSource {
  readonly kind = 'bluetooth-hr' as const;
  onStatusChange: ((status: BiometricStatus) => void) | undefined;

  private status: BiometricStatus = 'disconnected';
  private deviceId: string | null = null;
  private initialized = false;
  private listeners = new Set<(sample: BiometricSample) => void>();

  constructor(private readonly getClient: () => Promise<BleClientLike> = defaultClient) {}

  getStatus(): BiometricStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    let connectedId: string | null = null;
    try {
      const client = await this.getClient();
      if (!this.initialized) {
        // Asks for Bluetooth permissions; scan results never locate anyone.
        await client.initialize({ androidNeverForLocation: true });
        this.initialized = true;
      }
      const { deviceId } = await client.requestDevice({ services: [HR_SERVICE] });
      await client.connect(deviceId, () => {
        if (this.deviceId !== deviceId) return;
        this.deviceId = null;
        this.setStatus('disconnected');
      });
      connectedId = deviceId;
      await client.startNotifications(deviceId, HR_SERVICE, HR_MEASUREMENT, (value) => {
        const parsed = parseHeartRateMeasurement(value);
        if (parsed === null) return;
        const sample: BiometricSample = {
          heartRateBpm: parsed.bpm,
          timestamp: Date.now(),
          ...(parsed.rrIntervalsMs.length > 0 ? { rrIntervalsMs: parsed.rrIntervalsMs } : {}),
        };
        for (const listener of this.listeners) listener(sample);
      });
      this.deviceId = deviceId;
      this.setStatus('connected');
    } catch (error) {
      // Includes the user cancelling the picker or refusing permission.
      if (connectedId) {
        const client = await this.getClient().catch(() => null);
        void client?.disconnect(connectedId).catch(() => undefined);
      }
      this.setStatus(connectedId ? 'error' : 'disconnected');
      throw error;
    }
  }

  disconnect(): void {
    const id = this.deviceId;
    this.deviceId = null;
    if (id) {
      void this.getClient()
        .then((client) => client.disconnect(id))
        .catch(() => undefined);
    }
    this.setStatus('disconnected');
  }

  subscribe(cb: (sample: BiometricSample) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(status: BiometricStatus): void {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
