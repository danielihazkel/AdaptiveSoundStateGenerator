/** Give the browser time to start the download before the URL is revoked. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Hand a Blob to the browser as a download. Revoking the object URL
 * synchronously after click() races the save on some browsers with large
 * blobs, so the URL is kept alive for a minute.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}
