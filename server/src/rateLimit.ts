/**
 * A fixed-window counter per key, in memory. Enough for one server instance; several instances
 * would need a shared store (Redis, or a table).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly maxKeys: number

  /** `maxKeys` bounds memory: past it, the oldest keys are forgotten (which only ever lets someone through early). */
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
      if (this.hits.size >= this.maxKeys) this.evict(now)
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    entry.count++
    return entry.count <= this.limit
  }

  get size() {
    return this.hits.size
  }

  private evict(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key)
    // still full of live keys (someone making up keys fast): drop the oldest; Maps keep insertion order
    for (const key of this.hits.keys()) {
      if (this.hits.size < this.maxKeys) break
      this.hits.delete(key)
    }
  }
}
