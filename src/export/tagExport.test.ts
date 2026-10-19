import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { defaultProgram } from '../programs/types';
import type { ExportSelection } from './offlineRenderer';
import { exportTags, tagExport } from './tagExport';
import { WAV_HEADER_BYTES, wavHeader, wavInfoChunk } from './wav';

const ascii = (bytes: Uint8Array, offset: number, n: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + n));

function selection(overrides: Partial<ExportSelection> = {}): ExportSelection {
  return {
    profile: STATES.sleep.buildProfile(0.5),
    state: 'sleep',
    durationSec: 45 * 60,
    program: null,
    chimeEnabled: false,
    ...overrides,
  };
}

describe('exportTags', () => {
  it('describes the sound in one line', () => {
    const tags = exportTags(selection(), 'Sleep 45 min');
    expect(tags).toMatchObject({ title: 'Sleep 45 min', artist: 'Resonance', album: 'Sleep', genre: 'Ambient' });
    expect(tags.comment).toMatch(/^45 min · brown noise · [\d.]+ Hz beat/);
    expect(tags.comment).toMatch(/not a medical device/);
  });

  it('names a program', () => {
    const program = defaultProgram('focus', 0.5);
    const tags = exportTags(selection({ state: 'focus', program, profile: program.baseProfile }), program.name);
    expect(tags.comment).toContain(`program “${program.name}”`);
  });
});

describe('wavInfoChunk', () => {
  it('writes NUL-terminated, even-padded UTF-8 subchunks', () => {
    const chunk = wavInfoChunk({ INAM: 'Calm', IART: 'Resonance' });
    const view = new DataView(chunk.buffer);
    expect(ascii(chunk, 0, 4)).toBe('LIST');
    expect(view.getUint32(4, true)).toBe(chunk.length - 8);
    expect(ascii(chunk, 8, 4)).toBe('INFO');
    expect(ascii(chunk, 12, 4)).toBe('INAM');
    expect(view.getUint32(16, true)).toBe(5); // "Calm" + NUL
    expect(ascii(chunk, 20, 4)).toBe('Calm');
    expect(chunk[24]).toBe(0);
    expect(chunk[25]).toBe(0); // pad to even
    expect(ascii(chunk, 26, 4)).toBe('IART');
    expect(chunk.length % 2).toBe(0);
  });
});

describe('tagExport', () => {
  const tags = { title: 'Calm', artist: 'Resonance' };

  it('prepends an ID3 tag to an MP3 and keeps the audio intact', async () => {
    const audio = Uint8Array.of(0xff, 0xfb, 1, 2, 3);
    const out = new Uint8Array(await (await tagExport(new Blob([audio]), 'mp3', tags)).arrayBuffer());
    expect(ascii(out, 0, 3)).toBe('ID3');
    expect([...out.subarray(out.length - audio.length)]).toEqual([...audio]);
  });

  it('appends LIST/INFO to a WAV and grows the RIFF size to match', async () => {
    const pcm = new Uint8Array(400).fill(7);
    const wav = new Blob([wavHeader(44100, 2, pcm.length) as BlobPart, pcm]);
    const out = new Uint8Array(await (await tagExport(wav, 'wav', tags)).arrayBuffer());
    const view = new DataView(out.buffer);
    expect(view.getUint32(4, true)).toBe(out.length - 8); // RIFF size covers everything
    expect(view.getUint32(40, true)).toBe(pcm.length); // data chunk untouched
    expect([...out.subarray(WAV_HEADER_BYTES, WAV_HEADER_BYTES + pcm.length)]).toEqual([...pcm]);
    expect(ascii(out, WAV_HEADER_BYTES + pcm.length, 4)).toBe('LIST');
  });
});
