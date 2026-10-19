import { useState } from 'react';
import { ROUTINE_TEMPLATES, routineFromTemplate } from '../routines/templates';
import { describeRoutine, routineMinutes, type Routine } from '../routines/types';
import { formatDuration } from './format';
import { ShareButton } from './ShareButton';

/**
 * Routines on the setup screen (Phase 14): the built-in templates and the
 * user's own, each a chip; the chosen one shows its legs and starts with
 * one tap. Templates play as they are; editing one saves a copy.
 */
export function RoutinesPanel(props: {
  routines: Routine[];
  starting: boolean;
  onStart: (routine: Routine) => void;
  onEdit: (routine: Routine) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const all: Array<{ routine: Routine; builtIn: boolean; description?: string }> = [
    ...props.routines.map((routine) => ({ routine, builtIn: false })),
    ...ROUTINE_TEMPLATES.map((t) => ({
      routine: routineFromTemplate(t),
      builtIn: true,
      description: t.description,
    })),
  ];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = all.find((r) => r.routine.id === selectedId) ?? null;

  return (
    <section className="setup-section routines-panel" aria-labelledby="routines-title">
      <h2 className="setup-question" id="routines-title">
        Routines
      </h2>
      <p className="hint">Several states back to back, each flowing into the next.</p>
      <div className="preset-strip">
        {all.map(({ routine }) => (
          <button
            key={routine.id}
            type="button"
            className={`chip${selectedId === routine.id ? ' selected' : ''}`}
            aria-pressed={selectedId === routine.id}
            onClick={() => setSelectedId(selectedId === routine.id ? null : routine.id)}
          >
            {routine.name}
          </button>
        ))}
        <button type="button" className="chip" onClick={props.onNew}>
          + New routine
        </button>
      </div>

      {selected && (
        <div className="routine-detail">
          <p className="routine-legs">
            {describeRoutine(selected.routine)} min · {formatDuration(routineMinutes(selected.routine) * 60)}
          </p>
          {selected.description && <p className="hint">{selected.description}</p>}
          <div className="transport">
            <button
              type="button"
              className="play-button"
              disabled={props.starting}
              onClick={() => props.onStart(selected.routine)}
            >
              {props.starting ? 'Starting…' : `► Start ${selected.routine.name}`}
            </button>
          </div>
          <div className="preset-strip">
            <button type="button" className="chip" onClick={() => props.onEdit(selected.routine)}>
              {selected.builtIn ? 'Customize…' : 'Edit'}
            </button>
            <ShareButton
              getPayload={() => ({ v: 1, kind: 'routine', routine: selected.routine })}
              ariaLabel={`Share ${selected.routine.name}`}
            />
            {!selected.builtIn && (
              <button
                type="button"
                className="chip"
                onClick={() => {
                  props.onDelete(selected.routine.id);
                  setSelectedId(null);
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
