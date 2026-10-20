import { useMemo, useRef } from 'react';
import type { AudioEngine } from '../audio/engine';
import {
  gainToDb,
  roomExcessDb,
  stepMaskingGain,
  targetMaskingGain,
  type RoomReading,
} from '../audio/masking';
import {
  isRoomMeterPossible,
  MicrophoneRoomMeter,
  SimulatedRoomMeter,
  type RoomMeter,
  type SimulatedRoomMode,
} from '../audio/roomMeter';
import type { MentalState } from '../audio/states';

/** States that mask a room: the working ones, and relax. Never sleep (a mic all night). */
export const MASKING_STATES: ReadonlySet<MentalState> = new Set<MentalState>([
  'focus',
  'flow',
  'creative',
  'relax',
]);

/** Engine ramp per reading — the smoothing already lives in stepMaskingGain. */
const MASKING_TIME_CONSTANT = 2;
/** Readings kept (1 Hz): the session's first minute is the baseline. */
const READING_CAP = 4 * 60 * 60;

/**
 * Phase 16 adaptive masking: while a session that asked for it plays, the
 * room meter's once-a-second loudness readings drive the engine's masking
 * side channel (masking.ts). The microphone is opened from the Begin tap
 * and closed when the session ends — it is never held between sessions.
 */
export function useRoomMasking(deps: { getEngine: () => AudioEngine | null }) {
  const meterRef = useRef<RoomMeter | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const readingsRef = useRef<RoomReading[]>([]);
  const gainRef = useRef(1);
  const lastAtRef = useRef(0);
  const maxBoostDbRef = useRef<number | null>(null);
  /** Whether the playing leg wants masking (a routine may switch states). */
  const activeRef = useRef(false);

  /** Dev-only simulated room: ?simroom=quiet|loud|ramp. */
  const simulatedMode = useMemo((): SimulatedRoomMode | null => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('simroom')) return null;
    const mode = params.get('simroom');
    return mode === 'quiet' || mode === 'loud' ? mode : 'ramp';
  }, []);
  const possible = simulatedMode !== null || isRoomMeterPossible();

  const onReading = (reading: RoomReading) => {
    const readings = readingsRef.current;
    readings.push(reading);
    if (readings.length > READING_CAP) readings.splice(0, readings.length - READING_CAP);
    const dtSec = lastAtRef.current ? (reading.timestamp - lastAtRef.current) / 1000 : 1;
    lastAtRef.current = reading.timestamp;
    const target = activeRef.current
      ? targetMaskingGain(roomExcessDb(readings, reading.timestamp, gainToDb(gainRef.current)))
      : 1;
    gainRef.current = stepMaskingGain(gainRef.current, target, dtSec);
    deps.getEngine()?.setMasking(gainRef.current, MASKING_TIME_CONSTANT);
    const boostDb = gainToDb(gainRef.current);
    maxBoostDbRef.current = Math.max(maxBoostDbRef.current ?? 0, boostDb);
  };

  const reset = () => {
    readingsRef.current = [];
    gainRef.current = 1;
    lastAtRef.current = 0;
    maxBoostDbRef.current = null;
    deps.getEngine()?.setMasking(1);
  };

  return {
    possible,
    simulated: simulatedMode !== null,
    /** Call synchronously inside the Begin tap. A new session measures a fresh baseline. */
    start: (active: boolean) => {
      reset();
      activeRef.current = active;
      if (!possible) return;
      if (!meterRef.current) {
        meterRef.current = simulatedMode ? new SimulatedRoomMeter(simulatedMode) : new MicrophoneRoomMeter();
      }
      unsubscribeRef.current?.();
      unsubscribeRef.current = meterRef.current.subscribe(onReading);
      // Not awaited: the engine must still be created inside the same gesture.
      void meterRef.current.start().then((ok) => {
        if (!ok) maxBoostDbRef.current = null;
      });
    },
    /** A routine leg changed state: keep measuring, mask only where it belongs. */
    setActive: (active: boolean) => {
      activeRef.current = active;
    },
    /** Session over: close the microphone and put the beds back. */
    stop: () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      meterRef.current?.stop();
      activeRef.current = false;
      gainRef.current = 1;
      deps.getEngine()?.setMasking(1);
    },
    /** Largest boost this session reached, dB — null when the meter never ran. */
    getMaxBoostDb: (): number | null => maxBoostDbRef.current,
  };
}

export type RoomMasking = ReturnType<typeof useRoomMasking>;
