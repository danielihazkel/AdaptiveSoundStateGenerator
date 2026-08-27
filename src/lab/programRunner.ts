import type { AudioEngine } from '../audio/engine';
import { EVOLUTION_TIME_CONSTANT } from '../audio/ramp';
import { STATES } from '../audio/states';
import { evaluateProgram } from '../programs/evaluator';
import { programMinDurationSec, type Program } from '../programs/types';
import { ElapsedClock } from '../session/elapsedClock';
import { resolveEndChime } from '../session/endPolicy';

export type RunStatus = 'idle' | 'running' | 'paused' | 'ending' | 'finished';

export interface RunSnapshot {
  status: RunStatus;
  elapsedSec: number;
  /** null when the final segment is open-ended — the run lasts until Stop. */
  totalSec: number | null;
  program: Program | null;
}

const TICK_MS = 500;

/**
 * Real-time timed program runs inside the sound lab: the sandbox counterpart
 * of SessionController. Drives the engine's program side channel from a
 * wall-clock, with pause/resume and the state's proper end fade/chime — but
 * writes no SessionRecord, feeds no bandit, and (unlike SessionController)
 * never touches engine.onContextStateChange, so real sessions keep their
 * interruption detection. Known limitation: lab runs themselves have none.
 *
 * A closed program (last segment has an endMin) auto-ends at its total
 * duration; an open-ended final segment plays until stopped, matching how
 * program sessions let extra time extend into the open segment.
 */
export class LabProgramRunner {
  private program: Program | null = null;
  private engine: AudioEngine | null = null;
  private totalSec: number | null = null;
  private readonly clock = new ElapsedClock();
  private interval: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<() => void>();
  private snapshot: RunSnapshot = {
    status: 'idle',
    elapsedSec: 0,
    totalSec: null,
    program: null,
  };

  get status(): RunStatus {
    return this.snapshot.status;
  }

  getSnapshot = (): RunSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(program: Program, engine: AudioEngine): Promise<void> {
    clearInterval(this.interval);
    this.program = program;
    this.engine = engine;
    const last = program.segments[program.segments.length - 1];
    this.totalSec = last.endMin !== null ? programMinDurationSec(program) : null;
    // Begin at t=0 rather than jumping after the first tick.
    engine.setProgramModulation(evaluateProgram(program, 0));
    await engine.start();
    this.clock.start();
    this.interval = setInterval(() => this.tick(), TICK_MS);
    this.publish('running');
  }

  async pause(): Promise<void> {
    if (this.snapshot.status !== 'running') return;
    this.clock.pause();
    this.publish('paused');
    await this.engine?.pause();
  }

  async resume(): Promise<void> {
    if (this.snapshot.status !== 'paused') return;
    await this.engine?.resume();
    this.clock.resume();
    this.publish('running');
  }

  /** Ends the run (quick fade if still audible) and hands the engine back clean. */
  stop(): void {
    const status = this.snapshot.status;
    if (status === 'idle') return;
    clearInterval(this.interval);
    this.interval = undefined;
    this.clock.pause();
    if (status !== 'finished') this.engine?.stop();
    this.engine?.setProgramModulation(null);
    this.program = null;
    this.totalSec = null;
    this.publish('idle');
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private tick(): void {
    const status = this.snapshot.status;
    if (status !== 'running' && status !== 'ending') return;
    const program = this.program;
    const engine = this.engine;
    if (!program || !engine) return;
    const elapsedSec = this.clock.elapsedMs() / 1000;

    if (this.totalSec !== null) {
      const remaining = this.totalSec - elapsedSec;
      const end = STATES[program.baseState].end;
      if (status === 'running' && remaining <= end.fadeSeconds) {
        engine.endSession(
          Math.max(remaining, 0.1),
          resolveEndChime(program.baseState, program, true),
        );
        this.publish('ending');
        return;
      }
      if (status === 'ending') {
        if (remaining <= 0) {
          clearInterval(this.interval);
          this.interval = undefined;
          this.clock.pause();
          engine.setProgramModulation(null);
          this.publish('finished');
        } else {
          this.publish(); // the end fade owns the sound; just refresh the clock
        }
        return;
      }
    }

    engine.setProgramModulation(evaluateProgram(program, elapsedSec), EVOLUTION_TIME_CONSTANT);
    this.publish();
  }

  private publish(status: RunStatus = this.snapshot.status): void {
    const elapsedSec = Math.round(this.clock.elapsedMs() / 1000);
    this.snapshot = {
      status,
      elapsedSec:
        status === 'idle'
          ? 0
          : this.totalSec !== null
            ? Math.min(elapsedSec, this.totalSec)
            : elapsedSec,
      totalSec: this.totalSec,
      program: this.program,
    };
    for (const listener of this.listeners) listener();
  }
}
