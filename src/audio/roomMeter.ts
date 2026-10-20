import type { RoomReading } from './masking';

/** A once-a-second loudness reading of the room (masking.ts). */
export interface RoomMeter {
  /** Must be called from a user gesture (microphone permission). False = refused / no mic. */
  start(): Promise<boolean>;
  stop(): void;
  /** Returns an unsubscribe function. */
  subscribe(cb: (reading: RoomReading) => void): () => void;
}

const READ_EVERY_MS = 1000;
/** Silence floor for log(0). */
const MIN_DB = -100;

/**
 * Microphone level meter: getUserMedia → MediaStreamSource → AnalyserNode,
 * in its own AudioContext and never connected to any output. Once a second
 * it reduces the last analyser window to one RMS number; samples are never
 * kept, recorded or sent anywhere. Echo cancellation stays on so the meter
 * hears the room more than the app's own sound.
 */
export class MicrophoneRoomMeter implements RoomMeter {
  private listeners = new Set<(reading: RoomReading) => void>();
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  async start(): Promise<boolean> {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      return false;
    }
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    this.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const x of buffer) sum += x * x;
      const rms = Math.sqrt(sum / buffer.length);
      const reading: RoomReading = {
        timestamp: Date.now(),
        db: rms > 0 ? Math.max(MIN_DB, 20 * Math.log10(rms)) : MIN_DB,
      };
      for (const listener of this.listeners) listener(reading);
    }, READ_EVERY_MS);
    return true;
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  subscribe(cb: (reading: RoomReading) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export type SimulatedRoomMode = 'quiet' | 'loud' | 'ramp';

/**
 * Dev/test room (`?simroom=quiet|loud|ramp`): a steady −50 dBFS room; 'loud'
 * jumps 18 dB after the first minute (a café filling up), 'ramp' climbs
 * 1 dB every 10 s from then on, up to +20 dB.
 */
export class SimulatedRoomMeter implements RoomMeter {
  private listeners = new Set<(reading: RoomReading) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly mode: SimulatedRoomMode = 'ramp') {}

  start(): Promise<boolean> {
    if (this.timer !== undefined) return Promise.resolve(true);
    const startedAt = Date.now();
    this.timer = setInterval(() => {
      const sec = (Date.now() - startedAt) / 1000;
      const over = Math.max(0, sec - 60);
      const lift = this.mode === 'loud' ? (over > 0 ? 18 : 0) : this.mode === 'ramp' ? Math.min(20, over / 10) : 0;
      const reading: RoomReading = { timestamp: Date.now(), db: -50 + lift + ((sec * 7) % 3) / 3 - 0.5 };
      for (const listener of this.listeners) listener(reading);
    }, READ_EVERY_MS);
    return Promise.resolve(true);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  subscribe(cb: (reading: RoomReading) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

/**
 * Room masking is offered where a microphone exists — except iOS, where
 * opening the mic moves the audio session into play-and-record, which can
 * turn the app's own output down or onto the earpiece.
 */
export function isRoomMeterPossible(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !ios;
}
