import { useState } from 'react';

/** Inline "save this sound" row — avoids blocking browser prompt() dialogs. */
export function PresetSaveRow(props: {
  defaultName: string;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(props.defaultName);
  const [saved, setSaved] = useState(false);

  return (
    <div className="preset-save-row">
      <input
        type="text"
        value={name}
        maxLength={40}
        onChange={(e) => {
          setName(e.target.value);
          setSaved(false);
        }}
      />
      <button
        type="button"
        className="chip"
        disabled={saved || name.trim() === ''}
        onClick={() => {
          props.onSave(name.trim());
          setSaved(true);
        }}
      >
        {saved ? 'Saved ✓' : 'Save as preset'}
      </button>
    </div>
  );
}
