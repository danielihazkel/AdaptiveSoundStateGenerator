import { useRef, useState } from 'react';
import { downloadJson } from '../platform/download';
import { validateSharePayload, type SharePayload } from '../share/shareLink';
import { describeSharePayload, isSharePayloadFile } from '../share/sharePayloadFile';
import {
  buildExportBundle,
  importBundle,
  validateBundle,
  type ExportBundle,
} from '../storage/transfer';

type Pending =
  | { kind: 'bundle'; bundle: ExportBundle; fileName: string }
  | { kind: 'share'; payload: SharePayload; fileName: string };

/**
 * Manual export/import of all local data (PRD §14 — accounts deferred).
 * Collapsed by default at the bottom of the setup screen. Importing is a
 * two-step confirm: the file is parsed and validated first, then merged only
 * once the user has seen what it contains. A share file (one program or
 * sound saved from a Share button) is recognised and imported the same way
 * a share link would be.
 */
export function DataPanel(props: {
  onImported: () => void;
  onImportShare: (payload: SharePayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const bundle = buildExportBundle();
    downloadJson(bundle, `resonance-export-${bundle.exportedAt.slice(0, 10)}.json`);
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
    if (isSharePayloadFile(raw)) {
      const shared = validateSharePayload(raw);
      if (!shared.ok) {
        setMessage(shared.error);
        return;
      }
      setMessage(null);
      setPending({ kind: 'share', payload: shared.payload, fileName: file.name });
      return;
    }
    const result = validateBundle(raw);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(null);
    setPending({ kind: 'bundle', bundle: result.bundle, fileName: file.name });
  };

  const confirmImport = () => {
    if (!pending) return;
    setPending(null);
    if (pending.kind === 'share') {
      props.onImportShare(pending.payload);
      setMessage(
        pending.payload.kind === 'program'
          ? 'Program imported and selected.'
          : 'Sound imported and selected.',
      );
      return;
    }
    const { bundle } = pending;
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
                {pending.kind === 'share'
                  ? `Import ${describeSharePayload(pending.payload)} from “${pending.fileName}”?`
                  : `Merge up to ${pending.bundle.sessions.length} sessions, ${pending.bundle.presets.length} presets, and ${pending.bundle.programs?.length ?? 0} programs from “${pending.fileName}” into this device? Existing data is kept; duplicates are skipped.`}
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
