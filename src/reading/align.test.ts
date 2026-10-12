import { describe, expect, it } from 'vitest'
import { align, levenshtein, similarity } from './align'

const words = (s: string) => s.split(' ')

describe('similarity', () => {
  it('is 1 for the same word and drops with each changed letter', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(similarity('walk', 'walk')).toBe(1)
    expect(similarity('walk', 'walks')).toBeCloseTo(0.8)
    expect(similarity('tea', 'cup')).toBe(0)
  })
})

describe('align', () => {
  const target = words('i wake up at seven oclock i open the window')

  it('pairs every word of a perfect reading', () => {
    const { matched, lastTarget } = align(target, target)
    expect(matched.every((s) => s === 1)).toBe(true)
    expect(lastTarget).toBe(target.length - 1)
  })

  it('keeps going after a skipped word', () => {
    const { matched } = align(words('i wake up at oclock i open the window'), target)
    expect(matched[4]).toBe(-1)
    expect(matched.slice(5)).toEqual([1, 1, 1, 1, 1])
  })

  it('keeps going after an extra word', () => {
    const { matched } = align(words('i wake um up at seven oclock'), target)
    expect(matched.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('pairs a mispronounced word with its printed word', () => {
    const { matched } = align(words('i wake up at seven oclock i opened the window'), target)
    expect(matched[7]).toBeCloseTo(0.67, 1)
  })

  it('only gets as far as the reader has got', () => {
    // one "i" must pair with the first "i", not the second one, with the start counted as skipped
    expect(align(['i'], target)).toEqual({ matched: [1, ...new Array(9).fill(-1)], lastTarget: 0 })
  })

  it('counts wrong words after the last match as tries at the next printed words', () => {
    const { matched, lastTarget } = align(words('i wake up at banana purple'), target)
    expect(matched.slice(0, 4)).toEqual([1, 1, 1, 1])
    expect(matched[4]).toBeLessThan(0.45) // "banana" for "seven"
    expect(matched[5]).toBeLessThan(0.45) // "purple" for "oclock"
    expect(lastTarget).toBe(5)
  })

  it('does not count a trailing "um" as a try at the next word', () => {
    expect(align(words('i wake up um'), target).lastTarget).toBe(2)
  })

  it('handles nothing said and nothing to say', () => {
    expect(align([], target).lastTarget).toBe(-1)
    expect(align(['hello'], [])).toEqual({ matched: [], lastTarget: -1 })
  })
})
