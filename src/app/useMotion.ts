import { useMemo, useRef, useState } from 'react';
import type { MotionSample } from '../biometrics/motion';
import {
  DeviceMotionSource,
  isDeviceMotionPossible,
  SimulatedMotionSource,
  type MotionSource,
  type SimulatedMotionMode,
} from '../biometrics/motionSources';
import type { BiometricStatus } from '../biometrics/types';

/** In-memory epoch cap ≈ 12 h at 1 Hz — a whole night. */
const MOTION_SAMPLE_CAP = 43_200;

/**
 * Phase 16 phone motion (PRD §17 "movement"; consent per §14), the sibling
 * of useBiometrics: raw epochs stay in memory only, bounded, reset per
 * session. Started from Begin (a gesture — iOS asks permission the first
 * time) once the user has opted in, and kept running across sessions.
 */
export function useMotion() {
  const sourceRef = useRef<MotionSource | null>(null);
  const samplesRef = useRef<MotionSample[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  /** Any epoch arrived during the running session. */
  const usedRef = useRef(false);
  const [status, setStatus] = useState<BiometricStatus>('disconnected');

  /** Dev-only simulated sensor: ?simmotion (settling), ?simmotion=still|restless. */
  const simulatedMode = useMemo((): SimulatedMotionMode | null => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('simmotion')) return null;
    const mode = params.get('simmotion');
    return mode === 'still' || mode === 'restless' ? mode : 'settling';
  }, []);
  const simulated = simulatedMode !== null;
  const possible = simulated || isDeviceMotionPossible();

  /** Call synchronously inside a tap. Resolves once started (or refused). */
  const start = async () => {
    if (!possible) return;
    if (!sourceRef.current) {
      const source: MotionSource = simulatedMode
        ? new SimulatedMotionSource({ mode: simulatedMode })
        : new DeviceMotionSource();
      source.onStatusChange = setStatus;
      sourceRef.current = source;
      unsubscribeRef.current = source.subscribe((sample) => {
        const buffer = samplesRef.current;
        buffer.push(sample);
        if (buffer.length > MOTION_SAMPLE_CAP) buffer.splice(0, buffer.length - MOTION_SAMPLE_CAP);
        usedRef.current = true;
      });
    }
    await sourceRef.current.start();
  };

  return {
    status,
    possible,
    simulated,
    start,
    stop: () => sourceRef.current?.stop(),
    getSamples: (): MotionSample[] => samplesRef.current,
    wasUsed: () => usedRef.current,
    resetForSession: () => {
      samplesRef.current = [];
      usedRef.current = false;
    },
  };
}

export type Motion = ReturnType<typeof useMotion>;
