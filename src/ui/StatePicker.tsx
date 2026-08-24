import { STATE_LIST, type MentalState } from '../audio/states';

/** PRD §4 step 1: "What do you want to feel?" — five simple cards. */
export function StatePicker(props: {
  value: MentalState;
  onChange: (state: MentalState) => void;
}) {
  return (
    <div className="state-grid">
      {STATE_LIST.map((state) => (
        <button
          key={state.id}
          type="button"
          className={`state-card${state.id === props.value ? ' selected' : ''}`}
          onClick={() => props.onChange(state.id)}
        >
          <span className="state-emoji">{state.emoji}</span>
          <span className="state-label">{state.label}</span>
        </button>
      ))}
    </div>
  );
}
