/**
 * Fixed-window attempt counter, in memory. It protects the sign-in form from guessing on top of
 * the API's own limits; a restart resets it, which only ever lets a few extra attempts through.
 */
export class AttemptLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts an attempt and reports whether it is allowed. */
  allow(key: string): boolean {
    const now = this.now();
    if (this.#hits.size > 10_000) this.#sweep(now);
    const entry = this.#hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  #sweep(now: number) {
    for (const [key, entry] of this.#hits) if (entry.resetAt <= now) this.#hits.delete(key);
  }
}
