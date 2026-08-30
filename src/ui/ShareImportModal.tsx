import { STATES } from '../audio/states';
import type { SharePayload } from '../share/shareLink';
import { useDialog } from './useDialog';

/** Offer to import a program or sound that arrived through a share link. */
export function ShareImportModal(props: {
  pending: { payload: SharePayload } | { error: string };
  onImport: (payload: SharePayload) => void;
  onDismiss: () => void;
}) {
  const dialogRef = useDialog<HTMLDivElement>({ onClose: props.onDismiss });
  const { pending } = props;
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        {'error' in pending ? (
          <>
            <h2 id="share-title">Couldn’t open this link</h2>
            <p className="hint">{pending.error}</p>
            <div className="transport">
              <button type="button" className="chip" onClick={props.onDismiss}>
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="share-title">Someone shared a {pending.payload.kind === 'program' ? 'program' : 'sound'}</h2>
            <p className="setup-question">
              {pending.payload.kind === 'program'
                ? `Import “${pending.payload.program.name}” — ${pending.payload.program.segments.length} phases for ${STATES[pending.payload.program.baseState].label}?`
                : `Import “${pending.payload.preset.name}” for ${STATES[pending.payload.preset.state].label}?`}
            </p>
            <p className="hint">It is saved on this device only, alongside your own.</p>
            <div className="transport">
              <button
                type="button"
                className="chip selected"
                onClick={() => props.onImport(pending.payload)}
              >
                Import
              </button>
              <button type="button" className="chip" onClick={props.onDismiss}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
