import { useRef, useState } from 'react';
import {
  buildExportBundle,
  importBundle,
  validateBundle,
  type ExportBundle,
} from '../storage/transfer';

/** Give the browser time to start the download before the URL is revoked. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Manual export/import of all local data (PRD §14 — accounts deferred).
 * Collapsed by default at the bottom of the setup screen. Importing is a
 * two-step confirm: the file is parsed and validated first, then merged only
 * once the user has seen what it contains.
 */
export function DataPanel(props: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<{ bundle: ExportBundle; fileName: string } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const bundle = buildExportBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `resonance-export-${bundle.exportedAt.slice(0, 10)}.json`;
    anchor.click();
    // Revoking synchronously races the download on some browsers — same
    // defence as the MP3 export (exportSession.ts).
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    setMessage('Exported your sessions, presets, programs, and settings.');
  };

  const handleImportFile = async (file: File) => {
    setPending(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setMessage('That file is not valid JSON.');
      return;
    }
    const result = validateBundle(raw);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(null);
    setPending({ bundle: result.bundle, fileName: file.name });
  };

  const confirmImport = () => {
    if (!pending) return;
    const { bundle } = pending;
    setPending(null);
    try {
      const summary = importBundle(bundle);
      setMessage(
        `Imported ${summary.sessionsAdded} new sessions, ${summary.presetsAdded} new presets, and ${summary.programsAdded} new programs.`,
      );
    } catch (err) {
      console.error('Import failed', err);
      setMessage(
        'The import failed part-way. Data already on this device is intact — try exporting from the other device again.',
      );
    }
    // Even a failed import may have written some lists — refresh either way.
    props.onImported();
  };

  return (
    <div className="data-panel">
      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={open}
        aria-controls="data-panel-body"
        onClick={() => setOpen(!open)}
      >
        {open ? '▾' : '▸'} Your data
      </button>
      {open && (
        <div className="data-panel-body" id="data-panel-body">
          <p className="hint">
            Everything stays on this device. Export a file to move your history
            and learned profile to another device, then import it there.
          </p>
          <div className="data-panel-actions">
            <button type="button" className="chip" onClick={handleExport}>
              Export data
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => fileInputRef.current?.click()}
            >
              Import data
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = '';
              }}
            />
          </div>
          {pending && (
            <div className="notice import-confirm" role="group" aria-label="Confirm import">
              <span>
                Merge up to {pending.bundle.sessions.length} sessions,{' '}
                {pending.bundle.presets.length} presets, and{' '}
                {pending.bundle.programs?.length ?? 0} programs from “{pending.fileName}”
                into this device? Existing data is kept; duplicates are skipped.
              </span>
              <div className="data-panel-actions">
                <button type="button" className="chip selected" onClick={confirmImport}>
                  Import
                </button>
                <button type="button" className="chip" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {/* Always mounted so screen readers announce the text change. */}
          <p className="hint" role="status" aria-live="polite">
            {message ?? ''}
          </p>
        </div>
      )}
    </div>
  );
}
