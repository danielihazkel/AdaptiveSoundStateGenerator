package app.resonance.session;

import android.graphics.Bitmap;

/**
 * What the notification and media session show, written by SessionPlugin
 * (from the web app's session screen) and read by SessionService. Guarded by
 * the class lock; both sides touch it on the main thread anyway.
 */
final class SessionState {
    String title = "Resonance";
    String subtitle = "Resonance";
    Bitmap artwork;
    /** Total length in ms; <= 0 for an open-ended session. */
    long durationMs = -1;
    long positionMs = 0;
    /** Audible (running, ending, alarm) vs paused/interrupted. */
    boolean playing = true;

    static final SessionState current = new SessionState();

    private SessionState() {}

    synchronized void reset() {
        title = "Resonance";
        subtitle = "Resonance";
        artwork = null;
        durationMs = -1;
        positionMs = 0;
        playing = true;
    }
}
