import { Mp3Encoder } from '@breezystack/lamejs';
import { floatToInt16Block, MP3_BLOCK_SAMPLES } from './pcm';

/**
 * Streaming MP3 encoding worker: keeps the multi-minute lamejs encode off
 * the main thread. One `start` opens the encoder; each `chunk` arrives with
 * its channel ArrayBuffers *transferred* (the chunk's render memory moves
 * here rather than being copied) and is encoded immediately, so at most one
 * chunk is alive at a time; the chunk flagged `last` flushes and returns the
 * whole file as a Blob.
 */

export type EncodeRequest =
  | { type: 'start'; sampleRate: number; kbps: number }
  | {
      type: 'chunk';
      left: ArrayBuffer;
      right: ArrayBuffer;
      /** Sample range of the buffers to encode (the rest is lead/overlap). */
      start: number;
      end: number;
      last: boolean;
    };

export type EncodeResponse =
  | { type: 'progress'; samples: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string };

/** Post progress only every this many samples — one message per block would flood. */
const PROGRESS_STEP_SAMPLES = 44100 * 5;

// The project compiles against the DOM lib, so `self` is typed as Window;
// narrow to the worker-side postMessage shape instead of pulling in the
// webworker lib for this one file.
const post = (msg: EncodeResponse) =>
  (self as { postMessage(m: EncodeResponse): void }).postMessage(msg);

let encoder: Mp3Encoder | null = null;
const chunks: Uint8Array[] = [];
const leftBlock = new Int16Array(MP3_BLOCK_SAMPLES);
const rightBlock = new Int16Array(MP3_BLOCK_SAMPLES);
let encodedSamples = 0;
let lastReported = 0;
// lamejs wants whole frames; carry the remainder of one chunk into the next
// so frame boundaries never coincide with chunk boundaries.
let carryLeft = new Float32Array(0);
let carryRight = new Float32Array(0);

function encodeBlock(n: number): void {
  if (!encoder) throw new Error('encoder not started');
  const frame = encoder.encodeBuffer(
    n === MP3_BLOCK_SAMPLES ? leftBlock : leftBlock.subarray(0, n),
    n === MP3_BLOCK_SAMPLES ? rightBlock : rightBlock.subarray(0, n),
  );
  if (frame.length > 0) chunks.push(frame);
  encodedSamples += n;
  if (encodedSamples - lastReported >= PROGRESS_STEP_SAMPLES) {
    lastReported = encodedSamples;
    post({ type: 'progress', samples: encodedSamples });
  }
}

/**
 * Encode a chunk in place — no concatenation copy of the (hundreds of MB)
 * chunk. The previous chunk's sub-frame remainder is completed with this
 * chunk's first samples; the new remainder is kept for the next one.
 */
function encodeFrames(left: Float32Array, right: Float32Array, flushAll: boolean): void {
  let offset = 0;
  if (carryLeft.length > 0) {
    const need = Math.min(MP3_BLOCK_SAMPLES - carryLeft.length, left.length);
    const joinedL = new Float32Array(carryLeft.length + need);
    const joinedR = new Float32Array(carryRight.length + need);
    joinedL.set(carryLeft, 0);
    joinedL.set(left.subarray(0, need), carryLeft.length);
    joinedR.set(carryRight, 0);
    joinedR.set(right.subarray(0, need), carryRight.length);
    offset = need;
    if (joinedL.length === MP3_BLOCK_SAMPLES || flushAll) {
      const n = floatToInt16Block(joinedL, 0, leftBlock);
      floatToInt16Block(joinedR, 0, rightBlock);
      encodeBlock(n);
      carryLeft = new Float32Array(0);
      carryRight = new Float32Array(0);
    } else {
      carryLeft = joinedL;
      carryRight = joinedR;
      return;
    }
  }
  const remaining = left.length - offset;
  const whole = offset + (flushAll ? remaining : remaining - (remaining % MP3_BLOCK_SAMPLES));
  for (; offset < whole; offset += MP3_BLOCK_SAMPLES) {
    const n = floatToInt16Block(left, offset, leftBlock);
    floatToInt16Block(right, offset, rightBlock);
    encodeBlock(n);
  }
  carryLeft = left.slice(whole);
  carryRight = right.slice(whole);
}

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'start') {
      encoder = new Mp3Encoder(2, msg.sampleRate, msg.kbps);
      chunks.length = 0;
      encodedSamples = 0;
      lastReported = 0;
      carryLeft = new Float32Array(0);
      carryRight = new Float32Array(0);
      return;
    }
    const left = new Float32Array(msg.left).subarray(msg.start, msg.end);
    const right = new Float32Array(msg.right).subarray(msg.start, msg.end);
    encodeFrames(left, right, msg.last);
    if (msg.last) {
      if (!encoder) throw new Error('encoder not started');
      const tail = encoder.flush();
      if (tail.length > 0) chunks.push(tail);
      post({ type: 'progress', samples: encodedSamples });
      post({ type: 'done', blob: new Blob(chunks as BlobPart[], { type: 'audio/mpeg' }) });
      encoder = null;
      chunks.length = 0;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
