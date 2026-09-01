import { useMemo, useRef, useState } from 'react';
import { SimulatedHeartRateSource } from '../biometrics/simulatedHr';
import {
  isWebBluetoothAvailable,
  type BiometricSample,
  type BiometricSource,
  type BiometricStatus,
} from '../biometrics/types';
import { WebBluetoothHeartRateSource } from '../biometrics/webBluetoothHr';

/** In-memory sample cap ≈ 2h at 1 Hz — plenty for any session's windows. */
const HR_SAMPLE_CAP = 7200;

/**
 * Phase 3 biometrics (PRD §17; consent per §14). Raw samples stay in memory
 * only, bounded, reset per session — only per-window deltas ever persist.
 */
export function useBiometrics() {
  const sourceRef = useRef<BiometricSource | null>(null);
  const samplesRef = useRef<BiometricSample[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  /** Any sample arrived during the running session. */
  const usedRef = useRef(false);
  const [status, setStatus] = useState<BiometricStatus>('disconnected');

  /**
   * Dev-only simulated sensor: open the app with ?simhr (rising trend) or
   * ?simhr=sleep (falling, settling — exercises the sleep-onset detector).
   */
  const simulatedMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('simhr')) return null;
    return params.get('simhr') === 'sleep' ? ('sleep' as const) : ('rising' as const);
  }, []);
  const simulated = simulatedMode !== null;
  const possible = simulated || isWebBluetoothAvailable();

  const connect = async () => {
    if (!sourceRef.current) {
      const source: BiometricSource = simulated
        ? new SimulatedHeartRateSource(
            simulatedMode === 'sleep'
              ? { baselineBpm: 64, driftPerMin: -0.8, noiseBpm: 1, hrvMs: 55 }
              : { driftPerMin: 2 },
          )
        : new WebBluetoothHeartRateSource();
      source.onStatusChange = setStatus;
      sourceRef.current = source;
    }
    const source = sourceRef.current;
    try {
      await source.connect();
    } catch {
      return; // user cancelled the chooser or the strap refused — status shows it
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = source.subscribe((sample) => {
      const buffer = samplesRef.current;
      buffer.push(sample);
      if (buffer.length > HR_SAMPLE_CAP) buffer.splice(0, buffer.length - HR_SAMPLE_CAP);
      usedRef.current = true;
    });
  };

  return {
    status,
    possible,
    simulated,
    connect,
    disconnect: () => sourceRef.current?.disconnect(),
    getSamples: (): BiometricSample[] => samplesRef.current,
    wasUsed: () => usedRef.current,
    resetForSession: () => {
      samplesRef.current = [];
      usedRef.current = false;
    },
  };
}

export type Biometrics = ReturnType<typeof useBiometrics>;
