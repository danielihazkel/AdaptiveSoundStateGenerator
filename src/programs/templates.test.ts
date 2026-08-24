import { describe, expect, it } from 'vitest';
import { normalizeProfile } from '../audio/types';
import { CONTEXT_TEMPLATE_IDS, PROGRAM_TEMPLATES } from './templates';
import { normalizeProgram } from './types';

const contexts = PROGRAM_TEMPLATES.filter((t) => CONTEXT_TEMPLATE_IDS.includes(t.id));

describe('PROGRAM_TEMPLATES', () => {
  it('includes blank, buildArc, and all six contexts', () => {
    expect(PROGRAM_TEMPLATES.map((t) => t.id)).toEqual([
      'blank',
      'buildArc',
      'intimate',
      'romantic',
      'sensual',
      'playful',
      'fantasy',
      'passionate',
    ]);
  });

  it('every template builds a program normalizeProgram leaves untouched', () => {
    for (const template of PROGRAM_TEMPLATES) {
      for (const intensity of [0, 0.5, 1]) {
        const program = template.build('focus', intensity);
        // Identity through the normalizer proves every value is in range and
        // the segments are contiguous from 0 with only the last open-ended.
        expect(normalizeProgram(program)).toEqual(program);
        expect(normalizeProfile(program.baseProfile)).toEqual(program.baseProfile);
        expect(program.segments[0].startMin).toBe(0);
        expect(program.segments[program.segments.length - 1].endMin).toBeNull();
      }
    }
  });

  it('blank and buildArc respect the caller-picked state', () => {
    expect(PROGRAM_TEMPLATES[0].build('sleep', 0.5).baseState).toBe('sleep');
    expect(PROGRAM_TEMPLATES[1].build('energy', 0.5).baseState).toBe('energy');
  });

  it('contexts curate their own base state and sound', () => {
    for (const template of contexts) {
      const program = template.build('energy', 0.5); // passed state ignored
      expect(['relax', 'meditation']).toContain(program.baseState);
      expect(program.baseProfile.harmony.enabled).toBe(true);
      expect(program.baseProfile.bass).toBeGreaterThan(0);
      expect(program.baseProfile.tone.enabled).toBe(false);
      expect(program.baseProfile.isochronic.enabled).toBe(true);
      // Every phase sets warmth so crossfades never hit the one-sided path.
      for (const segment of program.segments) {
        expect(segment.warmth).toBeDefined();
        expect(segment.harmonyScale).toBeDefined();
        expect(segment.bassScale).toBeDefined();
      }
    }
  });

  it('intimate implements the 4-phase arc with the specified BPM bands', () => {
    const program = contexts.find((t) => t.id === 'intimate')!.build('focus', 0.5);
    expect(program.segments.map((s) => s.bpmRange)).toEqual([
      [75, 80],
      [82, 88],
      [88, 94],
      [92, 96],
      [80, 88], // afterglow
    ]);
    expect(program.segments.map((s) => [s.startMin, s.endMin])).toEqual([
      [0, 5],
      [5, 12],
      [12, 20],
      [20, 30],
      [30, null],
    ]);
    // Peak: highest complexity of the arc, raised bass, maximum ambience.
    const peak = program.segments[3];
    expect(peak.complexity).toBe(Math.max(...program.segments.map((s) => s.complexity)));
    expect(peak.bassScale!).toBeGreaterThan(1);
    expect(peak.ambienceScale!).toBe(
      Math.max(...program.segments.map((s) => s.ambienceScale!)),
    );
  });

  it('passionate peaks at 98–105 BPM with the highest complexity and strong bass', () => {
    const program = contexts.find((t) => t.id === 'passionate')!.build('focus', 0.5);
    const fever = program.segments[2];
    expect(fever.bpmRange).toEqual([98, 105]);
    expect(fever.complexity).toBe(Math.max(...program.segments.map((s) => s.complexity)));
    expect(fever.bassScale!).toBeGreaterThan(1);
    // Ambience sits lower than intimate's — rhythm carries the energy.
    expect(program.baseProfile.ambience.level).toBeLessThan(0.2);
  });

  it('scales phase intensity with the requested intensity', () => {
    const template = contexts.find((t) => t.id === 'intimate')!;
    const low = template.build('focus', 0);
    const high = template.build('focus', 1);
    for (let i = 0; i < low.segments.length; i++) {
      expect(high.segments[i].intensity).toBeGreaterThan(low.segments[i].intensity);
    }
  });
});
