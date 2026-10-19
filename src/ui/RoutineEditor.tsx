import { useState } from 'react';
import { STATE_LIST, STATES, type MentalState } from '../audio/states';
import {
  MAX_LEG_MINUTES,
  MAX_ROUTINE_LEGS,
  MAX_ROUTINE_NAME_LENGTH,
  MIN_LEG_MINUTES,
  MIN_ROUTINE_LEGS,
  normalizeRoutine,
  routineMinutes,
  type Routine,
  type RoutineLeg,
} from '../routines/types';
import { formatDuration } from './format';
import { Slider } from './Slider';

/**
 * Routine editor (Phase 14, route #routine): a name and 2–5 legs, each a
 * state, a depth and a length, reorderable. Saving normalizes like any
 * import; a built-in template is saved as the user's own copy.
 */
export function RoutineEditor(props: {
  routine: Routine;
  onSave: (routine: Routine) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.routine.name);
  const [legs, setLegs] = useState<RoutineLeg[]>(() => props.routine.legs.map((l) => ({ ...l })));

  const update = (index: number, change: Partial<RoutineLeg>) =>
    setLegs((prev) => prev.map((l, i) => (i === index ? { ...l, ...change } : l)));
  const move = (index: number, by: -1 | 1) =>
    setLegs((prev) => {
      const next = [...prev];
      const [leg] = next.splice(index, 1);
      next.splice(index + by, 0, leg);
      return next;
    });

  const save = () => {
    const builtIn = props.routine.id.startsWith('template:');
    const routine = normalizeRoutine({
      ...props.routine,
      // Customizing a template saves the user's own copy.
      id: builtIn ? `routine-${Date.now().toString(36)}` : props.routine.id,
      createdAt: builtIn ? new Date().toISOString() : props.routine.createdAt,
      name,
      legs,
    });
    if (routine) props.onSave(routine);
  };

  return (
    <div className="routine-editor">
      <h2>{props.routine.id.startsWith('template:') ? 'Customize routine' : 'Edit routine'}</h2>
      <label className="option-row">
        <span className="hint">Name</span>
        <input
          type="text"
          value={name}
          maxLength={MAX_ROUTINE_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <ol className="routine-leg-list">
        {legs.map((leg, i) => (
          <li key={i} className="panel">
            <div className="option-row">
              <label>
                <span className="hint">Part {i + 1}</span>{' '}
                <select
                  value={leg.state}
                  aria-label={`Part ${i + 1} state`}
                  onChange={(e) => update(i, { state: e.target.value as MentalState })}
                >
                  {STATE_LIST.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.emoji} {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="number"
                  min={MIN_LEG_MINUTES}
                  max={MAX_LEG_MINUTES}
                  value={leg.minutes}
                  aria-label={`Part ${i + 1} minutes`}
                  onChange={(e) => update(i, { minutes: Number(e.target.value) || MIN_LEG_MINUTES })}
                />{' '}
                min
              </label>
            </div>
            <Slider
              label="Depth"
              min={0}
              max={1}
              step={0.05}
              value={leg.intensity}
              display={leg.intensity < 0.33 ? STATES[leg.state].intensityLabels[0] : leg.intensity > 0.66 ? STATES[leg.state].intensityLabels[1] : 'Medium'}
              onChange={(v) => update(i, { intensity: v })}
            />
            <div className="preset-strip">
              <button type="button" className="chip" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move part ${i + 1} earlier`}>
                ↑
              </button>
              <button type="button" className="chip" disabled={i === legs.length - 1} onClick={() => move(i, 1)} aria-label={`Move part ${i + 1} later`}>
                ↓
              </button>
              <button
                type="button"
                className="chip"
                disabled={legs.length <= MIN_ROUTINE_LEGS}
                onClick={() => setLegs((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Remove part ${i + 1}`}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>

      {legs.length < MAX_ROUTINE_LEGS && (
        <button
          type="button"
          className="chip"
          onClick={() => setLegs((prev) => [...prev, { state: 'relax', intensity: 0.5, minutes: 10 }])}
        >
          + Add a part
        </button>
      )}
      <p className="hint">Total {formatDuration(routineMinutes({ legs }) * 60)}. Each part flows into the next without a pause.</p>

      <div className="transport">
        <button type="button" className="play-button" onClick={save}>
          Save routine
        </button>
        <button type="button" className="chip" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
