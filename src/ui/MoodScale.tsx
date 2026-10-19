import { MOOD_AXES, type MentalState } from '../audio/states';
import type { MoodLevel } from '../storage/types';

const LEVELS: readonly MoodLevel[] = [1, 2, 3, 4, 5];

/**
 * One optional tap on the state's own mood axis (Phase 13) — "Scattered …
 * Sharp" for focus, "Wired … Drowsy" for sleep. Tapping the chosen level
 * again clears it: answering is never required.
 */
export function MoodScale(props: {
  state: MentalState;
  question: string;
  value: MoodLevel | undefined;
  onChange: (value: MoodLevel | undefined) => void;
}) {
  const [low, high] = MOOD_AXES[props.state];
  const labelId = `mood-${props.question.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="option-row mood-scale">
      <span className="hint" id={labelId}>
        {props.question}
      </span>
      <div className="preset-strip" role="group" aria-labelledby={labelId}>
        <span className="mood-anchor">{low}</span>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`chip mood-chip${props.value === level ? ' selected' : ''}`}
            aria-pressed={props.value === level}
            aria-label={`${level} of 5 — ${level <= 2 ? low : level >= 4 ? high : 'in between'}`}
            onClick={() => props.onChange(props.value === level ? undefined : level)}
          >
            {level}
          </button>
        ))}
        <span className="mood-anchor">{high}</span>
      </div>
    </div>
  );
}
