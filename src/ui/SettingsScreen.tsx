import type { ReactNode } from 'react';
import {
  NIGHTSTAND_MODES,
  THEMES,
  type NightstandMode,
  type Settings,
  type Theme,
} from '../storage/types';
import { useRadioGroup } from './useRadioGroup';

const THEME_LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const NIGHTSTAND_LABELS: Record<NightstandMode, string> = {
  sleep: 'Sleep sessions',
  always: 'Every session',
  never: 'Never',
};

/**
 * App-wide preferences, gathered off the setup screen. Choices that depend
 * on the session being set up (breathing pattern, wake-up, chime, the
 * per-state lock, speaker mode) stay next to Begin.
 */
export function SettingsScreen(props: {
  settings: Settings;
  onChange: (change: Partial<Settings>) => void;
  onReplayTour: () => void;
  onBack: () => void;
  /** The heart-rate panel, when a sensor source is possible in this browser. */
  biometrics?: ReactNode;
  /** Export / import of everything on this device. */
  data: ReactNode;
}) {
  const s = props.settings;
  const theme = s.theme ?? 'system';
  const nightstand = s.nightstand ?? 'sleep';
  const themeGroup = useRadioGroup<Theme>({
    items: THEMES,
    value: theme,
    onChange: (t) => props.onChange({ theme: t }),
    getKey: (t) => t,
  });
  const nightstandGroup = useRadioGroup<NightstandMode>({
    items: NIGHTSTAND_MODES,
    value: nightstand,
    onChange: (m) => props.onChange({ nightstand: m }),
    getKey: (m) => m,
  });

  return (
    <div className="settings">
      <h2>Settings</h2>

      <section className="setup-section">
        <h3 className="setup-question">Sessions</h3>
        <label className="mono-toggle adaptation-toggle">
          <input
            type="checkbox"
            checked={s.adaptationEnabled !== false}
            onChange={(e) => props.onChange({ adaptationEnabled: e.target.checked })}
          />
          Adapt mid-session — occasionally check in and adjust the sound
        </label>
        <div className="option-row">
          <span className="hint" id="nightstand-label">
            Dark nightstand screen
          </span>
          <div
            className="preset-strip"
            {...nightstandGroup.groupProps}
            aria-labelledby="nightstand-label"
          >
            {NIGHTSTAND_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip${nightstand === m ? ' selected' : ''}`}
                {...nightstandGroup.itemProps(m)}
                onClick={() => props.onChange({ nightstand: m })}
              >
                {NIGHTSTAND_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <label className="mono-toggle">
          <input
            type="checkbox"
            checked={s.visualizer !== false}
            onChange={(e) => props.onChange({ visualizer: e.target.checked })}
          />
          Show a soft glow that moves with the sound
        </label>
        <p className="hint">
          The screen stays on during a session so the sound keeps playing; after a quiet
          spell it goes black except for a dim clock. Tap to bring the controls back.
        </p>
      </section>

      <section className="setup-section">
        <h3 className="setup-question">Appearance</h3>
        <div className="preset-strip" {...themeGroup.groupProps} aria-label="Appearance">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${theme === t ? ' selected' : ''}`}
              {...themeGroup.itemProps(t)}
              onClick={() => props.onChange({ theme: t })}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </section>

      {props.biometrics}

      {props.data}

      <section className="setup-section">
        <h3 className="setup-question">Help</h3>
        <button type="button" className="chip" onClick={props.onReplayTour}>
          Show the intro tour again
        </button>
      </section>

      <button type="button" className="link-button" onClick={props.onBack}>
        ← Back
      </button>
    </div>
  );
}
