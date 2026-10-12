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
 * The hash is keyed with a secret made at startup. With a plain hash, anyone reading this
 * (open source) code could work out keys that land on a victim's counters and push them up.
 *
 * One server instance only; several would need a shared store (Redis, or a table).
 */
import { createHmac, randomBytes } from 'node:crypto'

const WIDTH = 1 << 17
const ROWS = 4

export class RateLimiter {
  private readonly counts = Array.from({ length: ROWS }, () => new Uint32Array(WIDTH))
  /** The window each counter's count belongs to; a counter from an older window counts as 0. */
  private readonly windows = Array.from({ length: ROWS }, () => new Uint32Array(WIDTH))
  private readonly limit: number
  private readonly windowMs: number
  private readonly secret: Buffer

  constructor(limit: number, windowMs: number, secret = randomBytes(32)) {
    this.limit = limit
    this.windowMs = windowMs
    this.secret = secret
  }

  /** One counter index per row, from a single keyed hash (32 bytes = 8 × 4, rows use the first 4). */
  private slots(key: string): number[] {
    const digest = createHmac('sha256', this.secret).update(key).digest()
    return Array.from({ length: ROWS }, (_, row) => digest.readUInt32LE(row * 4) % WIDTH)
  }

  private count(key: string, window: number, add: number): number {
    let min = Infinity
    const slots = this.slots(key)
    for (let row = 0; row < ROWS; row++) {
      const i = slots[row]
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
