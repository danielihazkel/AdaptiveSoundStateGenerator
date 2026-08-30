import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../../audio/engine';
import { EVOLUTION_TIME_CONSTANT } from '../../audio/ramp';
import { evaluateProgram, segmentAt } from '../../programs/evaluator';
import {
  normalizeProfile,
  type SoundProfile,
} from '../../audio/types';
import { programMinDurationSec, type Program } from '../../programs/types';
import { formatMinSec } from '../format';

/** Short ramp for scrubbing: instant enough to audition, no clicks. */
const SCRUB_TIME_CONSTANT = 0.15;
const TICK_MS = 500;

/**
 * Audition a timed program without waiting in real time: scrub to any moment
 * (the program modulation applies with a short ramp) or play through from the
 * scrub point at normal speed. Everything goes through the engine's program
 * side channel, so the lab's base profile stays untouched.
 */
export function TimelinePreview(props: {
  programs: Program[];
  getEngine: () => AudioEngine | null;
  /** Applies the selected program's base sound to the lab. */
  onApplyBase: (profile: SoundProfile) => void;
  /** Freeze the preview while a timed run owns the program channel. */
  disabled?: boolean;
}) {
  const [programId, setProgramId] = useState<string>('');
  const [positionSec, setPositionSec] = useState(0);
  const [rolling, setRolling] = useState(false);
  const tickerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const rollStartRef = useRef({ wallMs: 0, positionSec: 0 });

  const program = props.programs.find((p) => p.id === programId);
  const maxSec = program ? programMinDurationSec(program) + 600 : 0;

  const stopRolling = () => {
    clearInterval(tickerRef.current);
    tickerRef.current = undefined;
    setRolling(false);
  };

  // Clear the preview modulation whenever the selection goes away or the
  // component unmounts — the lab must hand the engine back clean.
  useEffect(() => {
    if (program) return;
    stopRolling();
    props.getEngine()?.setProgramModulation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);
  useEffect(
    () => () => {
      clearInterval(tickerRef.current);
      props.getEngine()?.setProgramModulation(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // A timed run takes over the program channel — stop rolling, don't clear it.
  useEffect(() => {
    if (props.disabled) stopRolling();
  }, [props.disabled]);

  const applyAt = (t: number, timeConstant: number) => {
    if (!program) return;
    props.getEngine()?.setProgramModulation(evaluateProgram(program, t), timeConstant);
  };

  const scrubTo = (t: number) => {
    stopRolling();
    setPositionSec(t);
    applyAt(t, SCRUB_TIME_CONSTANT);
  };

  const playFromHere = () => {
    if (!program) return;
    stopRolling();
    rollStartRef.current = { wallMs: Date.now(), positionSec };
    applyAt(positionSec, SCRUB_TIME_CONSTANT);
    tickerRef.current = setInterval(() => {
      const start = rollStartRef.current;
      const t = start.positionSec + (Date.now() - start.wallMs) / 1000;
      setPositionSec(t);
      applyAt(t, EVOLUTION_TIME_CONSTANT);
    }, TICK_MS);
    setRolling(true);
  };

  const phase = program ? segmentAt(program, positionSec) : null;
  const bpm = program ? evaluateProgram(program, positionSec).rhythm?.bpm : undefined;

  return (
    <section className="panel timeline-preview">
      <div className="panel-header">
        <h2>Program preview</h2>
      </div>
      <label className="control">
        <span>Program</span>
        <select
          value={programId}
          disabled={props.disabled}
          onChange={(e) => {
            stopRolling();
            setPositionSec(0);
            setProgramId(e.target.value);
            const next = props.programs.find((p) => p.id === e.target.value);
            if (next) {
              props.onApplyBase(normalizeProfile(next.baseProfile));
              props.getEngine()?.setProgramModulation(
                evaluateProgram(next, 0),
                SCRUB_TIME_CONSTANT,
              );
            }
          }}
        >
          <option value="">— none —</option>
          {props.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span />
      </label>
      {program && (
        <>
          <label className="control">
            <span>Position</span>
            <input
              type="range"
              min={0}
              max={maxSec}
              step={5}
              value={Math.min(positionSec, maxSec)}
              disabled={props.disabled}
              onChange={(e) => scrubTo(Number(e.target.value))}
            />
            <span className="value">{formatMinSec(positionSec)}</span>
          </label>
          {phase && (
            <p className="hint">
              {phase.segment.label}
              {bpm !== undefined && ` · ${Math.round(bpm)} BPM`}
              {phase.nextIn !== null && ` · next in ${formatMinSec(phase.nextIn)}`}
            </p>
          )}
          <div className="preset-strip">
            {rolling ? (
              <button type="button" className="chip" disabled={props.disabled} onClick={stopRolling}>
                ❚❚ Hold position
              </button>
            ) : (
              <button type="button" className="chip" disabled={props.disabled} onClick={playFromHere}>
                ► Play from here
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
