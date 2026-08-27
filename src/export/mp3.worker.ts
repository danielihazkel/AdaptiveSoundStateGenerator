import { Mp3Encoder } from '@breezystack/lamejs';
import { floatToInt16Block, MP3_BLOCK_SAMPLES } from './pcm';

/**
 * MP3 encoding worker: keeps the multi-minute lamejs encode off the main
 * thread. The channel ArrayBuffers arrive *transferred* — the ~1 GiB render
 * memory moves here rather than being copied, and the main thread's
 * AudioBuffer is left detached (empty) the moment encoding starts.
 */

export interface EncodeRequest {
  type: 'encode';
  sampleRate: number;
  kbps: number;
  left: ArrayBuffer;
  right: ArrayBuffer;
}

export type EncodeResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string };

/** Post progress only on ≥2% steps — one message per block would flood. */
const PROGRESS_STEP = 0.02;

// The project compiles against the DOM lib, so `self` is typed as Window;
// narrow to the worker-side postMessage shape instead of pulling in the
// webworker lib for this one file.
const post = (msg: EncodeResponse) =>
  (self as { postMessage(m: EncodeResponse): void }).postMessage(msg);

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  if (e.data.type !== 'encode') return;
  try {
    const left = new Float32Array(e.data.left);
    const right = new Float32Array(e.data.right);
    const encoder = new Mp3Encoder(2, e.data.sampleRate, e.data.kbps);
    const chunks: Uint8Array[] = [];
    const leftBlock = new Int16Array(MP3_BLOCK_SAMPLES);
    const rightBlock = new Int16Array(MP3_BLOCK_SAMPLES);
    let lastReported = 0;

    for (let offset = 0; offset < left.length; offset += MP3_BLOCK_SAMPLES) {
      const n = floatToInt16Block(left, offset, leftBlock);
      floatToInt16Block(right, offset, rightBlock);
      const chunk = encoder.encodeBuffer(
        n === MP3_BLOCK_SAMPLES ? leftBlock : leftBlock.subarray(0, n),
        n === MP3_BLOCK_SAMPLES ? rightBlock : rightBlock.subarray(0, n),
      );
      if (chunk.length > 0) chunks.push(chunk);
      const fraction = (offset + n) / left.length;
      if (fraction - lastReported >= PROGRESS_STEP) {
        lastReported = fraction;
        post({ type: 'progress', fraction });
      }
    }
    const tail = encoder.flush();
    if (tail.length > 0) chunks.push(tail);
    post({ type: 'done', blob: new Blob(chunks as BlobPart[], { type: 'audio/mpeg' }) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
