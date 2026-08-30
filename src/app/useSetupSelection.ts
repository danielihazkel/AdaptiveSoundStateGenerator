import { useState } from 'react';
import type { MentalState } from '../audio/states';
import type { CoachPlan } from '../coach/mapToSession';
import type { Program } from '../programs/types';
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
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>();
  const [selectedProgramId, setSelectedProgramId] = useState<string | undefined>();
  /** Session from history whose exact profile the next session replays. */
  const [replay, setReplay] = useState<SessionRecord | null>(null);

  return {
    mentalState,
    intensity,
    minutes,
    selectedPresetId,
    selectedProgramId,
    /** Only meaningful for the state it was recorded for. */
    replay: replay?.state === mentalState ? replay : null,
    setMinutes,
    selectState: (s: MentalState) => {
      setMentalState(s);
      setSelectedPresetId(undefined);
      setSelectedProgramId(undefined);
      setReplay(null);
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
      setSelectedPresetId(undefined);
    },
  };
}

export type SetupSelection = ReturnType<typeof useSetupSelection>;
