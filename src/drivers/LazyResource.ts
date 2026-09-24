/**
 * Something expensive to open, opened once, on first use.
 *
 * Every driver holds its client in one of these. Two properties matter:
 *
 * - **A failed open is forgotten.** Without that, a server that was down when
 *   first asked would stay "down" in this process forever, because every later
 *   call would await the same rejected promise.
 * - **Concurrent first calls share one open.** Two tool calls arriving
 *   together must not each open a pool and leak one of them.
 */
export class LazyResource<T> {
  private pending: Promise<T> | null = null;

  constructor(
    private readonly open: () => Promise<T>,
    private readonly dispose: (resource: T) => Promise<void>
  ) {}

  public get(): Promise<T> {
    if (!this.pending) {
      const opening = this.open();
      this.pending = opening;
      opening.catch(() => {
        // Compared rather than cleared unconditionally, so a failure of an
        // old open cannot wipe out a newer one started after a reset.
        if (this.pending === opening) {
          this.pending = null;
        }
      });
    }
    return this.pending;
  }

  /**
   * Drop the resource so the next `get` opens a fresh one, for when a client
   * has died in a way it cannot recover from.
   */
  public reset(): Promise<void> {
    return this.close();
  }

  /** Never throws: shutdown must not stall on one broken connection. */
  public async close(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    if (!pending) {
      return;
    }
    try {
      await this.dispose(await pending);
    } catch {
      // Already failed to open, or failed to close: either way nothing is
      // left to release.
    }
  }
}
