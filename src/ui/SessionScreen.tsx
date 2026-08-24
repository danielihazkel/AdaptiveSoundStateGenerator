import { useState } from 'react';
import type { CheckpointResponse } from '../adaptation/types';
import type { StateDefinition } from '../audio/states';
import type { SampleAmbienceType, SoundProfile } from '../audio/types';
import { evaluateProgram, segmentAt } from '../programs/evaluator';
import type { Program } from '../programs/types';
import type { SessionSnapshot } from '../session/sessionController';
import { AdvancedPanel } from './AdvancedPanel';
import { MicroPrompt } from './MicroPrompt';
import { PresetSaveRow } from './PresetSaveRow';

function formatClock(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function SessionScreen(props: {
  stateDef: StateDefinition;
  snapshot: SessionSnapshot;
  profile: SoundProfile;
  onProfileChange: (next: SoundProfile) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSavePreset: (name: string) => void;
  /** Timed program driving this session, if any — shows the phase readout. */
  program?: Program;
  /** Sample ambience types with a shipped asset (see AdvancedPanel). */
  availableSampleTypes?: ReadonlySet<SampleAmbienceType>;
  /** Adaptation check-in, when one is pending (Phase 3, PRD §17). */
  microPrompt?: {
    onRespond: (response: CheckpointResponse) => void;
    onDismiss: () => void;
  };
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { phase, remainingSec, elapsedSec } = props.snapshot;
  const programPhase = props.program ? segmentAt(props.program, elapsedSec) : null;
  const programBpm = props.program
    ? evaluateProgram(props.program, elapsedSec).rhythm?.bpm
    : undefined;

  return (
    <>
      <div className="session-header">
        <span className="session-state">
          {props.stateDef.emoji} {props.stateDef.label}
          {props.program && ` · ${props.program.name}`}
        </span>
        <div className="session-clock">{formatClock(remainingSec)}</div>
        <p className="hint session-phase">
          {phase === 'paused' && 'Paused'}
          {phase === 'ending' && 'Winding down…'}
          {phase === 'running' && 'Playing'}
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
      </div>

      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '▾ Hide sound parameters' : '▸ Sound parameters'}
      </button>
      {showAdvanced && (
        <>
          <AdvancedPanel
            profile={props.profile}
            onChange={props.onProfileChange}
            availableSampleTypes={props.availableSampleTypes}
          />
          <PresetSaveRow
            defaultName={`${props.stateDef.label} custom`}
            onSave={props.onSavePreset}
          />
        </>
      )}
    </>
  );
}
