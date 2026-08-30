import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AudioEngine } from '../../audio/engine';
import { STATES, type MentalState } from '../../audio/states';
import {
  cloneProfile,
  normalizeProfile,
  type SampleAmbienceType,
  type SoundProfile,
} from '../../audio/types';
import type { Mp3Exporter } from '../../export/useMp3Export';
import { LabProgramRunner } from '../../lab/programRunner';
import { randomizeProfile } from '../../lab/randomize';
import { WakeLockHolder } from '../../platform/wakeLock';
import type { Program } from '../../programs/types';
import type { Preset } from '../../storage/types';
import { AdvancedPanel } from '../AdvancedPanel';
import { PresetSaveRow } from '../PresetSaveRow';
import { StatePicker } from '../StatePicker';
import { ExplorePanel } from './ExplorePanel';
import { ProgramRunPanel } from './ProgramRunPanel';
import { TimelinePreview } from './TimelinePreview';

/**
 * The sound lab (a grown-up Phase 0 test bench): instant audio, every
 * parameter live, timed program runs, timeline scrubbing, and exploration
 * tools. Only reachable when no session is running; the engine is shared
 * with sessions, created lazily on the first Play tap (user gesture).
 */
export function LabScreen(props: {
  ensureEngine: (profile: SoundProfile) => Promise<AudioEngine>;
  getEngine: () => AudioEngine | null;
  presets: Preset[];
  programs: Program[];
  exporter: Mp3Exporter;
  chimeEnabled: boolean;
  availableSampleTypes?: ReadonlySet<SampleAmbienceType>;
  onSavePreset: (name: string, profile: SoundProfile, state: MentalState, intensity: number) => void;
  onBack: () => void;
}) {
  const [labState, setLabState] = useState<MentalState>('focus');
  const [labIntensity, setLabIntensity] = useState(0.5);
  const [profile, setProfile] = useState<SoundProfile>(() =>
    STATES.focus.buildProfile(0.5),
  );
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);

  const runnerRef = useRef<LabProgramRunner | null>(null);
  runnerRef.current ??= new LabProgramRunner();
  const runner = runnerRef.current;
  const runStatus = useSyncExternalStore(runner.subscribe, runner.getSnapshot).status;
  const runActive =
    runStatus === 'running' || runStatus === 'paused' || runStatus === 'ending';
  // The lab must hand the engine back clean — the runner stops its audio and
  // clears the program channel on unmount.
  useEffect(() => () => runnerRef.current?.dispose(), []);
  // A timed run takes over the transport; when it ends the engine is stopped,
  // so the instant Play button must not come back showing Stop.
  useEffect(() => {
    if (runActive) setPlaying(false);
  }, [runActive]);
  // A timed run is a session in all but name — keep the screen awake for it.
  const wakeLockRef = useRef<WakeLockHolder | null>(null);
  wakeLockRef.current ??= new WakeLockHolder();
  useEffect(() => {
    if (runStatus === 'running') void wakeLockRef.current?.acquire();
    else wakeLockRef.current?.release();
  }, [runStatus]);
  useEffect(() => () => wakeLockRef.current?.release(), []);

  const apply = (next: SoundProfile) => {
    setProfile(next);
    props.getEngine()?.applyProfile(next);
  };

  const play = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      if (runner.status !== 'idle') runner.stop();
      const engine = await props.ensureEngine(profile);
      engine.applyProfile(profile);
      await engine.start();
      setPlaying(true);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const stop = () => {
    props.getEngine()?.stop();
    setPlaying(false);
  };

  const loadStateDefault = (state: MentalState, intensity: number) => {
    setLabState(state);
    setLabIntensity(intensity);
    apply(STATES[state].buildProfile(intensity));
  };

  const statePresets = props.presets.filter((p) => p.state === labState);

  return (
    <section className="lab-screen">
      <h2 className="setup-question">Sound lab</h2>
      <p className="hint">
        Instant audio or a timed program run — try any combination, then save
        what works.
      </p>

      {!runActive && (
        <div className="transport">
          {playing ? (
            <button type="button" className="play-button playing" onClick={stop}>
              ■ Stop
            </button>
          ) : (
            <button type="button" className="play-button" disabled={starting} onClick={() => void play()}>
              {starting ? 'Starting…' : '► Play'}
            </button>
          )}
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2>Starting point</h2>
        </div>
        <StatePicker
          value={labState}
          onChange={(state) => loadStateDefault(state, labIntensity)}
        />
        <label className="control">
          <span>Depth</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={labIntensity}
            onChange={(e) => loadStateDefault(labState, Number(e.target.value))}
          />
          <span className="value">{Math.round(labIntensity * 100)}%</span>
        </label>
        {statePresets.length > 0 && (
          <div className="preset-strip">
            {statePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="chip"
                onClick={() => apply(normalizeProfile(preset.profile))}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <ProgramRunPanel
        runner={runner}
        programs={props.programs}
        state={labState}
        intensity={labIntensity}
        ensureEngine={props.ensureEngine}
        onApplyBase={apply}
        exporter={props.exporter}
        chimeEnabled={props.chimeEnabled}
      />

      <TimelinePreview
        programs={props.programs}
        getEngine={props.getEngine}
        onApplyBase={apply}
        disabled={runActive}
      />

      <ExplorePanel
        state={labState}
        intensity={labIntensity}
        onRandomize={() => apply(randomizeProfile(profile))}
        onApply={apply}
      />

      <AdvancedPanel
        profile={profile}
        onChange={apply}
        availableSampleTypes={props.availableSampleTypes}
      />
      <PresetSaveRow
        defaultName={`${STATES[labState].label} lab`}
        onSave={(name) =>
          props.onSavePreset(name, cloneProfile(profile), labState, labIntensity)
        }
      />

      <button type="button" className="link-button" onClick={props.onBack}>
        ← Back
      </button>
    </section>
  );
}
