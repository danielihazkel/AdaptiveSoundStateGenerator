package app.resonance.session;

import android.Manifest;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The web app's handle on SessionService (src/platform/nativeSession.ts):
 * start / update / stop the background session, and receive "action"
 * (pause, resume, stop) and "focus" (lost, transient, gained) events.
 */
@CapacitorPlugin(
    name = "ResonanceSession",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class SessionPlugin extends Plugin implements SessionService.Listener {

    @Override
    public void load() {
        SessionService.listener = this;
    }

    /** Begin the foreground service. Call from a user gesture (Begin). */
    @PluginMethod
    public void start(PluginCall call) {
        SessionState.current.reset();
        apply(call);
        try {
            Intent intent = new Intent(getContext(), SessionService.class).setAction(SessionService.ACTION_START);
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (RuntimeException e) {
            // ForegroundServiceStartNotAllowedException (Android 12+) when not
            // started from the foreground: the session still plays while the
            // screen is on, so report it and let the web app carry on.
            call.reject("Could not start the background session", e);
        }
    }

    /** Any subset of title, subtitle, artwork, durationSec, positionSec, playing. */
    @PluginMethod
    public void update(PluginCall call) {
        apply(call);
        SessionService.refreshIfRunning();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), SessionService.class));
        call.resolve();
    }

    /** Android 13+: without it the service still runs, the card just doesn't show. */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        resolveGranted(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    private void apply(PluginCall call) {
        SessionState s = SessionState.current;
        Bitmap artwork = call.hasOption("artwork") ? decodeDataUrl(call.getString("artwork")) : null;
        synchronized (s) {
            if (call.hasOption("title")) s.title = call.getString("title", s.title);
            if (call.hasOption("subtitle")) s.subtitle = call.getString("subtitle", s.subtitle);
            if (call.hasOption("artwork")) s.artwork = artwork;
            if (call.hasOption("durationSec")) {
                Double d = call.getDouble("durationSec");
                s.durationMs = d != null && d > 0 && !d.isInfinite() ? Math.round(d * 1000) : -1;
            }
            if (call.hasOption("positionSec")) {
                Double p = call.getDouble("positionSec");
                s.positionMs = p != null && p > 0 ? Math.round(p * 1000) : 0;
            }
            if (call.hasOption("playing")) s.playing = Boolean.TRUE.equals(call.getBoolean("playing"));
        }
    }

    /** "data:image/png;base64,…" → Bitmap; anything else (a URL path) → none. */
    private static Bitmap decodeDataUrl(String url) {
        if (url == null || !url.startsWith("data:")) return null;
        int comma = url.indexOf(',');
        if (comma < 0) return null;
        try {
            byte[] bytes = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    @Override
    public void onAction(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("action", data);
    }

    @Override
    public void onFocus(String state) {
        JSObject data = new JSObject();
        data.put("state", state);
        notifyListeners("focus", data);
    }

    @Override
    protected void handleOnDestroy() {
        if (SessionService.listener == this) SessionService.listener = null;
        // The activity (and its WebView, which makes the sound) is going away.
        getContext().stopService(new Intent(getContext(), SessionService.class));
    }
}
