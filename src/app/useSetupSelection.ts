import { useState } from 'react';
import type { MentalState } from '../audio/states';
import type { CoachPlan } from '../coach/mapToSession';
import { INTERVAL_STATES, normalizeIntervalPlan, type IntervalPlan } from '../programs/intervals';
import type { Program } from '../programs/types';
import { minutesUntil } from '../session/wallClock';
import type { Preset, SessionRecord } from '../storage/types';

/**
 * What the setup screen has chosen: state, depth, duration, and at most one
 * of preset / program / history replay. The setters encode the exclusivity
 * rules — picking a program clears the preset, changing the state clears
 * everything derived from another state, and so on.
 */
export function useSetupSelection(opts: {
  /** The user changed the setup by hand — the coach's suggestion no longer applies. */
  onUserOverride: () => void;
}) {
  const [mentalState, setMentalState] = useState<MentalState>('focus');
  const [intensity, setIntensityState] = useState(0.5);
  const [minutes, setMinutes] = useState(30);
  /** "End at HH:MM" — when set, the duration is resolved from the wall clock at Begin. */
  const [endAt, setEndAtState] = useState<string | null>(null);
  /** "Until I stop" — no planned length. Exclusive with "End at". */
  const [openEnded, setOpenEndedState] = useState(false);
  const setEndAt = (next: string | null) => {
    setEndAtState(next);
    if (next !== null) setOpenEndedState(false);
  };
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>();
  const [selectedProgramId, setSelectedProgramId] = useState<string | undefined>();
  /** Session from history whose exact profile the next session replays. */
  const [replay, setReplay] = useState<SessionRecord | null>(null);
  /** Interval (Pomodoro) plan; generates a program at Begin. Exclusive with programs. */
  const [intervals, setIntervalsState] = useState<IntervalPlan | null>(null);

  return {
    mentalState,
    intensity,
    minutes,
    selectedPresetId,
    selectedProgramId,
    /** Only meaningful for the state it was recorded for. */
    replay: replay?.state === mentalState ? replay : null,
    setMinutes,
    endAt,
    setEndAt,
    openEnded,
    setOpenEnded: (next: boolean) => {
      setOpenEndedState(next);
      if (next) setEndAtState(null);
    },
    /**
     * Minutes the next session will run. Resolved at call time — the setup
     * screen may sit open for a while, and "end at 07:00" must mean 07:00.
     */
    resolveMinutes: (now = new Date()): number =>
      (endAt !== null ? minutesUntil(endAt, now) : null) ?? minutes,
    intervals: INTERVAL_STATES.has(mentalState) ? intervals : null,
    setIntervals: (plan: IntervalPlan | null) => {
      setIntervalsState(plan);
      if (plan) {
        setSelectedProgramId(undefined);
        setReplay(null);
      }
    },
    selectState: (s: MentalState) => {
      setMentalState(s);
      setSelectedPresetId(undefined);
      setSelectedProgramId(undefined);
      setReplay(null);
      if (!INTERVAL_STATES.has(s)) setIntervalsState(null);
      // Picking a state manually overrides whatever the coach set up.
      opts.onUserOverride();
    },
    setIntensity: (v: number) => {
      setIntensityState(v);
      setSelectedPresetId(undefined);
      setReplay(null);
    },
    selectPreset: (preset: Preset | undefined) => {
      setSelectedPresetId(preset?.id);
      if (preset) {
        setIntensityState(preset.intensity);
        setSelectedProgramId(undefined);
        setReplay(null);
      }
    },
    /** A preset was deleted — drop the selection if it was the one. */
    forgetPreset: (id: string) => {
      if (selectedPresetId === id) setSelectedPresetId(undefined);
    },
    selectProgram: (program: Program | undefined) => {
      setSelectedProgramId(program?.id);
      if (program) {
        setSelectedPresetId(undefined);
        setReplay(null);
        setIntervalsState(null);
        // The program owns the base sound — keep the visible state in sync
        // so warnings and end behavior read correctly.
        setMentalState(program.baseState);
      }
    },
    forgetProgram: (id: string) => {
      if (selectedProgramId === id) setSelectedProgramId(undefined);
    },
    /** Replay the exact sound of an earlier session (history screen). */
    replayFrom: (record: SessionRecord) => {
      setReplay(record);
      setEndAtState(null);
      setOpenEndedState(record.openEnded === true);
      // An interval session replays its plan too (the sound comes from the record).
      setIntervalsState(record.intervals ? normalizeIntervalPlan(record.intervals) : null);
      setMentalState(record.state);
      setIntensityState(record.intensity);
      setSelectedPresetId(undefined);
      setSelectedProgramId(undefined);
      opts.onUserOverride();
    },
    clearReplay: () => setReplay(null),
    applyCoachPlan: (plan: CoachPlan) => {
      setMentalState(plan.state);
      setIntensityState(plan.intensity);
      setMinutes(plan.minutes);
      setEndAtState(null);
      setOpenEndedState(false);
      setSelectedPresetId(undefined);
    },
  };
}

export type SetupSelection = ReturnType<typeof useSetupSelection>;
