import { describe, expect, it } from 'vitest'
import { cardinal, numberWords } from './numbers'

describe('numberWords', () => {
  it.each([
    ['7', 'seven'],
    ['13', 'thirteen'],
    ['21', 'twenty one'],
    ['40', 'forty'],
    ['105', 'one hundred five'],
    ['1,000', 'one thousand'],
    ['3500', 'three thousand five hundred'],
    ['7:00', "seven o'clock"],
    ['7:30', 'seven thirty'],
    ['9:05', 'nine oh five'],
    ['3.5', 'three point five'],
    ['50%', 'fifty percent'],
    ['1st', 'first'],
    ['2nd', 'second'],
    ['3rd', 'third'],
    ['5th', 'fifth'],
    ['12th', 'twelfth'],
    ['20th', 'twentieth'],
    ['21st', 'twenty first'],
    ['1990', 'nineteen ninety'],
    ['1905', 'nineteen oh five'],
    ['1800', 'eighteen hundred'],
    ['2026', 'twenty twenty six'],
    ['2005', 'two thousand five'],
  ])('%s → %s', (written, said) => {
    expect(numberWords(written)?.join(' ')).toBe(said)
  })

  it('leaves words alone', () => {
    expect(numberWords('seven')).toBeNull()
    expect(numberWords('7a')).toBeNull()
  })

  it('reads very long numbers digit by digit', () => {
    expect(cardinal(12_345_678)).toHaveLength(8)
  })
})
