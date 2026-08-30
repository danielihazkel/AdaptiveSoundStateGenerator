import { useEffect, useState } from 'react';
import { MAX_CUSTOM_MINUTES, MIN_CUSTOM_MINUTES } from '../session/durationLimits';
import { formatMinutes, minutesUntil } from '../session/wallClock';
import { useRadioGroup } from './useRadioGroup';

export { MAX_CUSTOM_MINUTES, MIN_CUSTOM_MINUTES };

const PRESET_MINUTES = [15, 30, 45, 60, 90];
type Choice = number | 'custom' | 'endAt';
const CHOICES: Choice[] = [...PRESET_MINUTES, 'custom', 'endAt'];

/** Default "end at" — the next full hour, at least a few minutes away. */
function defaultEndAt(now = new Date()): string {
  const t = new Date(now.getTime() + 60 * 60_000);
  t.setMinutes(0, 0, 0);
  return `${String(t.getHours()).padStart(2, '0')}:00`;
}

/**
 * PRD §4 step 3: 15/30/45/60/90 min, custom, or "end at HH:MM" (a nap or a
 * night's sleep that must finish at a wall-clock time; the minutes are
 * resolved when the session starts).
 */
export function DurationPicker(props: {
  minutes: number;
  onChange: (minutes: number) => void;
  /** "End at" time (HH:MM) when that mode is active, else null. */
  endAt: string | null;
  onEndAtChange: (endAt: string | null) => void;
}) {
  const [custom, setCustom] = useState(!PRESET_MINUTES.includes(props.minutes));
  const choice: Choice =
    props.endAt !== null ? 'endAt' : custom ? 'custom' : props.minutes;
  // The "ends in" readout must track the clock while the picker sits open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (props.endAt === null) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    setNow(new Date());
    return () => clearInterval(id);
  }, [props.endAt]);

  const select = (next: Choice) => {
    if (next === 'endAt') {
      props.onEndAtChange(props.endAt ?? defaultEndAt());
      return;
    }
    props.onEndAtChange(null);
    if (next === 'custom') {
      setCustom(true);
    } else {
      setCustom(false);
      props.onChange(next);
    }
  };
  const radio = useRadioGroup<Choice>({
    items: CHOICES,
    value: choice,
    onChange: select,
    getKey: String,
  });
  const resolved = props.endAt !== null ? minutesUntil(props.endAt, now) : null;

  return (
    <div className="duration-row" {...radio.groupProps} aria-label="For how long?">
      {PRESET_MINUTES.map((m) => (
        <button
          key={m}
          type="button"
          className={`chip${choice === m ? ' selected' : ''}`}
          {...radio.itemProps(m)}
          onClick={() => select(m)}
        >
          {m} min
        </button>
      ))}
      <button
        type="button"
        className={`chip${choice === 'custom' ? ' selected' : ''}`}
        {...radio.itemProps('custom')}
        onClick={() => select('custom')}
      >
        Custom
      </button>
      <button
        type="button"
        className={`chip${choice === 'endAt' ? ' selected' : ''}`}
        {...radio.itemProps('endAt')}
        onClick={() => select('endAt')}
      >
        End at…
      </button>
      {choice === 'custom' && (
        <label className="custom-minutes">
          <input
            type="number"
            min={MIN_CUSTOM_MINUTES}
            max={MAX_CUSTOM_MINUTES}
            value={props.minutes}
            aria-label="Session length in minutes"
            onChange={(e) => {
              const raw = Number(e.target.value);
              if (Number.isFinite(raw)) {
                props.onChange(
                  Math.min(MAX_CUSTOM_MINUTES, Math.max(MIN_CUSTOM_MINUTES, Math.round(raw))),
                );
              }
            }}
          />
          min
        </label>
      )}
      {choice === 'endAt' && (
        <label className="custom-minutes">
          <input
            type="time"
            value={props.endAt ?? ''}
            aria-label="End the session at"
            onChange={(e) => {
              if (e.target.value) props.onEndAtChange(e.target.value);
            }}
          />
          <span className="hint">
            {resolved !== null ? `· ${formatMinutes(resolved)} from now` : '· pick a time'}
          </span>
        </label>
      )}
    </div>
  );
}
