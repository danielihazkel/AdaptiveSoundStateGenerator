package app.resonance.session;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import app.resonance.R;

/**
 * Keeps a Resonance session alive with the screen off (the web app's sound is
 * synthesized in the WebView, so the process must not be frozen or killed):
 * a mediaPlayback foreground service with the lock-screen / notification
 * transport, a partial wake lock, and audio focus. The web app drives it
 * through SessionPlugin; transport taps and focus changes go back the same way.
 */
public class SessionService extends Service {

    static final String ACTION_START = "app.resonance.session.START";
    static final String ACTION_PAUSE = "app.resonance.session.PAUSE";
    static final String ACTION_PLAY = "app.resonance.session.PLAY";
    static final String ACTION_STOP = "app.resonance.session.STOP";

    private static final String CHANNEL_ID = "session";
    private static final int NOTIFICATION_ID = 1;
    private static final String CUSTOM_STOP = "stop";
    /** Re-armed on every refresh; a stalled web app can't hold the CPU forever. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 30 * 60 * 1000L;

    /** Where transport and focus events go: SessionPlugin, while it's loaded. */
    interface Listener {
        void onAction(String action);

        void onFocus(String state);
    }

    static volatile Listener listener;
    private static volatile SessionService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private boolean hasFocus = false;
    private boolean noisyRegistered = false;
    /** What the posted notification shows; re-posted only when it changes. */
    private String postedKey = null;

    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        switch (change) {
            case AudioManager.AUDIOFOCUS_GAIN:
                hasFocus = true;
                emitFocus("gained");
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                hasFocus = false;
                emitFocus("lost");
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                emitFocus("transient");
                break;
            default:
                // LOSS_TRANSIENT_CAN_DUCK: the system ducks us; ambient sound
                // can carry on under a navigation prompt.
                break;
        }
    };

    /** Headphones pulled: never let a sleep mix jump to the speaker. */
    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) emitFocus("lost");
        }
    };

    /** Refresh the notification and media session from SessionState. */
    static void refreshIfRunning() {
        SessionService service = instance;
        if (service != null) service.main.post(service::refresh);
    }

    static boolean isRunning() {
        return instance != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createChannel();
        mediaSession = new MediaSession(this, "Resonance");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                emitAction("resume");
            }

            @Override
            public void onPause() {
                emitAction("pause");
            }

            @Override
            public void onStop() {
                emitAction("stop");
            }

            @Override
            public void onCustomAction(String action, android.os.Bundle extras) {
                if (CUSTOM_STOP.equals(action)) emitAction("stop");
            }
        });
        mediaSession.setSessionActivity(contentIntent());
        mediaSession.setActive(true);
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Resonance:session");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PAUSE.equals(action)) {
            emitAction("pause");
        } else if (ACTION_PLAY.equals(action)) {
            emitAction("resume");
        } else if (ACTION_STOP.equals(action)) {
            emitAction("stop");
        } else {
            // START (or a restart with a null intent): post the notification
            // first — startForeground must follow startForegroundService fast.
            goForeground();
            requestFocus();
            registerNoisy();
        }
        // The sound lives in the WebView: if the process dies, there is
        // nothing to restart into.
        return START_NOT_STICKY;
    }

    private void goForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        refresh();
    }

    private void refresh() {
        SessionState s = SessionState.current;
        boolean playing;
        String key;
        synchronized (s) {
            playing = s.playing;
            key = s.title + "|" + s.subtitle + "|" + playing + "|" + System.identityHashCode(s.artwork);
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, s.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, s.subtitle)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "Resonance");
            if (s.durationMs > 0) meta.putLong(MediaMetadata.METADATA_KEY_DURATION, s.durationMs);
            if (s.artwork != null) meta.putBitmap(MediaMetadata.METADATA_KEY_ART, s.artwork);
            mediaSession.setMetadata(meta.build());
            mediaSession.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP)
                .addCustomAction(new PlaybackState.CustomAction.Builder(
                    CUSTOM_STOP, getString(R.string.session_stop), R.drawable.ic_session_stop).build())
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                    s.positionMs, playing ? 1f : 0f, SystemClock.elapsedRealtime())
                .build());
        }
        if (!key.equals(postedKey)) {
            postedKey = key;
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(NOTIFICATION_ID, buildNotification());
        }
        if (playing) {
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
            if (!hasFocus) requestFocus();
        } else if (wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private Notification buildNotification() {
        SessionState s = SessionState.current;
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        boolean playing;
        synchronized (s) {
            playing = s.playing;
            b.setContentTitle(s.title).setContentText(s.subtitle);
            if (s.artwork != null) b.setLargeIcon(s.artwork);
        }
        b.setSmallIcon(R.drawable.ic_session)
            .setContentIntent(contentIntent())
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(new Notification.Action.Builder(
                Icon.createWithResource(this, playing ? R.drawable.ic_session_pause : R.drawable.ic_session_play),
                getString(playing ? R.string.session_pause : R.string.session_resume),
                serviceIntent(playing ? ACTION_PAUSE : ACTION_PLAY)).build())
            .addAction(new Notification.Action.Builder(
                Icon.createWithResource(this, R.drawable.ic_session_stop),
                getString(R.string.session_stop), serviceIntent(ACTION_STOP)).build())
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return b.build();
    }

    private PendingIntent serviceIntent(String action) {
        Intent intent = new Intent(this, SessionService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent contentIntent() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) launch = new Intent();
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(this, 0, launch,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, getString(R.string.session_channel), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.session_channel_description));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }

    private void requestFocus() {
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build())
                    .setOnAudioFocusChangeListener(focusListener, main)
                    .setWillPauseWhenDucked(false)
                    .build();
            }
            result = audioManager.requestAudioFocus(focusRequest);
        } else {
            result = audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        hasFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
        } else {
            audioManager.abandonAudioFocus(focusListener);
        }
        hasFocus = false;
    }

    private void registerNoisy() {
        if (noisyRegistered) return;
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(noisyReceiver, filter);
        }
        noisyRegistered = true;
    }

    private static void emitAction(String action) {
        Listener l = listener;
        if (l != null) l.onAction(action);
    }

    private static void emitFocus(String state) {
        Listener l = listener;
        if (l != null) l.onFocus(state);
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (noisyRegistered) {
            unregisterReceiver(noisyReceiver);
            noisyRegistered = false;
        }
        abandonFocus();
        if (wakeLock.isHeld()) wakeLock.release();
        mediaSession.setActive(false);
        mediaSession.release();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        super.onDestroy();
    }

    /** The user swiped the app away: the WebView (and the sound) are gone. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
