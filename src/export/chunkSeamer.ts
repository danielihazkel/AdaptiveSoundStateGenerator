import { mixOverlap } from './crossfade';
import type { RenderChunk } from './renderTimeline';

/**
 * Joins rendered chunks into one continuous signal: each chunk after the
 * first drops the settle part of its lead, and the remaining overlap is
 * equal-power crossfaded with the previous chunk's held-back tail. Shared by
 * the export (which streams each joined range to the encoder) and the audio
 * QA hooks (which keep it in memory), so both hear the same seams.
 */
export class ChunkSeamer {
  /** The previous chunk's final crossfade window, held back for the seam. */
  private tail: { left: Float32Array; right: Float32Array } | null = null;

  constructor(
    private readonly crossfadeSamples: number,
    private readonly sampleRate: number,
  ) {}

  /**
   * Crossfades the buffer's head into the held tail (in place) and returns
   * the sample range [start, end) of this chunk that belongs to the output.
   */
  seam(buffer: AudioBuffer, chunk: RenderChunk): { start: number; end: number } {
    const crossN = this.crossfadeSamples;
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    // Discard the settle part of the lead; the remainder is the overlap
    // region that gets crossfaded with the previous chunk's tail.
    const start = chunk.leadSec > 0 ? Math.round(chunk.leadSec * this.sampleRate) - crossN : 0;
    if (this.tail) {
      mixOverlap(this.tail.left, left.subarray(start, start + crossN));
      mixOverlap(this.tail.right, right.subarray(start, start + crossN));
    }
    const end = chunk.last ? left.length : left.length - crossN;
    this.tail = chunk.last ? null : { left: left.slice(end), right: right.slice(end) };
    return { start, end };
  }
}
