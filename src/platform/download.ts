import { isNative } from './native';

/** Give the browser time to start the download before the URL is revoked. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Bytes per bridge call when writing a file in the Android app. A 4-hour MP3
 * is ~200 MB; one base64 string that size would exhaust the WebView, so it
 * crosses in pieces. A multiple of 3 keeps every piece's base64 unpadded.
 */
export const NATIVE_CHUNK_BYTES = 3 * 256 * 1024;

/**
 * Hand a Blob over as a file. In a browser it downloads; revoking the object
 * URL synchronously after click() races the save on some browsers with large
 * blobs, so the URL is kept alive for a minute. In the Android app (where
 * <a download> does nothing) the file is written to the app cache and the
 * system share sheet opens: save to Files/Drive, or send it to an app.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isNative()) {
    await shareNativeFile(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function downloadJson(value: unknown, filename: string): Promise<void> {
  return downloadBlob(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    filename,
  );
}

/** base64 of a Blob slice, without the data: URL prefix. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

/** The Android path of downloadBlob; `chunkBytes` is exposed for tests. */
export async function shareNativeFile(
  blob: Blob,
  filename: string,
  chunkBytes = NATIVE_CHUNK_BYTES,
): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  // One export at a time lives in the cache: drop the last one (they're big).
  await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true }).catch(
    () => undefined,
  );
  const path = `exports/${filename}`;
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: await blobToBase64(blob.slice(0, chunkBytes)),
    recursive: true,
  });
  for (let offset = chunkBytes; offset < blob.size; offset += chunkBytes) {
    await Filesystem.appendFile({
      path,
      directory: Directory.Cache,
      data: await blobToBase64(blob.slice(offset, offset + chunkBytes)),
    });
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  // The sheet stays up as long as the user likes; don't hold the caller
  // (an export's busy state) on it. Cancelling the sheet is not an error.
  void Share.share({ title: filename, files: [uri] }).catch(() => undefined);
}
