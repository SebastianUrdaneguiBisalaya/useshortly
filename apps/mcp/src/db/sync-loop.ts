/** What the loop needs from a synced database. */
export type Syncable = {
  pull(): Promise<unknown>;
  push(): Promise<void>;
};

/**
 * Keeps a local database in step with Turso Cloud: pull then push every interval, never two
 * rounds at once, and a final push on stop so the last writes are not left behind. A failed
 * round is logged and retried on the next tick: the local database keeps serving meanwhile.
 */
export class SyncLoop {
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  constructor(
    private readonly db: Syncable,
    private readonly intervalMs: number,
    private readonly log: (message: string, error: unknown) => void = (m, e) => console.error(m, e),
  ) {}

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.round(), this.intervalMs);
    this.#timer.unref();
  }

  /** One pull+push; a round already in flight is awaited instead of started twice. */
  round(): Promise<void> {
    this.#running ??= this.#sync().finally(() => (this.#running = undefined));
    return this.#running;
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
    try {
      await this.db.push();
    } catch (error) {
      this.log("turso: final push failed", error);
    }
  }

  async #sync(): Promise<void> {
    try {
      await this.db.pull();
      await this.db.push();
    } catch (error) {
      this.log("turso: sync round failed", error);
    }
  }
}
