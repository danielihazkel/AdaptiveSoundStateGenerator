import type { MotionSample } from './motion';
import type { BiometricStatus } from './types';

/** A stream of 1 s activity epochs (motion.ts). */
export interface MotionSource {
  readonly kind: 'device' | 'simulated';
  getStatus(): BiometricStatus;
  /**
   * Must be called from a user gesture: iOS asks for motion permission the
   * first time. Calling again while running is a no-op.
   */
  start(): Promise<void>;
  stop(): void;
  /** Returns an unsubscribe function. */
  subscribe(cb: (sample: MotionSample) => void): () => void;
  onStatusChange?: (status: BiometricStatus) => void;
}

/**
 * Phones and tablets only: desktop browsers expose DeviceMotionEvent but
 * never fire it, and "put the laptop on the mattress" isn't a feature.
 */
export function isDeviceMotionPossible(): boolean {
  return (
    typeof window !== 'undefined' &&
    'DeviceMotionEvent' in window &&
    typeof navigator !== 'undefined' &&
    (navigator.maxTouchPoints ?? 0) > 0
  );
}

/** No event within this long after start = this device has no usable sensor. */
const FIRST_EVENT_TIMEOUT_MS = 4000;
/** Gravity tracker for devices that only report acceleration including gravity. */
const GRAVITY_SMOOTHING = 0.1;

type PermissionedMotionEvent = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * The phone's accelerometer, folded into 1 s epochs of mean |acceleration
 * without gravity|. Uses the browser's gravity-free `acceleration` when it
 * has one, else high-passes `accelerationIncludingGravity` itself.
 */
export class DeviceMotionSource implements MotionSource {
  readonly kind = 'device' as const;
  onStatusChange: ((status: BiometricStatus) => void) | undefined;

  private status: BiometricStatus = 'disconnected';
  private listeners = new Set<(sample: MotionSample) => void>();
  private gravity: [number, number, number] | null = null;
  private epochStart = 0;
  private sum = 0;
  private count = 0;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  getStatus(): BiometricStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.setStatus('connecting');
    // Synchronously first: the permission prompt needs the tap's gesture.
    const ctor = window.DeviceMotionEvent as unknown as PermissionedMotionEvent;
    if (typeof ctor.requestPermission === 'function') {
      let answer: 'granted' | 'denied';
      try {
        answer = await ctor.requestPermission();
      } catch {
        answer = 'denied';
      }
      if (answer !== 'granted') {
        this.setStatus('error');
        return;
      }
    }
    window.addEventListener('devicemotion', this.onMotion);
    this.timeout = setTimeout(() => {
      if (this.status === 'connecting') {
        window.removeEventListener('devicemotion', this.onMotion);
        this.setStatus('unavailable');
      }
    }, FIRST_EVENT_TIMEOUT_MS);
  }

  stop(): void {
    clearTimeout(this.timeout);
    window.removeEventListener('devicemotion', this.onMotion);
    this.gravity = null;
    this.epochStart = 0;
    this.sum = 0;
    this.count = 0;
    this.setStatus('disconnected');
  }

  subscribe(cb: (sample: MotionSample) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private onMotion = (event: DeviceMotionEvent) => {
    const magnitude = this.magnitudeOf(event);
    if (magnitude === null) return;
    if (this.status !== 'connected') this.setStatus('connected');
    const now = Date.now();
    if (this.epochStart === 0) this.epochStart = now;
    this.sum += magnitude;
    this.count += 1;
    if (now - this.epochStart >= 1000) {
      const sample: MotionSample = { timestamp: now, activity: this.sum / this.count };
      this.epochStart = now;
      this.sum = 0;
      this.count = 0;
      for (const listener of this.listeners) listener(sample);
    }
  };

  private magnitudeOf(event: DeviceMotionEvent): number | null {
    const a = event.acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) return Math.hypot(a.x, a.y, a.z);
    const g = event.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return null;
    const raw: [number, number, number] = [g.x, g.y, g.z];
    if (!this.gravity) {
      this.gravity = raw;
      return 0;
    }
    const grav = this.gravity;
    for (let i = 0; i < 3; i++) grav[i] += GRAVITY_SMOOTHING * (raw[i] - grav[i]);
    return Math.hypot(raw[0] - grav[0], raw[1] - grav[1], raw[2] - grav[2]);
  }

  private setStatus(status: BiometricStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}

export type SimulatedMotionMode = 'still' | 'restless' | 'settling';

/**
 * Dev/test motion source (`?simmotion`, `?simmotion=restless|settling`):
 * a quiet sensor-noise floor, plus 4-second movement bursts every 30 s
 * while restless. 'settling' tosses for the first 8 minutes, then lies still.
 */
export class SimulatedMotionSource implements MotionSource {
  readonly kind = 'simulated' as const;
  onStatusChange: ((status: BiometricStatus) => void) | undefined;

  private status: BiometricStatus = 'disconnected';
  private listeners = new Set<(sample: MotionSample) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private startedAt = 0;

  constructor(
    private readonly opts: {
      mode?: SimulatedMotionMode;
      rng?: () => number;
      intervalMs?: number;
    } = {},
  ) {}

  getStatus(): BiometricStatus {
    return this.status;
  }

  start(): Promise<void> {
    if (this.status === 'connected') return Promise.resolve();
    const { mode = 'settling', rng = Math.random, intervalMs = 1000 } = this.opts;
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this.startedAt) / 1000);
      const restless = mode === 'restless' || (mode === 'settling' && elapsedSec < 8 * 60);
      const burst = restless && elapsedSec % 30 < 4;
      const sample: MotionSample = {
        timestamp: Date.now(),
        activity: (burst ? 0.6 : 0.02) + 0.01 * rng(),
      };
      for (const listener of this.listeners) listener(sample);
    }, intervalMs);
    this.setStatus('connected');
    return Promise.resolve();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.setStatus('disconnected');
  }

  subscribe(cb: (sample: MotionSample) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(status: BiometricStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
