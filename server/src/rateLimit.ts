/**
 * A fixed-window counter per key, in memory. Enough for one server instance; several instances
 * would need a shared store (Redis, or a table).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly maxKeys: number

  /**
   * `maxKeys` bounds memory. When that many keys are live at once, new keys are refused until
   * some expire. Forgetting old keys instead would let someone wipe their own counter by
   * flooding made-up keys.
   */
  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxKeys = maxKeys
  }

  /** Counts a hit; false if `key` is over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.delete(key)
      if (this.hits.size >= this.maxKeys) this.sweep(now)
      if (this.hits.size >= this.maxKeys) return false
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    entry.count++
    return entry.count <= this.limit
  }

  /** Whether `key` is over the limit, without counting a hit. */
  blocked(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key)
    return !!entry && entry.resetAt > now && entry.count >= this.limit
  }

  get size() {
    return this.hits.size
  }

  private sweep(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key)
  }
}
