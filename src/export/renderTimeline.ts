import { STATES, type MentalState } from '../audio/states';

/**
 * 44.1 kHz, not 32 kHz: LOWPASS_OPEN_HZ is 18 kHz and focus/relax/energy run
 * the master lowpass wide open over white/blue noise — a 16 kHz Nyquist would
 * audibly dull exactly the states most likely to be exported. Also MP3-native.
 */
export const EXPORT_SAMPLE_RATE = 44100;
/**
 * Hard cap on rendered audio. OfflineAudioContext renders into one monolithic
 * Float32 AudioBuffer: 44.1 kHz stereo is ~20 MiB per minute, so 60 min is
 * already ~1.2 GiB of process memory; 180 min (~3.5 GiB) cannot allocate.
 * Longer selections export their first hour, closed with the state's end fade.
 */
export const EXPORT_MAX_SECONDS = 3600;
/**
 * Checkpoint cadence for replaying the session evolution offline. Realtime
 * ticks every 500 ms; under the τ=2 s EVOLUTION_TIME_CONSTANT smoothing a 1 s
 * offline cadence is indistinguishable, at half the suspend/resume overhead.
 */
export const MODULATION_STEP_SEC = 1;
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
  /** A program's endChime overrides the state (mirrors SessionController). */
  program?: { endChime?: boolean } | null;
}): RenderPlan {
  const capped = opts.durationSec > EXPORT_MAX_SECONDS;
  const durationSec = capped ? EXPORT_MAX_SECONDS : opts.durationSec;
  const end = STATES[opts.state].end;
  const fadeStart = Math.max(0, durationSec - end.fadeSeconds);
  const chime = opts.program?.endChime ?? (end.chime === 'optional' && opts.chimeEnabled);

  const events: RenderEvent[] = [];
  for (let t = MODULATION_STEP_SEC; t < fadeStart; t += MODULATION_STEP_SEC) {
    events.push({ time: t, kind: 'modulation' });
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
