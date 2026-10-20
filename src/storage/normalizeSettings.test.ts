import { describe, expect, it } from 'vitest';
import { normalizeSettings } from './normalizeSettings';
import { defaultSettings } from './types';

describe('normalizeSettings', () => {
  it('returns the defaults for garbage', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings);
    expect(normalizeSettings('x')).toEqual(defaultSettings);
    expect(normalizeSettings([])).toEqual(defaultSettings);
  });

  it('keeps every valid field', () => {
    const full = {
      ...defaultSettings,
      disclaimerAcknowledgedAt: '2026-01-01T00:00:00.000Z',
      monoMode: true,
      chimeEnabled: false,
      adaptationEnabled: false,
      biometricsConsentAt: '2026-01-02T00:00:00.000Z',
      personalizationMode: { focus: 'locked' as const, sleep: 'explore' as const },
      breathingPattern: 'box' as const,
      wakeUp: { enabled: true, riseMinutes: 12 },
      sleepOnsetFade: true,
      theme: 'light' as const,
      onboardingCompletedAt: null,
      export: { format: 'wav' as const, kbps: 192 },
      nightstand: 'never' as const,
      visualizer: false,
      explainSound: false,
    };
    expect(normalizeSettings(full)).toEqual(full);
  });

  it('drops or repairs damaged fields one by one', () => {
    const out = normalizeSettings({
      disclaimerAcknowledgedAt: 42,
      monoMode: 'yes',
      personalizationMode: { focus: 'sometimes', relax: 'locked' },
      breathingPattern: 'square',
      wakeUp: { enabled: true, riseMinutes: 999 },
      theme: 'neon',
      nightstand: 'bedside',
      export: { format: 'flac' },
    });
    expect(out.disclaimerAcknowledgedAt).toBeNull();
    expect(out.monoMode).toBe(false);
    expect(out.personalizationMode).toEqual({ relax: 'locked' });
    expect(out.breathingPattern).toBeUndefined();
    expect(out.wakeUp).toEqual({ enabled: true, riseMinutes: 30 });
    expect(out.theme).toBeUndefined();
    expect(out.nightstand).toBeUndefined();
    expect(out.export).toEqual({ format: 'mp3', kbps: 192 });
  });

  it('leaves optional fields absent when they were never set', () => {
    const out = normalizeSettings({ monoMode: true });
    expect('theme' in out).toBe(false);
    expect('wakeUp' in out).toBe(false);
    expect('export' in out).toBe(false);
  });
});
