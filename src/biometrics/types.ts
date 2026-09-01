/**
 * Optional wearable signals (Phase 3, PRD §17). Strictly opt-in (PRD §14:
 * explicit consent before reading any wearable data) and strictly optional —
 * every consumer must degrade gracefully when no source is connected.
 * Raw samples live only in memory; nothing biometric is ever persisted
 * beyond a per-segment summary delta.
 */
export interface BiometricSample {
  heartRateBpm: number;
  /** ms epoch */
  timestamp: number;
  /**
   * Beat-to-beat (RR) intervals in ms, when the sensor reports them (most
   * chest straps do) — the raw material for HRV. In memory only, like every
   * sample; never persisted.
   */
  rrIntervalsMs?: number[];
}

export type BiometricStatus =
  | 'unavailable'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface BiometricSource {
  readonly kind: 'bluetooth-hr' | 'simulated';
  getStatus(): BiometricStatus;
  /** Must be called from a user gesture (Web Bluetooth requirement). */
  connect(): Promise<void>;
  disconnect(): void;
  /** Returns an unsubscribe function. */
  subscribe(cb: (sample: BiometricSample) => void): () => void;
  onStatusChange?: (status: BiometricStatus) => void;
}

/** Chrome/Edge on desktop/Android only; not Safari/iOS. */
export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}
