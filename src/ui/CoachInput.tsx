import { useState } from 'react';

/**
 * Natural-language entry point (PRD §11): "I'm tired but need to study for
 * two hours". Dumb component — App runs the parser and fills the setup
 * controls; `message` echoes what was understood (or the fallback hint).
 */
export function CoachInput(props: {
  onSubmit: (text: string) => void;
  message: string | null;
}) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) props.onSubmit(trimmed);
  };

  return (
    <section className="setup-section coach-input">
      <h2 className="setup-question">Or just say it</h2>
      <div className="coach-row">
        <input
          type="text"
          value={text}
          placeholder="e.g. I'm tired but need to study for two hours"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button type="button" className="chip" onClick={submit} disabled={!text.trim()}>
          Suggest
        </button>
      </div>
      {props.message && <p className="hint coach-message">{props.message}</p>}
    </section>
  );
}
