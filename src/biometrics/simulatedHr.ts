import type { BiometricSample, BiometricSource, BiometricStatus } from './types';

/**
 * Dev/test heart-rate source (enable in the app with `?simhr`). Emits
 * baseline + linear drift + noise so the trend detector has something real
 * to chew on without hardware.
 */
export class SimulatedHeartRateSource implements BiometricSource {
  readonly kind = 'simulated' as const;
  onStatusChange: ((status: BiometricStatus) => void) | undefined;

  private status: BiometricStatus = 'disconnected';
  private listeners = new Set<(sample: BiometricSample) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private startedAt = 0;

  constructor(
    private readonly opts: {
      baselineBpm?: number;
      /** BPM added per minute of runtime (positive = rising trend). */
      driftPerMin?: number;
      noiseBpm?: number;
      rng?: () => number;
      intervalMs?: number;
    } = {},
  ) {}

  getStatus(): BiometricStatus {
    return this.status;
  }

  connect(): Promise<void> {
    if (this.status === 'connected') return Promise.resolve();
    const {
      baselineBpm = 62,
      driftPerMin = 0,
      noiseBpm = 2,
      rng = Math.random,
      intervalMs = 1000,
    } = this.opts;
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      const elapsedMin = (Date.now() - this.startedAt) / 60_000;
      const bpm =
        baselineBpm + driftPerMin * elapsedMin + noiseBpm * (rng() * 2 - 1);
      const sample: BiometricSample = {
        heartRateBpm: Math.round(bpm),
        timestamp: Date.now(),
      };
      for (const listener of this.listeners) listener(sample);
    }, intervalMs);
    this.setStatus('connected');
    return Promise.resolve();
  }

  disconnect(): void {
    clearInterval(this.timer);
    this.timer = undefined;
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
