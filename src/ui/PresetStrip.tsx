import { useEffect, useRef, useState } from 'react';
import { sortForDisplay } from '../storage/presetOrder';
import type { Preset } from '../storage/types';

/**
 * The "Your saved sounds" chip strip. Favorites float to the top; the
 * selected chip exposes its tools (pin, rename, reorder) so the strip stays
 * compact for everyone else. Rename is an inline input — never a blocking
 * prompt() dialog.
 */
export function PresetStrip(props: {
  presets: Preset[];
  selectedId: string | undefined;
  onSelect: (preset: Preset | undefined) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const ordered = sortForDisplay(props.presets);

  return (
    <div className="preset-strip">
      {ordered.map((preset, i) => {
        const selected = preset.id === props.selectedId;
        if (renamingId === preset.id) {
          return (
            <RenameChip
              key={preset.id}
              preset={preset}
              onDone={(name) => {
                if (name && name !== preset.name) props.onRename(preset.id, name);
                setRenamingId(null);
              }}
            />
          );
        }
        // Reorder only within the same group — the strip is favorites first.
        const pinned = Boolean(preset.favorite);
        const canMoveUp = i > 0 && Boolean(ordered[i - 1].favorite) === pinned;
        const canMoveDown = i < ordered.length - 1 && Boolean(ordered[i + 1].favorite) === pinned;
        return (
          <span key={preset.id} className={`chip preset-chip${selected ? ' selected' : ''}`}>
            <button
              type="button"
              className="preset-name"
              aria-pressed={selected}
              onClick={() => props.onSelect(selected ? undefined : preset)}
            >
              {pinned && (
                <span className="preset-star" aria-label="Pinned">
                  ★{' '}
                </span>
              )}
              {preset.name}
            </button>
            {selected && (
              <>
                <button
                  type="button"
                  className="preset-tool"
                  aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${preset.name}` : `Pin ${preset.name}`}
                  title={pinned ? 'Unpin' : 'Pin to top'}
                  onClick={() => props.onToggleFavorite(preset.id, !pinned)}
                >
                  {pinned ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  className="preset-tool"
                  aria-label={`Rename ${preset.name}`}
                  title="Rename"
                  onClick={() => setRenamingId(preset.id)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="preset-tool"
                  aria-label={`Move ${preset.name} earlier`}
                  title="Move earlier"
                  disabled={!canMoveUp}
                  onClick={() => props.onMove(preset.id, -1)}
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="preset-tool"
                  aria-label={`Move ${preset.name} later`}
                  title="Move later"
                  disabled={!canMoveDown}
                  onClick={() => props.onMove(preset.id, 1)}
                >
                  ▶
                </button>
              </>
            )}
            <button
              type="button"
              className="preset-delete"
              aria-label={`Delete preset ${preset.name}`}
              onClick={() => props.onDelete(preset.id)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

function RenameChip(props: { preset: Preset; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(props.preset.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const commit = () => props.onDone(name.trim() || null);
  return (
    <span className="chip preset-chip selected preset-rename">
      <input
        ref={inputRef}
        type="text"
        value={name}
        maxLength={40}
        aria-label={`New name for ${props.preset.name}`}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            props.onDone(null);
          }
        }}
      />
      <button type="button" className="preset-tool" aria-label="Save name" onClick={commit}>
        ✓
      </button>
      <button
        type="button"
        className="preset-tool"
        aria-label="Cancel rename"
        onClick={() => props.onDone(null)}
      >
        ✕
      </button>
    </span>
  );
}
