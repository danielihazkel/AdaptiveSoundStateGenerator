import type { BreathPattern } from '../audio/breathing';
import { AudioEngine } from '../audio/engine';
import type { PulseHandover } from '../audio/pulseModulator';
import { EVOLUTION_TIME_CONSTANT } from '../audio/ramp';
import type { MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { evaluateProgram } from '../programs/evaluator';
import type { Program } from '../programs/types';
import { evaluateArc, resolveArc, type WakeUp } from '../session/evolution';
import { alignmentDelays, frac } from './phaseTracker';
import {
  buildRenderPlan,
  CHUNK_CROSSFADE_SEC,
  CHUNK_LEAD_SEC,
  EXPORT_SAMPLE_RATE,
  MODULATION_STEP_SEC,
  splitRenderPlan,
  type RenderChunk,
  type RenderEvent,
  type RenderPlan,
} from './renderTimeline';

/**
 * Everything that pins down one exportable session. Mirrors SessionConfig,
 * minus the realtime-only concerns (adaptation checkpoints, presetId): an
 * export is the profile plus its deterministic arc/program evolution.
 */
export interface ExportSelection {
  profile: SoundProfile;
  state: MentalState;
  durationSec: number;
  program: Program | null;
  chimeEnabled: boolean;
  /** Guided breathing swell (plain sessions only) — see SessionConfig. */
  breathing?: BreathPattern | null;
  /** Wake-up rise + chime (plain sessions only) — see SessionConfig. */
  wakeUp?: WakeUp | null;
}

/** Pattern pulses are scheduled this far past the next checkpoint. */
const PULSE_HORIZON_SEC = 1.5;

/**
 * What one chunk hands the next: the rhythm pattern's scheduled pulses and
 * bar position, and the tone/binaural oscillator phases (cycles, wrapped) at
 * the seam's alignment instant — the middle of the crossfade, where the two
 * renders are mixed at equal power.
 */
export interface ChunkHandover {
  pulse: PulseHandover;
  phases: number[];
}

/** Alignment instant relative to the *next* chunk's origin (its lead minus half the crossfade). */
const ALIGN_AT_NEXT_CTX_SEC = CHUNK_LEAD_SEC - CHUNK_CROSSFADE_SEC / 2;

/**
 * Render a full session offline, faster than realtime, by driving the
 * ordinary AudioEngine on an OfflineAudioContext — one per chunk (see
 * splitRenderPlan), each handed to `onChunk` as soon as it is done and then
 * dropped, so peak memory is one chunk. Within a chunk the render is
 * suspended at every timeline event; inside the frozen checkpoint
 * ctx.currentTime equals the event time, so the exact realtime code paths
 * (setArcModulation / setProgramModulation / fadeTo) schedule correctly with
 * zero duplication of the engine's composition logic.
 *
 * Chunks after the first start CHUNK_LEAD_SEC early on a fresh engine that is
 * jumped straight to the session's values at that moment (no fade-in, or the
 * end fade resumed mid-way). Two things a fresh engine cannot re-derive are
 * handed over from the previous chunk: the rhythm pattern's bar position
 * (it depends on the whole BPM history) and the oscillator phases (the
 * previous chunk's trackers integrated every frequency ramp; the next chunk
 * delays each oscillator's start by under one period to match).
 *
 * Aborting stops the render at the next checkpoint (never resumed) and
 * rejects with an AbortError; the engine is disposed and the abandoned
 * context is left to GC.
 */
export async function renderSessionChunks(
  sel: ExportSelection,
  onChunk: (buffer: AudioBuffer, chunk: RenderChunk) => void,
  onProgress: (fraction01: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const plan = buildRenderPlan(sel);
  let handover: ChunkHandover | null = null;
  for (const chunk of splitRenderPlan(plan)) {
    const buffer = await renderChunk(sel, plan, chunk, handover, onProgress, signal);
    handover = buffer.handover;
    onChunk(buffer.audio, chunk);
  }
}

async function renderChunk(
  sel: ExportSelection,
  plan: RenderPlan,
  chunk: RenderChunk,
  handover: ChunkHandover | null,
  onProgress: (fraction01: number) => void,
  signal?: AbortSignal,
): Promise<{ audio: AudioBuffer; handover: ChunkHandover | null }> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(chunk.lengthSec * EXPORT_SAMPLE_RATE),
    sampleRate: EXPORT_SAMPLE_RATE,
  });
  const engine = await AudioEngine.createOffline(sel.profile, ctx);
  try {
    return await driveChunk(engine, ctx, sel, plan, chunk, handover, onProgress, signal);
  } finally {
    // Each chunk builds a full node graph (worklets, oscillators); release it
    // explicitly rather than leaving 16 of them to GC during a 4 h export.
    engine.dispose();
  }
}

async function driveChunk(
  engine: AudioEngine,
  ctx: OfflineAudioContext,
  sel: ExportSelection,
  plan: RenderPlan,
  chunk: RenderChunk,
  handover: ChunkHandover | null,
  onProgress: (fraction01: number) => void,
  signal?: AbortSignal,
): Promise<{ audio: AudioBuffer; handover: ChunkHandover | null }> {
  const toAbs = (ctxTime: number) => chunk.originSec + ctxTime;
  const toCtx = (absTime: number) => absTime - chunk.originSec;
  const arc = resolveArc(sel.state, {
    wakeUp: sel.program ? undefined : (sel.wakeUp ?? undefined),
    durationSec: plan.durationSec,
  });

  const applyModulation = (absSec: number, timeConstant?: number) => {
    if (sel.program) {
      engine.setProgramModulation(evaluateProgram(sel.program, absSec), timeConstant);
    } else {
      engine.setArcModulation(evaluateArc(arc, absSec / plan.durationSec), timeConstant);
    }
  };

  const handle = (ev: RenderEvent) => {
    switch (ev.kind) {
      case 'modulation':
        applyModulation(toAbs(ev.time), EVOLUTION_TIME_CONSTANT);
        engine.schedulePulsesUntil(ev.time + MODULATION_STEP_SEC + PULSE_HORIZON_SEC);
        break;
      case 'endFade':
        // The realtime scheduler keeps pattern pulses running through the end
        // fade, so schedule the whole fade window's worth in one go here.
        engine.schedulePulsesUntil(toCtx(plan.durationSec));
        engine.scheduleOfflineEndFade(ev.fadeSeconds);
        break;
      case 'chime':
        engine.playOfflineChime();
        break;
    }
  };

  // t=0 setup — before rendering starts, mirroring SessionController.start()
  // for the first chunk; later chunks snap (default quick ramp) onto the
  // session's values at their origin and pick up the rhythm mid-bar.
  // Breath cycle 0 is session t=0, i.e. ctx time −originSec in this chunk.
  if (!sel.program && sel.breathing) engine.setBreathPattern(sel.breathing, -chunk.originSec);
  applyModulation(chunk.originSec);
  if (handover) engine.importPulseHandover(handover.pulse, -chunk.originSec);
  engine.schedulePulsesUntil(MODULATION_STEP_SEC + PULSE_HORIZON_SEC);
  await engine.whenAmbienceReady();
  signal?.throwIfAborted();
  // Every frequency ramp issued so far (build + the snap to this origin's
  // values) is on the trackers, so the start delay that lands each
  // oscillator on the previous chunk's phase at the seam is computable now.
  // Modulation steps before the seam (τ = 2 s toward values a second of arc
  // away) move the integral by far less than a thousandth of a cycle.
  const oscillatorDelays = handover
    ? alignmentDelays(engine.oscillatorPhaseTrackers(), handover.phases, ALIGN_AT_NEXT_CTX_SEC)
    : null;
  if (chunk.fadeInProgress) {
    engine.beginOffline({
      fadeIn: false,
      gainFraction: chunk.fadeInProgress.gainFraction,
      oscillatorDelays,
    });
    if (chunk.fadeInProgress.remainingSec > 0) {
      engine.schedulePulsesUntil(toCtx(plan.durationSec));
      engine.scheduleOfflineEndFade(chunk.fadeInProgress.remainingSec);
    }
  } else {
    engine.beginOffline({ fadeIn: chunk.index === 0, oscillatorDelays });
  }

  let abort: (() => void) | undefined;
  const audio = await new Promise<AudioBuffer>((resolve, reject) => {
    let eventIdx = 0;
    abort = () =>
      reject(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });

    // Chain one suspend at a time: the next suspend is registered inside the
    // current frozen checkpoint, before resume() — race-free by construction.
    const scheduleNext = () => {
      if (eventIdx >= chunk.events.length) return;
      const ev = chunk.events[eventIdx];
      eventIdx += 1;
      ctx.suspend(ev.time).then(() => {
        if (signal?.aborted) return; // never resumed; context is abandoned
        handle(ev);
        onProgress(toAbs(ev.time) / plan.renderSeconds);
        scheduleNext();
        void ctx.resume();
      }, reject);
    };
    scheduleNext();

    ctx.startRendering().then(resolve, reject);
  }).finally(() => {
    if (abort) signal?.removeEventListener('abort', abort);
  });

  if (chunk.last) return { audio, handover: null };
  // Pulses that spill past the next chunk's origin, plus where the bar is —
  // and where each oscillator's phase sits at the seam's alignment instant
  // (next origin + lead − half the crossfade, i.e. this chunk's end − half).
  const alignAtCtx = chunk.lengthSec - CHUNK_CROSSFADE_SEC / 2;
  return {
    audio,
    handover: {
      pulse: engine.exportPulseHandover(chunk.lengthSec - CHUNK_LEAD_SEC, chunk.originSec),
      phases: engine.oscillatorPhaseTrackers().map((tracker) => frac(tracker.phaseAt(alignAtCtx))),
    },
  };
}
