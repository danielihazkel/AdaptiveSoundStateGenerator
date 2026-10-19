import { useMemo, useState } from 'react';
import type { CheckpointResponse } from '../adaptation/types';
import { pulseDerivedPattern, type BreathPattern } from '../audio/breathing';
import type { StateDefinition } from '../audio/states';
import { MAX_MASTER_VOLUME, VOLUME_KEY_STEP } from '../audio/mixPolicy';
import { cloneProfile, type SoundProfile } from '../audio/types';
import { evaluateProgram, segmentAt } from '../programs/evaluator';
import type { Program } from '../programs/types';
import type { SessionSnapshot } from '../session/sessionController';
import { AdvancedPanel } from './AdvancedPanel';
import { BreathingPacer } from './BreathingPacer';
import { pacerRateFor } from './breathing';
import { formatClock } from './format';
import { MicroPrompt } from './MicroPrompt';
import { NightstandOverlay } from './NightstandOverlay';
import { SessionVisualizer } from './SessionVisualizer';
import { PresetSaveRow } from './PresetSaveRow';
import { Slider } from './Slider';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

export function SessionScreen(props: {
  stateDef: StateDefinition;
  snapshot: SessionSnapshot;
  profile: SoundProfile;
  onProfileChange: (next: SoundProfile) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /** "+15 min" — absent for programs (fixed shape) or once the cap is reached. */
  onExtend?: () => void;
  /** Wake-up alarm controls (phase 'alarm'). */
  onDismissAlarm: () => void;
  onSnooze: () => void;
  onSavePreset: (name: string) => void;
  /** Timed program driving this session, if any — shows the phase readout. */
  program?: Program;
  /** Guided breathing the mix is swelling with; else the pacer follows a slow pulse. */
  breathing?: BreathPattern;
  /** Adaptation check-in, when one is pending (Phase 3, PRD §17). */
  microPrompt?: {
    onRespond: (response: CheckpointResponse) => void;
    onDismiss: () => void;
  };
  /** Dark nightstand screen after a quiet spell (sleep, by default). */
  nightstand?: boolean;
  /** Visualizer source (AudioEngine.attachAnalyser); absent = no visualizer. */
  getAnalyser?: () => AnalyserNode | null;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { phase, remainingSec, elapsedSec, resumeFailed, openEnded } = props.snapshot;
  // elapsedSec is already whole seconds, so this coalesces the two 500 ms
  // ticks per second into one evaluation.
  const { programPhase, programBpm } = useMemo(
    () => ({
      programPhase: props.program ? segmentAt(props.program, elapsedSec) : null,
      programBpm: props.program ? evaluateProgram(props.program, elapsedSec).rhythm?.bpm : undefined,
    }),
    [props.program, elapsedSec],
  );
  // Same path as the advanced panel's slider: a volume-only change is an
  // implicit signal, never a customization (useSessionOrchestrator).
  const setVolume = (v: number) => {
    const next = cloneProfile(props.profile);
    next.masterVolume = Math.min(MAX_MASTER_VOLUME, Math.max(0, v));
    props.onProfileChange(next);
  };
  const pacerRate = pacerRateFor(props.profile);
  const breathPattern =
    props.breathing ?? (pacerRate !== null ? pulseDerivedPattern(pacerRate) : null);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const over = phase === 'finished' || phase === 'stoppedEarly';
  const nudgeVolume = (delta: number) =>
    setVolume(Math.round((props.profile.masterVolume + delta) * 100) / 100);
  useKeyboardShortcuts({
    ' ':
      phase === 'running'
        ? props.onPause
        : phase === 'paused' || phase === 'interrupted'
          ? props.onResume
          : undefined,
    ArrowUp: over ? undefined : () => nudgeVolume(VOLUME_KEY_STEP),
    ArrowDown: over ? undefined : () => nudgeVolume(-VOLUME_KEY_STEP),
    '+': props.onExtend && (phase === 'running' || phase === 'ending') ? props.onExtend : undefined,
    '?': () => setShowShortcuts((v) => !v),
  });

  const live = phase === 'running' || phase === 'paused' || phase === 'ending';
  // Lift the cover whenever the session needs the user.
  const needsAttention =
    (phase === 'running' && props.microPrompt !== undefined) ||
    phase === 'alarm' ||
    phase === 'interrupted' ||
    resumeFailed === true;

  return (
    <>
      <NightstandOverlay
        active={props.nightstand === true && live}
        hold={needsAttention}
        clock={formatClock(openEnded ? elapsedSec : remainingSec)}
      />
      <div className="session-header">
        <span className="session-state">
          {props.stateDef.emoji} {props.stateDef.label}
          {props.program && ` · ${props.program.name}`}
        </span>
        <div className="session-clock" aria-label={openEnded ? 'Time elapsed' : 'Time remaining'}>
          {formatClock(openEnded ? elapsedSec : remainingSec)}
        </div>
        <p className="hint session-phase" aria-live="polite">
          {phase === 'paused' && 'Paused'}
          {phase === 'interrupted' && 'Interrupted'}
          {phase === 'ending' &&
            (props.snapshot.windingDown ? 'Asleep — fading out 🌙' : 'Winding down…')}
          {phase === 'running' && (openEnded ? 'Playing · until you stop' : 'Playing')}
          {phase === 'alarm' && 'Time to wake up'}
        </p>
        {programPhase && (
          <p className="hint program-phase-readout">
            Now: {programPhase.segment.label}
            {programBpm !== undefined && ` · ${Math.round(programBpm)} BPM`}
            {programPhase.nextIn !== null &&
              ` — next: ${
                props.program!.segments[programPhase.index + 1].label
              } in ${formatClock(Math.ceil(programPhase.nextIn))}`}
          </p>
        )}
      </div>

      {/* One moving shape at a time: the pacer wins when it is shown, and the
          nightstand screen exists to be dark. */}
      {props.getAnalyser && !props.nightstand && !breathPattern && live && (
        <SessionVisualizer getAnalyser={props.getAnalyser} playing={phase === 'running'} />
      )}

      {breathPattern && (phase === 'running' || phase === 'paused') && (
        <BreathingPacer
          pattern={breathPattern}
          elapsedSec={elapsedSec}
          paused={phase !== 'running'}
        />
      )}

      {phase === 'running' && props.microPrompt && (
        <MicroPrompt
          onRespond={props.microPrompt.onRespond}
          onDismiss={props.microPrompt.onDismiss}
        />
      )}

      {phase === 'interrupted' && (
        <div className="notice warning">
          <span>Audio was interrupted — another app may have taken over the sound.</span>
          <button type="button" className="chip" onClick={props.onResume}>
            Resume session
          </button>
        </div>
      )}

      {resumeFailed && (phase === 'paused' || phase === 'interrupted') && (
        <p className="notice warning" role="alert">
          Couldn't resume audio — tap Resume again. If it keeps failing, check that no
          other app is holding the sound output.
        </p>
      )}

      {phase === 'alarm' && (
        <div className="alarm-panel" role="alert" aria-live="assertive">
          <p className="alarm-title">☀️ Good morning</p>
          <div className="transport">
            <button type="button" className="play-button" onClick={props.onDismissAlarm}>
              Dismiss
            </button>
            <button type="button" className="chip" onClick={props.onSnooze}>
              Snooze 5 min
            </button>
          </div>
        </div>
      )}

      <div className="transport session-transport">
        {phase === 'running' && (
          <button type="button" className="play-button playing" onClick={props.onPause}>
            ❚❚ Pause
          </button>
        )}
        {phase === 'paused' && (
          <button type="button" className="play-button" onClick={props.onResume}>
            ► Resume
          </button>
        )}
        {(phase === 'running' || phase === 'paused' || phase === 'interrupted') && (
          <button type="button" className="stop-button" onClick={props.onStop}>
            ■ Stop
          </button>
        )}
        {props.onExtend && (phase === 'running' || phase === 'ending') && (
          <button type="button" className="chip" onClick={props.onExtend}>
            +15 min
          </button>
        )}
      </div>

      {!over && (
        <div className="session-volume">
          <Slider
            label="Volume"
            min={0}
            max={MAX_MASTER_VOLUME}
            step={0.01}
            value={props.profile.masterVolume}
            display={`${Math.round(props.profile.masterVolume * 100)}%`}
            onChange={setVolume}
          />
        </div>
      )}

      {showShortcuts && (
        <div className="notice shortcuts-help" role="note" aria-label="Keyboard shortcuts">
          <dl>
            <dt>Space</dt>
            <dd>Pause / resume</dd>
            <dt>↑ ↓</dt>
            <dd>Volume</dd>
            {props.onExtend && (
              <>
                <dt>+</dt>
                <dd>+15 min</dd>
              </>
            )}
            <dt>?</dt>
            <dd>Show / hide this list</dd>
          </dl>
        </div>
      )}

      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={showAdvanced}
        aria-controls="session-advanced"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '▾ Hide sound parameters' : '▸ Sound parameters'}
      </button>
      {showAdvanced && (
        <div id="session-advanced">
          <AdvancedPanel profile={props.profile} onChange={props.onProfileChange} />
          <PresetSaveRow
            defaultName={`${props.stateDef.label} custom`}
            onSave={props.onSavePreset}
          />
        </div>
      )}
    </>
  );
}
