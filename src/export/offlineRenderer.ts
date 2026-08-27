import { AudioEngine } from '../audio/engine';
import { EVOLUTION_TIME_CONSTANT } from '../audio/ramp';
import type { MentalState } from '../audio/states';
import type { SoundProfile } from '../audio/types';
import { evaluateProgram } from '../programs/evaluator';
import type { Program } from '../programs/types';
import { evaluateArc, STATE_ARCS } from '../session/evolution';
import {
  buildRenderPlan,
  EXPORT_SAMPLE_RATE,
  MODULATION_STEP_SEC,
  type RenderEvent,
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
}

/** Pattern pulses are scheduled this far past the next checkpoint. */
const PULSE_HORIZON_SEC = 1.5;

/**
 * Render a full session offline, faster than realtime, by driving the
 * ordinary AudioEngine on an OfflineAudioContext. The render is suspended at
 * every timeline event; inside the frozen checkpoint ctx.currentTime equals
 * the event time, so the exact realtime code paths (setArcModulation /
 * setProgramModulation / fadeTo) schedule correctly with zero duplication of
 * the engine's composition logic. Progress is reported from the checkpoints.
 *
 * Aborting stops the render at the next checkpoint (never resumed) and
 * rejects with an AbortError; the abandoned context is simply GC'd.
 */
export async function renderSessionToBuffer(
  sel: ExportSelection,
  onProgress: (fraction01: number) => void,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  signal?.throwIfAborted();
  const plan = buildRenderPlan(sel);
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(plan.renderSeconds * EXPORT_SAMPLE_RATE),
    sampleRate: EXPORT_SAMPLE_RATE,
  });

  const engine = await AudioEngine.createOffline(sel.profile, ctx);

  const applyModulation = (elapsedSec: number) => {
    if (sel.program) {
      engine.setProgramModulation(
        evaluateProgram(sel.program, elapsedSec),
        EVOLUTION_TIME_CONSTANT,
      );
    } else {
      engine.setArcModulation(
        evaluateArc(STATE_ARCS[sel.state], elapsedSec / plan.durationSec),
        EVOLUTION_TIME_CONSTANT,
      );
    }
  };

  const handle = (ev: RenderEvent) => {
    switch (ev.kind) {
      case 'modulation':
        applyModulation(ev.time);
        engine.schedulePulsesUntil(ev.time + MODULATION_STEP_SEC + PULSE_HORIZON_SEC);
        break;
      case 'endFade':
        // The realtime scheduler keeps pattern pulses running through the end
        // fade, so schedule the whole fade window's worth in one go here.
        engine.schedulePulsesUntil(plan.durationSec);
        engine.scheduleOfflineEndFade(ev.fadeSeconds);
        break;
      case 'chime':
        engine.playOfflineChime();
        break;
    }
  };

  // t=0 setup — before rendering starts, mirroring SessionController.start().
  applyModulation(0);
  engine.schedulePulsesUntil(MODULATION_STEP_SEC + PULSE_HORIZON_SEC);
  await engine.whenAmbienceReady();
  signal?.throwIfAborted();
  engine.beginOffline();

  return await new Promise<AudioBuffer>((resolve, reject) => {
    let eventIdx = 0;
    const abort = () =>
      reject(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });

    // Chain one suspend at a time: the next suspend is registered inside the
    // current frozen checkpoint, before resume() — race-free by construction.
    const scheduleNext = () => {
      if (eventIdx >= plan.events.length) return;
      const ev = plan.events[eventIdx];
      eventIdx += 1;
      ctx.suspend(ev.time).then(() => {
        if (signal?.aborted) return; // never resumed; context is abandoned
        handle(ev);
        onProgress(ev.time / plan.renderSeconds);
        scheduleNext();
        void ctx.resume();
      }, reject);
    };
    scheduleNext();

    ctx.startRendering().then((buffer) => {
      signal?.removeEventListener('abort', abort);
      resolve(buffer);
    }, reject);
  });
}
