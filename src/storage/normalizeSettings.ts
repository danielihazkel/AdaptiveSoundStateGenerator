import { isBreathingPatternId } from '../audio/breathing';
import { normalizeExportOptions } from '../export/options';
import {
  defaultSettings,
  MAX_WAKE_RISE_MINUTES,
  MIN_WAKE_RISE_MINUTES,
  NIGHTSTAND_MODES,
  THEMES,
  type NightstandMode,
  type PersonalizationMode,
  type Settings,
  type Theme,
} from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Settings as stored, made safe to read: every field is type-checked and a
 * damaged one falls back on its own (absent where absence is the default),
 * instead of a wrong-typed value reaching the UI. Optional fields stay
 * optional — read sites keep their `??` defaults, so "never set" and
 * "set to the default" remain distinguishable where that matters.
 */
export function normalizeSettings(raw: unknown): Settings {
  const p = isRecord(raw) ? raw : {};
  const out: Settings = {
    ...defaultSettings,
    disclaimerAcknowledgedAt: isoOrNull(p.disclaimerAcknowledgedAt),
    monoMode: typeof p.monoMode === 'boolean' ? p.monoMode : defaultSettings.monoMode,
    chimeEnabled:
      typeof p.chimeEnabled === 'boolean' ? p.chimeEnabled : defaultSettings.chimeEnabled,
    adaptationEnabled:
      typeof p.adaptationEnabled === 'boolean' ? p.adaptationEnabled : defaultSettings.adaptationEnabled,
    biometricsConsentAt: isoOrNull(p.biometricsConsentAt),
    personalizationMode: {},
  };
  if (isRecord(p.personalizationMode)) {
    for (const [state, mode] of Object.entries(p.personalizationMode)) {
      if (mode === 'explore' || mode === 'locked') {
        (out.personalizationMode as Record<string, PersonalizationMode>)[state] = mode;
      }
    }
  }
  if (p.motionConsentAt !== undefined) out.motionConsentAt = isoOrNull(p.motionConsentAt);
  if (isBreathingPatternId(p.breathingPattern)) out.breathingPattern = p.breathingPattern;
  if (isRecord(p.wakeUp) && typeof p.wakeUp.enabled === 'boolean') {
    const minutes = Number(p.wakeUp.riseMinutes);
    out.wakeUp = {
      enabled: p.wakeUp.enabled,
      riseMinutes: Number.isFinite(minutes)
        ? Math.min(MAX_WAKE_RISE_MINUTES, Math.max(MIN_WAKE_RISE_MINUTES, Math.round(minutes)))
        : 10,
    };
  }
  if (typeof p.sleepOnsetFade === 'boolean') out.sleepOnsetFade = p.sleepOnsetFade;
  if (THEMES.includes(p.theme as Theme)) out.theme = p.theme as Theme;
  if (typeof p.onboardingCompletedAt === 'string' || p.onboardingCompletedAt === null) {
    out.onboardingCompletedAt = p.onboardingCompletedAt;
  }
  if (p.export !== undefined) out.export = normalizeExportOptions(p.export);
  if (typeof p.visualizer === 'boolean') out.visualizer = p.visualizer;
  if (typeof p.explainSound === 'boolean') out.explainSound = p.explainSound;
  if (NIGHTSTAND_MODES.includes(p.nightstand as NightstandMode)) {
    out.nightstand = p.nightstand as NightstandMode;
  }
  return out;
}
