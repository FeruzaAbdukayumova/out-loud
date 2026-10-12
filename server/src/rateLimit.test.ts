import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rateLimit.ts'

describe('RateLimiter', () => {
  it('allows `limit` hits per window per key', () => {
    const r = new RateLimiter(2, 1000)
    expect([r.allow('a', 0), r.allow('a', 1), r.allow('a', 2), r.allow('b', 3)]).toEqual([true, true, false, true])
    expect(r.allow('a', 1000)).toBe(true) // new window
  })

  it('stays within its memory bound when flooded with made-up keys, without forgetting anyone', () => {
    const r = new RateLimiter(1, 60_000, 100)
    r.allow('attacker', 0)
    for (let i = 0; i < 10_000; i++) r.allow('fake-' + i, 0)
    expect(r.size).toBeLessThanOrEqual(100)
    expect(r.allow('attacker', 1)).toBe(false) // the flood didn't wipe its counter
    expect(r.allow('newcomer', 1)).toBe(false) // full: new keys wait for the window to pass
    expect(r.allow('newcomer', 60_000)).toBe(true)
  })

  it('can check a key without counting', () => {
    const r = new RateLimiter(1, 1000)
    expect(r.blocked('a', 0)).toBe(false)
    r.allow('a', 0)
    expect(r.blocked('a', 1)).toBe(true)
    expect(r.blocked('a', 1000)).toBe(false)
  })
})
