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
  return (
    <>
      <div className="download-row">
        {progress ? (
          <>
            <span className="hint download-progress">
              {progress.phase === 'rendering' ? 'Rendering' : 'Encoding'}…{' '}
              {Math.round(progress.fraction * 100)}%
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
      {!props.hideMessage && message && <p className="hint">{message}</p>}
    </>
  );
}
