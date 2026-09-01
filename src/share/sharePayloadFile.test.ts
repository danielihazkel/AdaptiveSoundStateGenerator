import { describe, expect, it } from 'vitest';
import { STATES } from '../audio/states';
import { defaultProgram } from '../programs/types';
import type { SharePayload } from './shareLink';
import { describeSharePayload, isSharePayloadFile, sharePayloadFilename } from './sharePayloadFile';

const program: SharePayload = { v: 1, kind: 'program', program: { ...defaultProgram('focus', 0.5), name: 'Deep Work!' } };
const preset: SharePayload = {
  v: 1,
  kind: 'preset',
  preset: { name: '★☆★', state: 'sleep', intensity: 0.4, profile: STATES.sleep.buildProfile(0.4) },
};

describe('sharePayloadFile', () => {
  it('recognises share payloads and nothing else', () => {
    expect(isSharePayloadFile(program)).toBe(true);
    expect(isSharePayloadFile(preset)).toBe(true);
    expect(isSharePayloadFile({ v: 1, kind: 'session' })).toBe(false);
    expect(isSharePayloadFile({ v: 2, kind: 'program' })).toBe(false);
    // A full data export has no `kind` — it must keep going to the bundle importer.
    expect(isSharePayloadFile({ schemaVersion: 1, exportedAt: 'x', sessions: [], presets: [] })).toBe(false);
    expect(isSharePayloadFile(null)).toBe(false);
    expect(isSharePayloadFile('program')).toBe(false);
  });

  it('names the file after the payload', () => {
    expect(sharePayloadFilename(program)).toBe('resonance-program-deep-work.resonance.json');
    expect(sharePayloadFilename(preset)).toBe('resonance-preset-preset.resonance.json');
  });

  it('describes the payload for the confirmation prompt', () => {
    expect(describeSharePayload(program)).toContain('Deep Work!');
    expect(describeSharePayload(preset)).toContain('sleep');
  });
});
