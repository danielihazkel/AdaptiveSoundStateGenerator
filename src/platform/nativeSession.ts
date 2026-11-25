import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { MediaMeta, MediaSessionHandlers } from './mediaSession';

/**
 * The Android app's background session (android/…/session/SessionService):
 * a mediaPlayback foreground service that keeps the WebView — and with it the
 * synthesized sound — alive with the screen off, shows the notification /
 * lock-screen transport, holds a partial wake lock and audio focus. Stands in
 * for the Media Session API + silent <audio> keep-alive the browser uses.
 */
export interface NativeSessionUpdate {
  title?: string;
  subtitle?: string;
  /** A data: URL (platform/artwork.ts); anything else shows no art. */
  artwork?: string;
  durationSec?: number;
  positionSec?: number;
  playing?: boolean;
}

export type NativeSessionAction = 'pause' | 'resume' | 'stop';
/** `transient`: a call or a short prompt; `lost`: another player, headphones out. */
export type NativeFocusState = 'lost' | 'transient' | 'gained';

export interface ResonanceSessionPlugin {
  start(options: NativeSessionUpdate): Promise<void>;
  update(options: NativeSessionUpdate): Promise<void>;
  stop(): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  addListener(
    event: 'action',
    listener: (event: { action: NativeSessionAction }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'focus',
    listener: (event: { state: NativeFocusState }) => void,
  ): Promise<PluginListenerHandle>;
}

export const ResonanceSession = registerPlugin<ResonanceSessionPlugin>('ResonanceSession');

/** Android extrapolates the position itself; correct it only past this drift. */
export const POSITION_DRIFT_SEC = 2;
/** Re-send at least this often: each update re-arms the service's wake lock. */
export const HEARTBEAT_MS = 60_000;

/** Android 13+ hides the card without permission: asked once per app run. */
let notificationsAsked = false;

/** Test hook. */
export function resetNotificationAsk(): void {
  notificationsAsked = false;
}

export interface PlatformHandlers extends MediaSessionHandlers {
  /** The OS took the audio (focus lost) — silence without a user pause. */
  onInterrupt?: () => void;
  /** A transient loss (a call) ended — carry on if still interrupted. */
  onInterruptEnd?: () => void;
}

/**
 * One session's binding to the plugin. Mirrors mediaSession.ts call for call
 * (useSessionPlatform picks one or the other); the service starts on the
 * first audible/paused state and stops on 'none' or clear().
 */
export class NativeSessionBackend {
  private handlers: PlatformHandlers | null = null;
  private listeners: Promise<PluginListenerHandle>[] = [];
  private meta: MediaMeta = { title: 'Resonance' };
  private started = false;
  private playing = false;
  private transientLoss = false;
  private durationSec = 0;
  private sentPositionSec = 0;
  private sentAt = 0;

  constructor(
    private readonly plugin: ResonanceSessionPlugin,
    private readonly now: () => number = Date.now,
  ) {}

  setHandlers(handlers: PlatformHandlers): void {
    this.handlers = handlers;
    if (this.listeners.length > 0) return;
    this.listeners.push(
      this.plugin.addListener('action', ({ action }) => {
        const h = this.handlers;
        if (!h) return;
        if (action === 'pause') h.onPause();
        else if (action === 'resume') h.onResume();
        else if (action === 'stop') h.onStop();
      }),
      this.plugin.addListener('focus', ({ state }) => this.onFocus(state)),
    );
  }

  private onFocus(state: NativeFocusState): void {
    const h = this.handlers;
    if (!h) return;
    if (state === 'gained') {
      if (this.transientLoss) h.onInterruptEnd?.();
      this.transientLoss = false;
      return;
    }
    this.transientLoss = state === 'transient';
    h.onInterrupt?.();
  }

  setMetadata(meta: MediaMeta): void {
    this.meta = meta;
    if (this.started) void this.call('update', this.metaFields());
  }

  setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (state === 'none') {
      this.stopService();
      return;
    }
    const playing = state === 'playing';
    if (!this.started) {
      this.started = true;
      this.playing = playing;
      this.markSent(this.sentPositionSec);
      void this.call('start', { ...this.metaFields(), playing, durationSec: this.durationSec });
      this.askNotificationsOnce();
      return;
    }
    if (playing === this.playing) return;
    this.playing = playing;
    this.markSent(this.sentPositionSec);
    void this.call('update', { playing, positionSec: this.sentPositionSec });
  }

  setPosition(durationSec: number, positionSec: number): void {
    const durationChanged = durationSec !== this.durationSec;
    this.durationSec = durationSec;
    if (!this.started) {
      this.sentPositionSec = positionSec;
      return;
    }
    const elapsed = (this.now() - this.sentAt) / 1000;
    const expected = this.sentPositionSec + (this.playing ? elapsed : 0);
    const drift = Math.abs(positionSec - expected);
    if (!durationChanged && drift <= POSITION_DRIFT_SEC && this.now() - this.sentAt < HEARTBEAT_MS) {
      return;
    }
    this.markSent(positionSec);
    void this.call('update', { durationSec, positionSec });
  }

  clear(): void {
    this.stopService();
    this.handlers = null;
    for (const handle of this.listeners) void handle.then((h) => h.remove()).catch(() => undefined);
    this.listeners = [];
  }

  private stopService(): void {
    if (!this.started) return;
    this.started = false;
    this.playing = false;
    this.transientLoss = false;
    void this.call('stop');
  }

  private markSent(positionSec: number): void {
    this.sentPositionSec = positionSec;
    this.sentAt = this.now();
  }

  private metaFields(): NativeSessionUpdate {
    const art = this.meta.artwork?.[0]?.src;
    return {
      title: this.meta.title,
      subtitle: this.meta.subtitle ?? 'Resonance',
      ...(art?.startsWith('data:') ? { artwork: art } : {}),
    };
  }

  private askNotificationsOnce(): void {
    if (notificationsAsked) return;
    notificationsAsked = true;
    void this.plugin.requestNotificationPermission().catch(() => undefined);
  }

  private async call(method: 'start' | 'update' | 'stop', options?: NativeSessionUpdate): Promise<void> {
    try {
      if (method === 'stop') await this.plugin.stop();
      else await this.plugin[method](options ?? {});
    } catch (err) {
      // The session keeps playing in the foreground; only the background
      // keep-alive / card is missing.
      console.warn(`Background session ${method} failed`, err);
    }
  }
}
