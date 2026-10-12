import { describe, expect, it } from 'vitest'
import { countWords, parsePassage, spokenKeys } from './text'

describe('parsePassage', () => {
  it('splits a text into words and the gaps between them, keeping every character', () => {
    const text = "I wake up at seven o'clock. Then — I walk!"
    const p = parsePassage(text)
    expect(p.words).toEqual(['I', 'wake', 'up', 'at', 'seven', "o'clock", 'Then', 'I', 'walk'])
    expect(p.pieces.map((x) => x.text).join('')).toBe(text)
    expect(p.units.map((u) => u.key)).toEqual(['i', 'wake', 'up', 'at', 'seven', 'oclock', 'then', 'i', 'walk'])
  })

  it('treats a written number as the words it is read as', () => {
    const p = parsePassage('She is 21 today.')
    expect(p.words).toEqual(['She', 'is', '21', 'today'])
    expect(p.units).toEqual([
      { key: 'she', word: 0 },
      { key: 'is', word: 1 },
      { key: 'twenty', word: 2 },
      { key: 'one', word: 2 },
      { key: 'today', word: 3 },
    ])
  })

  it('splits hyphenated words, which are said as two', () => {
    expect(parsePassage('a well-known song').words).toEqual(['a', 'well', 'known', 'song'])
  })

  it('handles curly apostrophes and letters beyond a–z', () => {
    expect(parsePassage('Don’t touch the café').units.map((u) => u.key)).toEqual(['dont', 'touch', 'the', 'café'])
  })
})

describe('spokenKeys', () => {
  it('turns what the recogniser wrote into the words that were said', () => {
    expect(spokenKeys('I wake up at 7:00. My sister is 6')).toEqual([
      'i', 'wake', 'up', 'at', 'seven', 'oclock', 'my', 'sister', 'is', 'six',
    ])
  })
})

it('counts words', () => {
  expect(countWords('  One, two — three.  ')).toBe(3)
})
