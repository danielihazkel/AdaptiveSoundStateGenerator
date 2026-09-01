import type { Mp3Exporter } from '../export/useMp3Export';
import { EXPORT_BITRATES, type ExportOptions } from '../export/options';
import { useRadioGroup } from './useRadioGroup';

type FormatChoice = `mp3-${number}` | 'wav';

const choiceOf = (o: ExportOptions): FormatChoice => (o.format === 'wav' ? 'wav' : `mp3-${o.kbps}`);
const optionsOf = (choice: FormatChoice, current: ExportOptions): ExportOptions =>
  choice === 'wav'
    ? { format: 'wav', kbps: current.kbps }
    : { format: 'mp3', kbps: Number(choice.slice(4)) };
const FORMAT_CHOICES: FormatChoice[] = [...EXPORT_BITRATES.map((k): FormatChoice => `mp3-${k}`), 'wav'];

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
  const { progress, message, options } = props.exporter;
  const pct = progress ? Math.round(progress.fraction * 100) : 0;
  const formatGroup = useRadioGroup<FormatChoice>({
    items: FORMAT_CHOICES,
    value: choiceOf(options),
    onChange: (choice) => props.exporter.setOptions(optionsOf(choice, options)),
    getKey: (c) => c,
  });
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
      {!progress && (
        <div className="export-format" {...formatGroup.groupProps} aria-label="Download format">
          {FORMAT_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`chip chip-small${choiceOf(options) === choice ? ' selected' : ''}`}
              {...formatGroup.itemProps(choice)}
              onClick={() => props.exporter.setOptions(optionsOf(choice, options))}
            >
              {choice === 'wav' ? 'WAV' : `MP3 ${choice.slice(4)}`}
            </button>
          ))}
        </div>
      )}
      {/* Always mounted so the outcome is announced when it arrives. */}
      {!props.hideMessage && (
        <p className="hint" role="status" aria-live="polite">
          {message ?? ''}
        </p>
      )}
    </>
  );
}
