import {
  isWebBluetoothAvailable,
  type BiometricSample,
  type BiometricSource,
  type BiometricStatus,
} from './types';

/**
 * Web Bluetooth heart-rate strap source: standard GATT heart_rate service
 * (0x180D), heart_rate_measurement characteristic (0x2A37). Most chest straps
 * expose this profile; many smartwatches do not broadcast it.
 */

/**
 * Bluetooth SIG Heart Rate Measurement format: flags byte at offset 0,
 * bit 0 = HR value is uint16 little-endian (else uint8 at offset 1).
 * Pure so it is unit-testable without any browser API.
 */
export function parseHeartRateMeasurement(view: DataView): number | null {
  if (view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  if (is16Bit && view.byteLength < 3) return null;
  const bpm = is16Bit ? view.getUint16(1, true) : view.getUint8(1);
  if (bpm <= 0 || bpm > 250) return null; // implausible readings are dropped
  return bpm;
}

// Minimal structural types — the DOM lib has no Web Bluetooth definitions and
// this app deliberately carries no third-party type packages.
interface BluetoothCharacteristicLike {
  startNotifications(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', cb: (event: Event) => void): void;
}
interface BluetoothDeviceLike {
  gatt?: {
    connect(): Promise<{
      getPrimaryService(name: string): Promise<{
        getCharacteristic(name: string): Promise<BluetoothCharacteristicLike>;
      }>;
    }>;
    disconnect(): void;
  };
  addEventListener(type: 'gattserverdisconnected', cb: () => void): void;
}
interface BluetoothNavigator {
  bluetooth: {
    requestDevice(options: {
      filters: Array<{ services: string[] }>;
    }): Promise<BluetoothDeviceLike>;
  };
}

export class WebBluetoothHeartRateSource implements BiometricSource {
  readonly kind = 'bluetooth-hr' as const;
  onStatusChange: ((status: BiometricStatus) => void) | undefined;

  private status: BiometricStatus = isWebBluetoothAvailable()
    ? 'disconnected'
    : 'unavailable';
  private device: BluetoothDeviceLike | null = null;
  private listeners = new Set<(sample: BiometricSample) => void>();

  getStatus(): BiometricStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    if (!isWebBluetoothAvailable()) {
      this.setStatus('unavailable');
      return;
    }
    this.setStatus('connecting');
    try {
      const device = await (navigator as unknown as BluetoothNavigator).bluetooth
        .requestDevice({ filters: [{ services: ['heart_rate'] }] });
      device.addEventListener('gattserverdisconnected', () => {
        this.device = null;
        this.setStatus('disconnected');
      });
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService('heart_rate');
      const characteristic = await service.getCharacteristic('heart_rate_measurement');
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as { value?: DataView } | null)?.value;
        if (!value) return;
        const bpm = parseHeartRateMeasurement(value);
        if (bpm === null) return;
        const sample: BiometricSample = { heartRateBpm: bpm, timestamp: Date.now() };
        for (const listener of this.listeners) listener(sample);
      });
      await characteristic.startNotifications();
      this.device = device;
      this.setStatus('connected');
    } catch (error) {
      // Includes the user cancelling the chooser — either way, not connected.
      this.setStatus(this.device ? 'error' : 'disconnected');
      throw error;
    }
  }

  disconnect(): void {
    this.device?.gatt?.disconnect();
    this.device = null;
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
