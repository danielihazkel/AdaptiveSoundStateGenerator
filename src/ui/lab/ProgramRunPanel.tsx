import { useState, useSyncExternalStore } from 'react';
import type { AudioEngine } from '../../audio/engine';
import type { MentalState } from '../../audio/states';
import { normalizeProfile, type SoundProfile } from '../../audio/types';
import { programExportSelection } from '../../export/programExport';
import type { Mp3Exporter } from '../../export/useMp3Export';
import type { LabProgramRunner } from '../../lab/programRunner';
import { segmentAt } from '../../programs/evaluator';
import { PROGRAM_TEMPLATES } from '../../programs/templates';
import type { Program } from '../../programs/types';
import { ExportRow } from '../ExportRow';
import { formatMinSec } from '../format';

/**
 * Run a timed program for real inside the lab: phases advance on a wall
 * clock with pause/resume and the proper end fade/chime — the full program
 * experience without a session (nothing is recorded). Templates are built
 * from the lab's current state/depth at run time, like in session setup.
 */
export function ProgramRunPanel(props: {
  runner: LabProgramRunner;
  programs: Program[];
  state: MentalState;
  intensity: number;
  ensureEngine: (profile: SoundProfile) => Promise<AudioEngine>;
  /** Applies the program's base sound to the lab, like the preview does. */
  onApplyBase: (profile: SoundProfile) => void;
  exporter: Mp3Exporter;
  chimeEnabled: boolean;
}) {
  const [selection, setSelection] = useState('');
  const [starting, setStarting] = useState(false);
  const snap = useSyncExternalStore(props.runner.subscribe, props.runner.getSnapshot);

  const resolveProgram = (): Program | null => {
    if (selection.startsWith('p:')) {
      return props.programs.find((p) => p.id === selection.slice(2)) ?? null;
    }
    if (selection.startsWith('t:')) {
      const template = PROGRAM_TEMPLATES.find((t) => t.id === selection.slice(2));
      return template ? template.build(props.state, props.intensity) : null;
    }
    return null;
  };

  const run = async () => {
    if (starting) return;
    const program = resolveProgram();
    if (!program) return;
    setStarting(true);
    try {
      if (snap.status === 'finished') props.runner.stop();
      const base = normalizeProfile(program.baseProfile);
      props.onApplyBase(base);
      const engine = await props.ensureEngine(base);
      await props.runner.start(program, engine);
    } finally {
      setStarting(false);
    }
  };

  const active =
    snap.status === 'running' || snap.status === 'paused' || snap.status === 'ending';
  const phase = snap.program ? segmentAt(snap.program, snap.elapsedSec) : null;

  return (
    <section className="panel program-run">
      <div className="panel-header">
        <h2>Timed run</h2>
      </div>
      <label className="control">
        <span>Program</span>
        <select
          value={selection}
          disabled={active}
          onChange={(e) => setSelection(e.target.value)}
        >
          <option value="">— none —</option>
          {props.programs.length > 0 && (
            <optgroup label="Saved programs">
              {props.programs.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Templates">
            {PROGRAM_TEMPLATES.map((t) => (
              <option key={t.id} value={`t:${t.id}`}>
                {t.emoji ? `${t.emoji} ${t.label}` : t.label}
              </option>
            ))}
          </optgroup>
        </select>
        <span />
      </label>

      {active && (
        <p className="hint">
          {formatMinSec(snap.elapsedSec)}
          {snap.totalSec !== null
            ? ` / ${formatMinSec(snap.totalSec)}`
            : ' · until stopped'}
          {phase && ` · ${phase.segment.label}`}
          {phase && phase.nextIn !== null && ` · next in ${formatMinSec(phase.nextIn)}`}
        </p>
      )}
      {snap.status === 'finished' && <p className="hint">Program finished.</p>}

      <div className="preset-strip">
        {!active && (
          <button
            type="button"
            className="chip"
            disabled={starting || selection === ''}
            onClick={() => void run()}
          >
            {starting ? 'Starting…' : '► Run'}
          </button>
        )}
        {snap.status === 'running' && (
          <button type="button" className="chip" onClick={() => void props.runner.pause()}>
            ❚❚ Pause
          </button>
        )}
        {snap.status === 'paused' && (
          <button type="button" className="chip" onClick={() => void props.runner.resume()}>
            ► Resume
          </button>
        )}
        {active && (
          <button type="button" className="chip" onClick={() => props.runner.stop()}>
            ■ Stop
          </button>
        )}
      </div>
      {!active && selection !== '' && (
        <ExportRow
          exporter={props.exporter}
          label="⤓ Download MP3"
          onDownload={() => {
            const program = resolveProgram();
            if (!program) return;
            const { sel, label } = programExportSelection(program, props.chimeEnabled);
            void props.exporter.start(sel, label);
          }}
        />
      )}
    </section>
  );
}
