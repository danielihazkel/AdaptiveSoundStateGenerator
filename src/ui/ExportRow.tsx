import type { Mp3Exporter } from '../export/useMp3Export';

/**
 * Download button that turns into a progress readout with Cancel while an
 * export runs, plus the outcome message. Shared by setup, the program editor
 * and the lab so every entry point behaves the same.
 */
export function ExportRow(props: {
  exporter: Mp3Exporter;
  label: string;
  onDownload: () => void;
  disabled?: boolean;
  /** Hide the outcome message (when the parent shows it elsewhere). */
  hideMessage?: boolean;
}) {
  const { progress, message } = props.exporter;
  const pct = progress ? Math.round(progress.fraction * 100) : 0;
  return (
    <>
      <div className="download-row">
        {progress ? (
          <>
            <span
              className="hint download-progress"
              role="progressbar"
              aria-label={progress.phase === 'rendering' ? 'Rendering' : 'Encoding'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              {progress.phase === 'rendering' ? 'Rendering' : 'Encoding'}… {pct}%
            </span>
            <button type="button" className="link-button" onClick={props.exporter.cancel}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="chip"
            disabled={props.disabled}
            onClick={props.onDownload}
          >
            {props.label}
          </button>
        )}
      </div>
      {/* Always mounted so the outcome is announced when it arrives. */}
      {!props.hideMessage && (
        <p className="hint" role="status" aria-live="polite">
          {message ?? ''}
        </p>
      )}
    </>
  );
}
