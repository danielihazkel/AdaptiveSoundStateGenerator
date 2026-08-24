import { useState } from 'react';

const PRESET_MINUTES = [15, 30, 45, 60, 90];
export const MIN_CUSTOM_MINUTES = 5;
export const MAX_CUSTOM_MINUTES = 180;

/** PRD §4 step 3: 15/30/45/60/90 min or custom. */
export function DurationPicker(props: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const [custom, setCustom] = useState(!PRESET_MINUTES.includes(props.minutes));

  return (
    <div className="duration-row">
      {PRESET_MINUTES.map((m) => (
        <button
          key={m}
          type="button"
          className={`chip${!custom && props.minutes === m ? ' selected' : ''}`}
          onClick={() => {
            setCustom(false);
            props.onChange(m);
          }}
        >
          {m} min
        </button>
      ))}
      <button
        type="button"
        className={`chip${custom ? ' selected' : ''}`}
        onClick={() => setCustom(true)}
      >
        Custom
      </button>
      {custom && (
        <label className="custom-minutes">
          <input
            type="number"
            min={MIN_CUSTOM_MINUTES}
            max={MAX_CUSTOM_MINUTES}
            value={props.minutes}
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
    </div>
  );
}
