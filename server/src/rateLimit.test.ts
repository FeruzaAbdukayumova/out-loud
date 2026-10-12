import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rateLimit.ts'

describe('RateLimiter', () => {
  it('allows `limit` hits per window per key', () => {
    const r = new RateLimiter(2, 1000)
    expect([r.allow('a', 0), r.allow('a', 1), r.allow('a', 2), r.allow('b', 3)]).toEqual([true, true, false, true])
    expect(r.allow('a', 1000)).toBe(true) // new window
  })

  it('can check a key without counting', () => {
    const r = new RateLimiter(1, 1000)
    expect(r.blocked('a', 0)).toBe(false)
    r.allow('a', 0)
    expect(r.blocked('a', 1)).toBe(true)
    expect(r.blocked('a', 1000)).toBe(false)
  })

  it('a flood of made-up keys neither wipes a counter nor locks anyone else out', () => {
    const r = new RateLimiter(3, 60_000)
    for (let i = 0; i < 3; i++) r.allow('attacker', 0)
    for (let i = 0; i < 100_000; i++) r.allow('fake-' + i, 0)
    expect(r.allow('attacker', 1)).toBe(false)
    let blockedNewcomers = 0
    for (let i = 0; i < 1000; i++) if (!r.allow('person-' + i, 1)) blockedNewcomers++
    expect(blockedNewcomers).toBe(0)
  })
})
