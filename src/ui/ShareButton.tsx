import { useState } from 'react';
import { buildShareUrl, type SharePayload } from '../share/shareLink';

/**
 * "Share" chip: builds a share link for the payload and copies it to the
 * clipboard. When the clipboard is unavailable (or refuses — Safari after an
 * await), the link is shown in a selectable field instead.
 */
export function ShareButton(props: {
  getPayload: () => SharePayload;
  label?: string;
  ariaLabel?: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const share = async () => {
    setStatus(null);
    setFallbackUrl(null);
    let url: string;
    try {
      url = await buildShareUrl(
        props.getPayload(),
        `${window.location.origin}${window.location.pathname}`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not build a share link.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied — anyone who opens it can import this.');
    } catch {
      setFallbackUrl(url);
      setStatus('Copy this link:');
    }
  };

  return (
    <span className="share-row">
      <button
        type="button"
        className="chip"
        aria-label={props.ariaLabel}
        onClick={() => void share()}
      >
        {props.label ?? '⇪ Share'}
      </button>
      <span className="hint" role="status" aria-live="polite">
        {status ?? ''}
      </span>
      {fallbackUrl && (
        <input
          type="text"
          readOnly
          value={fallbackUrl}
          aria-label="Share link"
          onFocus={(e) => e.target.select()}
        />
      )}
    </span>
  );
}
