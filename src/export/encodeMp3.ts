import type { EncodeRequest, EncodeResponse } from './mp3.worker';

export const MP3_KBPS = 192;

/**
 * Encode a rendered stereo AudioBuffer to MP3 in a worker. The channel
 * ArrayBuffers are transferred, not copied — after this call the AudioBuffer
 * is detached (reads as silence), which is exactly what releases the ~1 GiB
 * render memory on the main thread. Abort terminates the worker.
 */
export function encodeToMp3(
  buffer: AudioBuffer,
  onProgress: (fraction01: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Export cancelled', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), {
      type: 'module',
    });
    const abort = () => {
      worker.terminate();
      reject(signal?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    const finish = (act: () => void) => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      act();
    };

    worker.onmessage = (e: MessageEvent<EncodeResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.fraction);
      else if (msg.type === 'done') finish(() => resolve(msg.blob));
      else finish(() => reject(new Error(msg.message)));
    };
    worker.onerror = (e) => finish(() => reject(new Error(e.message || 'MP3 worker failed')));

    const left = buffer.getChannelData(0).buffer as ArrayBuffer;
    const right = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)
      .buffer as ArrayBuffer;
    const request: EncodeRequest = {
      type: 'encode',
      sampleRate: buffer.sampleRate,
      kbps: MP3_KBPS,
      left,
      right,
    };
    worker.postMessage(request, right === left ? [left] : [left, right]);
  });
}
