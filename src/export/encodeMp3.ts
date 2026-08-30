import type { EncodeRequest, EncodeResponse } from './mp3.worker';

export const MP3_KBPS = 192;

/**
 * Streaming MP3 encoder session backed by the worker. Push rendered chunks as
 * they arrive (their channel ArrayBuffers are transferred, not copied — after
 * a push the source AudioBuffer is detached, which is exactly what releases
 * that chunk's render memory on the main thread); the encoder runs while the
 * next chunk renders. `finish()` resolves with the file once the chunk pushed
 * with `last: true` has been flushed. Abort terminates the worker.
 */
export class Mp3Stream {
  private readonly worker: Worker;
  private pushedSamples = 0;
  private readonly done: Promise<Blob>;
  private settle: { resolve: (b: Blob) => void; reject: (e: unknown) => void } | undefined;

  constructor(
    sampleRate: number,
    private readonly onProgress: (encodedSamples: number, pushedSamples: number) => void,
    private readonly signal?: AbortSignal,
  ) {
    this.worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.done = new Promise<Blob>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
    const abort = () => this.fail(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    this.worker.onmessage = (e: MessageEvent<EncodeResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') this.onProgress(msg.samples, this.pushedSamples);
      else if (msg.type === 'done') {
        signal?.removeEventListener('abort', abort);
        this.worker.terminate();
        this.settle?.resolve(msg.blob);
      } else this.fail(new Error(msg.message));
    };
    this.worker.onerror = (e) => this.fail(new Error(e.message || 'MP3 worker failed'));
    const start: EncodeRequest = { type: 'start', sampleRate, kbps: MP3_KBPS };
    this.worker.postMessage(start);
  }

  /** Encode samples [start, end) of the buffer's channels. Detaches the buffer. */
  push(buffer: AudioBuffer, start: number, end: number, last: boolean): void {
    if (this.signal?.aborted) return;
    const left = buffer.getChannelData(0).buffer as ArrayBuffer;
    const right = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)
      .buffer as ArrayBuffer;
    this.pushedSamples += end - start;
    const request: EncodeRequest = { type: 'chunk', left, right, start, end, last };
    this.worker.postMessage(request, right === left ? [left] : [left, right]);
  }

  finish(): Promise<Blob> {
    return this.done;
  }

  private fail(err: unknown): void {
    this.worker.terminate();
    this.settle?.reject(err);
  }
}
