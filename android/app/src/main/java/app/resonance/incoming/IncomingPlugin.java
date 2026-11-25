package app.resonance.incoming;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * A `.resonance.json` file opened from Files or shared from another app
 * (intent filters in AndroidManifest.xml). Reads it and hands the text to the
 * web app as a "file" event ({ name, text } or { name, error }), retained until
 * a listener attaches, so a cold start doesn't lose it. The web app validates
 * it like any other import (src/app/useShareImport.ts).
 */
@CapacitorPlugin(name = "ResonanceIncoming")
public class IncomingPlugin extends Plugin {

    /** Share payloads are a few KB; a full data backup stays well under this. */
    private static final int MAX_BYTES = 8 * 1024 * 1024;

    @Override
    public void load() {
        handle(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        handle(intent);
    }

    private void handle(Intent intent) {
        Uri uri = fileUri(intent);
        if (uri == null) return;
        // Consumed: a recreated activity must not offer the import again.
        intent.setAction(null);
        intent.setData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);
        final Uri target = uri;
        new Thread(() -> {
            JSObject data = new JSObject();
            data.put("name", displayName(target));
            try {
                data.put("text", readText(target));
            } catch (IOException | SecurityException e) {
                data.put("error", "That file could not be read.");
            }
            notifyListeners("file", data, true);
        }, "resonance-incoming").start();
    }

    private static Uri fileUri(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            return data != null && "content".equals(data.getScheme()) ? data : null;
        }
        if (Intent.ACTION_SEND.equals(action)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            }
            @SuppressWarnings("deprecation")
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return stream;
        }
        return null;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver()
            .query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null) return name;
            }
        } catch (RuntimeException ignored) {
            // Some providers refuse metadata queries; the name is cosmetic.
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "file";
    }

    private String readText(Uri uri) throws IOException {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("no stream");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int n;
            while ((n = in.read(buffer)) != -1) {
                total += n;
                if (total > MAX_BYTES) throw new IOException("too large");
                out.write(buffer, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
