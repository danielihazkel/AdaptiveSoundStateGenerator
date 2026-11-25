// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('./native', () => ({ isNative: () => native.value }));

const fs = vi.hoisted(() => ({
  writes: [] as Array<{ op: string; path: string; data?: string }>,
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    rmdir: vi.fn(async ({ path }: { path: string }) => {
      fs.writes.push({ op: 'rmdir', path });
    }),
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      fs.writes.push({ op: 'write', path, data });
    }),
    appendFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      fs.writes.push({ op: 'append', path, data });
    }),
    getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` })),
  },
}));
const share = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@capacitor/share', () => ({ Share: { share } }));

import { blobToBase64, downloadBlob, downloadJson, NATIVE_CHUNK_BYTES, shareNativeFile } from './download';

function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

afterEach(() => {
  native.value = false;
  fs.writes = [];
  share.mockClear();
});

describe('downloadBlob', () => {
  it('in a browser, clicks a download link', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await downloadBlob(new Blob(['hi']), 'a.txt');
    expect(click).toHaveBeenCalledTimes(1);
    expect(fs.writes).toEqual([]);
    click.mockRestore();
  });

  it('in the app, writes the file in chunks that reassemble exactly, then shares it', async () => {
    const chunk = 3 * 100;
    const size = chunk * 2 + 123;
    const source = new Uint8Array(size);
    for (let i = 0; i < size; i++) source[i] = (i * 31 + 7) & 0xff;

    await shareNativeFile(new Blob([source]), 'resonance-sleep-240min.mp3', chunk);

    expect(fs.writes.map((w) => w.op)).toEqual(['rmdir', 'write', 'append', 'append']);
    const parts = fs.writes.filter((w) => w.data !== undefined).map((w) => bytesOf(w.data!));
    expect(parts.map((p) => p.length)).toEqual([chunk, chunk, 123]);
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      joined.set(p, offset);
      offset += p.length;
    }
    expect(joined).toEqual(source);
    expect(fs.writes[1].path).toBe('exports/resonance-sleep-240min.mp3');
    expect(share).toHaveBeenCalledWith({
      title: 'resonance-sleep-240min.mp3',
      files: ['file:///cache/exports/resonance-sleep-240min.mp3'],
    });
  });

  it('in the app, a small JSON file is one write', async () => {
    native.value = true;
    await downloadJson({ v: 1 }, 'x.resonance.json');
    expect(fs.writes.map((w) => w.op)).toEqual(['rmdir', 'write']);
    expect(new TextDecoder().decode(bytesOf(fs.writes[1].data!))).toContain('"v": 1');
  });

  it('a cancelled share sheet is not an error', async () => {
    native.value = true;
    share.mockRejectedValueOnce(new Error('Share canceled'));
    await expect(downloadJson({}, 'x.json')).resolves.toBeUndefined();
  });
});

it('the real chunk size crosses the bridge unpadded (a multiple of 3 bytes)', () => {
  expect(NATIVE_CHUNK_BYTES % 3).toBe(0);
});

describe('blobToBase64', () => {
  it('strips the data: URL prefix', async () => {
    expect(await blobToBase64(new Blob(['hello']))).toBe(btoa('hello'));
  });
});
