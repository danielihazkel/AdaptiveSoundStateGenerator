import { STATE_LIST, type MentalState } from '../audio/states';
import { useRadioGroup } from './useRadioGroup';

const STATE_IDS = STATE_LIST.map((s) => s.id);

/** PRD §4 step 1: "What do you want to feel?" — simple cards, one selected. */
export function StatePicker(props: {
  value: MentalState;
  onChange: (state: MentalState) => void;
}) {
  const radio = useRadioGroup<MentalState>({
    items: STATE_IDS,
    value: props.value,
    onChange: props.onChange,
    getKey: (id) => id,
  });
  return (
    <div className="state-grid" {...radio.groupProps} aria-label="What do you want to feel?">
      {STATE_LIST.map((state) => (
        <button
          key={state.id}
          type="button"
          className={`state-card${state.id === props.value ? ' selected' : ''}`}
          {...radio.itemProps(state.id)}
          onClick={() => props.onChange(state.id)}
        >
          <span className="state-emoji" aria-hidden="true">
            {state.emoji}
          </span>
          <span className="state-label">{state.label}</span>
        </button>
      ))}
    </div>
  );
}
