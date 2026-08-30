import { useMemo, useState } from 'react';
import type { CheckpointResponse } from '../adaptation/types';
import { pulseDerivedPattern, type BreathPattern } from '../audio/breathing';
import type { StateDefinition } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { evaluateProgram, segmentAt } from '../programs/evaluator';
import type { Program } from '../programs/types';
import type { SessionSnapshot } from '../session/sessionController';
import { AdvancedPanel } from './AdvancedPanel';
import { BreathingPacer } from './BreathingPacer';
import { pacerRateFor } from './breathing';
import { formatClock } from './format';
import { MicroPrompt } from './MicroPrompt';
import { PresetSaveRow } from './PresetSaveRow';

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
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { phase, remainingSec, elapsedSec, resumeFailed } = props.snapshot;
  // elapsedSec is already whole seconds, so this coalesces the two 500 ms
  // ticks per second into one evaluation.
  const { programPhase, programBpm } = useMemo(
    () => ({
      programPhase: props.program ? segmentAt(props.program, elapsedSec) : null,
      programBpm: props.program ? evaluateProgram(props.program, elapsedSec).rhythm?.bpm : undefined,
    }),
    [props.program, elapsedSec],
  );
  const pacerRate = pacerRateFor(props.profile);
  const breathPattern =
    props.breathing ?? (pacerRate !== null ? pulseDerivedPattern(pacerRate) : null);

  return (
    <>
      <div className="session-header">
        <span className="session-state">
          {props.stateDef.emoji} {props.stateDef.label}
          {props.program && ` · ${props.program.name}`}
        </span>
        <div className="session-clock" aria-label="Time remaining">
          {formatClock(remainingSec)}
        </div>
        <p className="hint session-phase" aria-live="polite">
          {phase === 'paused' && 'Paused'}
          {phase === 'interrupted' && 'Interrupted'}
          {phase === 'ending' && 'Winding down…'}
          {phase === 'running' && 'Playing'}
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
