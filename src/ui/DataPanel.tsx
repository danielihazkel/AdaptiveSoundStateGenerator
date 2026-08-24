import { useRef, useState } from 'react';
import {
  buildExportBundle,
  importBundle,
  validateBundle,
} from '../storage/transfer';

/**
 * Manual export/import of all local data (PRD §14 — accounts deferred).
 * Collapsed by default at the bottom of the setup screen.
 */
export function DataPanel(props: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    URL.revokeObjectURL(url);
    setMessage('Exported your sessions, presets, and settings.');
  };

  const handleImportFile = async (file: File) => {
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
    const summary = importBundle(result.bundle);
    setMessage(
      `Imported ${summary.sessionsAdded} new sessions and ${summary.presetsAdded} new presets.`,
    );
    props.onImported();
  };

  return (
    <div className="data-panel">
      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setOpen(!open)}
      >
        {open ? '▾' : '▸'} Your data
      </button>
      {open && (
        <div className="data-panel-body">
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
          {message && <p className="hint">{message}</p>}
        </div>
      )}
    </div>
  );
}
