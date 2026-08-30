import { afterEach, describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { defaultProgram, normalizeProgram } from '../programs/types';
import { PROGRAM_TEMPLATES } from '../programs/templates';
import {
  buildShareUrl,
  decodeShare,
  encodeShare,
  MAX_SHARE_URL_LENGTH,
  readShareHash,
  ShareError,
  validateSharePayload,
  type SharePayload,
} from './shareLink';

const g = globalThis as { CompressionStream?: unknown; DecompressionStream?: unknown };
const saved = { c: g.CompressionStream, d: g.DecompressionStream };

afterEach(() => {
  g.CompressionStream = saved.c;
  g.DecompressionStream = saved.d;
});

const programPayload = (): SharePayload => ({
  v: 1,
  kind: 'program',
  program: defaultProgram('focus', 0.5),
});

const presetPayload = (): SharePayload => ({
  v: 1,
  kind: 'preset',
  preset: { name: 'Evening focus', state: 'focus', intensity: 0.4, profile: STATES.focus.buildProfile(0.4) },
});

describe('encodeShare / decodeShare', () => {
  it('round-trips a program through a compressed token', async () => {
    const payload = programPayload();
    const token = await encodeShare(payload);
    expect(token.startsWith('z.')).toBe(true);
    expect(await decodeShare(token)).toEqual(payload);
  });

  it('round-trips a preset', async () => {
    const payload = presetPayload();
    expect(await decodeShare(await encodeShare(payload))).toEqual(payload);
  });

  it('falls back to plain JSON without CompressionStream', async () => {
    delete g.CompressionStream;
    const payload = presetPayload();
    const token = await encodeShare(payload);
    expect(token.startsWith('j.')).toBe(true);
    expect(await decodeShare(token)).toEqual(payload);
  });

  it('reports compressed links as unsupported without DecompressionStream', async () => {
    const token = await encodeShare(presetPayload());
    delete g.DecompressionStream;
    await expect(decodeShare(token)).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('rejects damaged tokens', async () => {
    await expect(decodeShare('nonsense')).rejects.toBeInstanceOf(ShareError);
    await expect(decodeShare('x.abc')).rejects.toMatchObject({ reason: 'malformed' });
    await expect(decodeShare('j.!!!')).rejects.toMatchObject({ reason: 'malformed' });
    const token = await encodeShare(presetPayload());
    await expect(decodeShare(token.slice(0, 20))).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('is unicode-safe', async () => {
    const payload = presetPayload();
    if (payload.kind === 'preset') payload.preset.name = 'Café — 深い集中 ✨';
    expect(await decodeShare(await encodeShare(payload))).toEqual(payload);
  });
});

describe('validateSharePayload', () => {
  it('accepts and normalizes a program', () => {
    const raw = { v: 1, kind: 'program', program: { name: '  Deep  ', segments: [{ startMin: 0 }] } };
    const result = validateSharePayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.kind === 'program') {
      expect(result.payload.program.name).toBe('Deep');
      expect(result.payload.program).toEqual(normalizeProgram(result.payload.program));
    }
  });

  it('accepts a preset and clamps its fields', () => {
    const raw = {
      v: 1,
      kind: 'preset',
      preset: { name: 'x'.repeat(200), state: 'relax', intensity: 7, profile: {} },
    };
    const result = validateSharePayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.kind === 'preset') {
      expect(result.payload.preset.name.length).toBe(60);
      expect(result.payload.preset.intensity).toBe(1);
      expect(result.payload.preset.profile.masterVolume).toBeGreaterThan(0);
    }
  });

  it('rejects the wrong shapes', () => {
    expect(validateSharePayload(null).ok).toBe(false);
    expect(validateSharePayload({ v: 2, kind: 'program' }).ok).toBe(false);
    expect(validateSharePayload({ v: 1, kind: 'thing' }).ok).toBe(false);
    expect(validateSharePayload({ v: 1, kind: 'program', program: 'nope' }).ok).toBe(false);
    expect(validateSharePayload({ v: 1, kind: 'preset', preset: { state: 'nope', profile: {} } }).ok).toBe(false);
  });
});

describe('readShareHash / buildShareUrl', () => {
  it('parses the hash', () => {
    expect(readShareHash('#share=z.abc')).toBe('z.abc');
    expect(readShareHash('share=j.xyz&other=1')).toBe('j.xyz');
    expect(readShareHash('#lab')).toBeNull();
    expect(readShareHash('')).toBeNull();
  });

  it('builds a URL that decodes back, for every template', async () => {
    for (const template of PROGRAM_TEMPLATES) {
      const payload: SharePayload = { v: 1, kind: 'program', program: template.build('focus', 0.5) };
      const url = await buildShareUrl(payload, 'https://example.test/app/');
      expect(url.length).toBeLessThan(MAX_SHARE_URL_LENGTH);
      const token = readShareHash(new URL(url).hash);
      expect(token).not.toBeNull();
      const result = validateSharePayload(await decodeShare(token!));
      expect(result.ok).toBe(true);
    }
  });

  it('refuses a link that would be too long', async () => {
    const program = defaultProgram('focus', 0.5);
    program.segments[0].description = 'x'.repeat(20_000);
    delete g.CompressionStream;
    await expect(
      buildShareUrl({ v: 1, kind: 'program', program }, 'https://example.test/'),
    ).rejects.toMatchObject({ reason: 'too-long' });
  });
});
