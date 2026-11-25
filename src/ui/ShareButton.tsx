import { useState } from 'react';
import { downloadJson } from '../platform/download';
import { isNative } from '../platform/native';
import { buildShareUrl, ShareError, type SharePayload } from '../share/shareLink';
import { MAX_QR_URL_LENGTH, sharePayloadFilename } from '../share/sharePayloadFile';
import { QrCode } from './QrCode';

/**
 * "Share" chip: builds a share link for the payload and copies it to the
 * clipboard. When the clipboard is unavailable (or refuses — Safari after an
 * await), the link is shown in a selectable field instead. Short links can
 * also be shown as a QR code; a payload too large for any link can be saved
 * as a file that the Data panel imports.
 *
 * Links point at VITE_SHARE_BASE_URL when set (the hosted app), else at this
 * page. The Android app is served from https://localhost, which no one else
 * can open: there, with no hosted URL configured, Share sends the file
 * through the system share sheet instead, and a link goes out through the
 * sheet too.
 */
function shareBaseUrl(): string | null {
  const configured = import.meta.env.VITE_SHARE_BASE_URL;
  if (configured) return configured;
  return isNative() ? null : `${window.location.origin}${window.location.pathname}`;
}

export function ShareButton(props: {
  getPayload: () => SharePayload;
  label?: string;
  ariaLabel?: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);

  const share = async () => {
    setStatus(null);
    setFallbackUrl(null);
    setUrl(null);
    setShowQr(false);
    setTooLarge(false);
    const base = shareBaseUrl();
    if (base === null) {
      await sendFile('Opening it on a phone with Resonance imports it.');
      return;
    }
    let built: string;
    try {
      built = await buildShareUrl(props.getPayload(), base);
    } catch (err) {
      if (err instanceof ShareError && err.reason === 'too-long') {
        setTooLarge(true);
        setStatus(`${err.message} Save it as a file instead:`);
        return;
      }
      setStatus(err instanceof Error ? err.message : 'Could not build a share link.');
      return;
    }
    setUrl(built);
    if (isNative()) {
      const { Share } = await import('@capacitor/share');
      void Share.share({ url: built }).catch(() => undefined);
      setStatus('Anyone who opens the link can import this.');
      return;
    }
    try {
      await navigator.clipboard.writeText(built);
      setStatus('Link copied — anyone who opens it can import this.');
    } catch {
      setFallbackUrl(built);
      setStatus('Copy this link:');
    }
  };

  const sendFile = async (done: string) => {
    const payload = props.getPayload();
    setTooLarge(false);
    try {
      await downloadJson(payload, sharePayloadFilename(payload));
      setStatus(done);
    } catch {
      setStatus('Could not save the file.');
    }
  };

  const saveFile = () =>
    void sendFile('Saved — import the file from “Your data” on the other device.');

  const qrPossible = url !== null && url.length <= MAX_QR_URL_LENGTH;

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
      {url && (
        <button
          type="button"
          className="chip"
          aria-pressed={showQr}
          disabled={!qrPossible}
          title={qrPossible ? undefined : 'Too long for a QR code — copy the link or save as file'}
          onClick={() => setShowQr((v) => !v)}
        >
          ▦ QR
        </button>
      )}
      {(tooLarge || (url && !qrPossible)) && (
        <button type="button" className="chip" onClick={saveFile}>
          ⤓ Save as file
        </button>
      )}
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
      {showQr && url && qrPossible && (
        <span className="qr-wrap">
          <QrCode value={url} label="Share link as a QR code — scan to open it" />
        </span>
      )}
    </span>
  );
}
