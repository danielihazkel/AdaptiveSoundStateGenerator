import type { MentalState } from '../audio/states';
import type { Program } from '../programs/types';
import { resolveEndChime, resolveEndFadeSeconds } from '../session/endPolicy';
import type { WakeUp } from '../session/evolution';

/**
 * 44.1 kHz, not 32 kHz: LOWPASS_OPEN_HZ is 18 kHz and focus/relax/energy run
 * the master lowpass wide open over white/blue noise — a 16 kHz Nyquist would
 * audibly dull exactly the states most likely to be exported. Also MP3-native.
 */
export const EXPORT_SAMPLE_RATE = 44100;
/**
 * Hard cap on exported audio — a wall-clock guard now, not a memory one:
 * exports render in EXPORT_CHUNK_SECONDS pieces (see splitRenderPlan), so
 * peak memory is one chunk regardless of length. Four hours covers a full
 * night's sleep program at a few minutes of render time.
 */
export const EXPORT_MAX_SECONDS = 4 * 3600;
/**
 * Each chunk is one OfflineAudioContext, which renders into a monolithic
 * Float32 buffer (~20 MiB per minute at 44.1 kHz stereo): 15 min ≈ 300 MiB,
 * comfortably under what a phone tab can allocate.
 */
export const EXPORT_CHUNK_SECONDS = 15 * 60;
/**
 * Every chunk after the first starts this far *before* its nominal start: a
 * fresh engine needs ~0.25 s for its τ=0.05 s ramps to settle onto the
 * session's current values, then CHUNK_CROSSFADE_SEC of overlap with the
 * previous chunk's tail hides the seam (free-running oscillators restart at
 * phase 0 per chunk — the equal-power crossfade masks that).
 */
export const CHUNK_LEAD_SEC = 3;
export const CHUNK_CROSSFADE_SEC = 2;
/** A trailing chunk shorter than this is folded into the previous one. */
const MIN_LAST_CHUNK_SEC = 30;
/**
 * Checkpoint cadence for replaying the session evolution offline. Realtime
 * ticks every 500 ms; under the τ=2 s EVOLUTION_TIME_CONSTANT smoothing a 1 s
 * offline cadence is indistinguishable, at half the suspend/resume overhead.
 */
export const MODULATION_STEP_SEC = 1;
/** Phase-boundary cues sit this far after their (whole-second) checkpoint. */
const BOUNDARY_CUE_OFFSET_SEC = 0.01;
/** Silence appended after the chime (its decay) or after a chime-less fade. */
const CHIME_TAIL_SEC = 2.5;
const PLAIN_TAIL_SEC = 0.2;

export type RenderEvent =
  | { time: number; kind: 'modulation' }
  | { time: number; kind: 'endFade'; fadeSeconds: number }
  | { time: number; kind: 'chime' };

export interface RenderPlan {
  /** Total length of the offline render, including the end tail. */
  renderSeconds: number;
  /** Effective session length after the cap. */
  durationSec: number;
  /** True when the requested duration exceeded EXPORT_MAX_SECONDS. */
  capped: boolean;
  /** Strictly increasing; the offline driver suspends at each time. */
  events: RenderEvent[];
}

/**
 * Pure timeline for one offline session render, mirroring the realtime
 * SessionController: modulation checkpoints every MODULATION_STEP_SEC while
 * "running", none once the end fade starts (the fade owns the finish), the
 * per-state fade duration, and the optional chime at the very end.
 */
export function buildRenderPlan(opts: {
  state: MentalState;
  durationSec: number;
  chimeEnabled: boolean;
  /**
   * A program's endChime overrides the state, and boundaryChime adds a cue
   * at every closed phase boundary (mirrors SessionController).
   */
  program?: Partial<Pick<Program, 'endChime' | 'boundaryChime' | 'segments'>> | null;
  /** Wake-up ending: short fade and always a chime (plain sessions only). */
  wakeUp?: WakeUp | null;
}): RenderPlan {
  const capped = opts.durationSec > EXPORT_MAX_SECONDS;
  const durationSec = capped ? EXPORT_MAX_SECONDS : opts.durationSec;
  const wakeUp = !opts.program && Boolean(opts.wakeUp);
  const fadeStart = Math.max(0, durationSec - resolveEndFadeSeconds(opts.state, wakeUp));
  // A file has no alarm phase to ring after the rise, so a wake-up export
  // keeps the single closing chime the live session replaces with the alarm.
  const chime =
    wakeUp ||
    resolveEndChime(
      opts.state,
      (opts.program as Program | undefined) ?? undefined,
      opts.chimeEnabled,
      wakeUp,
    );

  const events: RenderEvent[] = [];
  for (let t = MODULATION_STEP_SEC; t < fadeStart; t += MODULATION_STEP_SEC) {
    events.push({ time: t, kind: 'modulation' });
  }
  if (opts.program?.boundaryChime && opts.program.segments) {
    // Boundaries land on whole seconds, i.e. on modulation checkpoints —
    // nudge each cue just past its checkpoint so event times stay strictly
    // increasing (the offline driver suspends once per event).
    for (const segment of opts.program.segments.slice(0, -1)) {
      if (segment.endMin === null) continue;
      const time = segment.endMin * 60 + BOUNDARY_CUE_OFFSET_SEC;
      if (time > 0 && time < fadeStart) events.push({ time, kind: 'chime' });
    }
    events.sort((a, b) => a.time - b.time);
  }
  events.push({ time: fadeStart, kind: 'endFade', fadeSeconds: durationSec - fadeStart });
  if (chime) events.push({ time: durationSec, kind: 'chime' });

  return {
    renderSeconds: durationSec + (chime ? CHIME_TAIL_SEC : PLAIN_TAIL_SEC),
    durationSec,
    capped,
    events,
  };
}

/** One OfflineAudioContext's worth of a render. Times inside are ctx time. */
export interface RenderChunk {
  index: number;
  last: boolean;
  /** Absolute session time at this chunk's ctx t=0 (= startSec − leadSec). */
  originSec: number;
  /** Absolute time where this chunk's audio takes over from the previous one. */
  startSec: number;
  /** Absolute end of this chunk's audio. */
  endSec: number;
  leadSec: number;
  /** Render length in ctx seconds (endSec − originSec). */
  lengthSec: number;
  /** Master-plan events inside (originSec, endSec), re-timed to ctx time (> 0). */
  events: RenderEvent[];
  /**
   * Non-null when the end fade began at or before originSec: the chunk must
   * start at `gainFraction` of master volume and finish the fade over
   * `remainingSec` (0 = silence already reached — chime/tail only).
   */
  fadeInProgress: { remainingSec: number; gainFraction: number } | null;
}

/**
 * Split a plan into consecutive chunks of at most EXPORT_CHUNK_SECONDS. A
 * plan that fits in one chunk yields exactly one chunk with no lead —
 * byte-identical to a monolithic render. Later chunks overlap the previous
 * one by CHUNK_LEAD_SEC so the encoder can crossfade across the seam.
 */
export function splitRenderPlan(plan: RenderPlan): RenderChunk[] {
  const total = plan.renderSeconds;
  let count = Math.max(1, Math.ceil(total / EXPORT_CHUNK_SECONDS));
  if (count > 1 && total - (count - 1) * EXPORT_CHUNK_SECONDS < MIN_LAST_CHUNK_SEC) {
    count -= 1;
  }
  const endFade = plan.events.find((e) => e.kind === 'endFade');
  const fadeStart = endFade?.time ?? plan.durationSec;
  const fadeSeconds = endFade && endFade.kind === 'endFade' ? endFade.fadeSeconds : 0;

  const chunks: RenderChunk[] = [];
  for (let k = 0; k < count; k++) {
    const last = k === count - 1;
    const startSec = k * EXPORT_CHUNK_SECONDS;
    const endSec = last ? total : (k + 1) * EXPORT_CHUNK_SECONDS;
    const leadSec = k === 0 ? 0 : CHUNK_LEAD_SEC;
    const originSec = startSec - leadSec;
    const events = plan.events
      .filter((e) => e.time > originSec && e.time < endSec)
      .map((e) => ({ ...e, time: e.time - originSec }));

    let fadeInProgress: RenderChunk['fadeInProgress'] = null;
    if (originSec >= fadeStart) {
      const remainingSec = Math.max(0, fadeStart + fadeSeconds - originSec);
      fadeInProgress = {
        remainingSec,
        gainFraction: fadeSeconds > 0 ? remainingSec / fadeSeconds : 0,
      };
    }
    chunks.push({
      index: k,
      last,
      originSec,
      startSec,
      endSec,
      leadSec,
      lengthSec: endSec - originSec,
      events,
      fadeInProgress,
    });
  }
  return chunks;
}
