/**
 * Fixed-window rate limiting in constant memory: a count-min sketch.
 *
 * Each key is hashed to one counter in each of four rows, and its count is the smallest of
 * them. Memory never grows, so there's nothing to evict: no flood of made-up keys can wipe a
 * counter or fill the table. Two keys can share a counter, which can only make a count too high,
 * never too low, and all four of a key's counters would have to collide. With 4 × 131 072
 * counters (4 MB), even 100 000 made-up keys a minute leave a newcomer's odds of being wrongly
 * blocked at about one in a million.
 *
 * One server instance only; several would need a shared store (Redis, or a table).
 */
const WIDTH = 1 << 17
const ROWS = 4

function fnv1a(key: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % WIDTH
}

export class RateLimiter {
  private readonly counts = Array.from({ length: ROWS }, () => new Uint32Array(WIDTH))
  /** The window each counter's count belongs to; a counter from an older window counts as 0. */
  private readonly windows = Array.from({ length: ROWS }, () => new Uint32Array(WIDTH))
  private readonly limit: number
  private readonly windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  private count(key: string, window: number, add: number): number {
    let min = Infinity
    for (let row = 0; row < ROWS; row++) {
      const i = fnv1a(key, row * 0x9e3779b9)
      // window numbers are stored +1, so a fresh (all-zero) table never matches window 0
      if (this.windows[row][i] !== window + 1) {
        this.windows[row][i] = window + 1
        this.counts[row][i] = 0
      }
      this.counts[row][i] += add
      min = Math.min(min, this.counts[row][i])
    }
    return min
  }

  /** Counts a hit; false if `key` is now over the limit. */
  allow(key: string, now = Date.now()): boolean {
    return this.count(key, Math.floor(now / this.windowMs), 1) <= this.limit
  }

  /** Whether `key` has used up its hits, without counting one. */
  blocked(key: string, now = Date.now()): boolean {
    return this.count(key, Math.floor(now / this.windowMs), 0) >= this.limit
  }
}
