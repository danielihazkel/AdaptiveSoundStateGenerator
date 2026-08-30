/**
 * Screen Wake Lock (PRD §4 sessions on phones): keeps the display on while a
 * session plays so the OS never suspends the tab mid-session. The OS releases
 * the lock whenever the page is hidden, so we re-acquire on return while it
 * is still wanted. Silent no-op where unsupported or denied (low battery).
 */
export class WakeLockHolder {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private readonly onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.request();
  };

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  async acquire(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    await this.request();
  }

  release(): void {
    if (!this.wanted) return;
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => undefined);
  }

  private async request(): Promise<void> {
    if (!WakeLockHolder.supported || this.sentinel) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        void sentinel.release().catch(() => undefined);
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Denied (battery saver, hidden page) or unsupported — nothing to do.
    }
  }
}
