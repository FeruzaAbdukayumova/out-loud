import { describe, expect, it } from 'vitest'
import { check, markUnits, summarize } from './grade'
import { parsePassage } from './text'

const MORNING = parsePassage(
  "I wake up at seven o'clock. I open the window and look outside. The sky is blue today. My sister is six years old.",
)

describe('markUnits', () => {
  it('never marks words the reader has not reached', () => {
    expect(markUnits([1, 1, -1, -1], 1, false)).toEqual(['ok', 'ok', '', ''])
  })

  it('waits before calling a word at the frontier wrong, since the recogniser may still fix it', () => {
    // word 3 was skipped, but the reader is only 1 word past it
    expect(markUnits([1, 1, 1, -1, 1], 4, false)).toEqual(['ok', 'ok', 'ok', '', 'ok'])
    expect(markUnits([1, 1, 1, -1, 1], 4, true)).toEqual(['ok', 'ok', 'ok', 'retry', 'ok'])
  })

  it('does not paint a long skipped run red while reading, only at the end', () => {
    const matched = [1, -1, -1, -1, -1, 1, 1, 1, 1]
    expect(markUnits(matched, 8, false).slice(1, 5)).toEqual(['', '', '', ''])
    expect(markUnits(matched, 8, true).slice(1, 5)).toEqual(['retry', 'retry', 'retry', 'retry'])
  })

  it('grades by how alike the word was', () => {
    expect(markUnits([0.9, 0.6, 0.5, 1, 1, 1], 5, false)).toEqual(['ok', 'almost', 'retry', 'ok', 'ok', 'ok'])
  })
})

describe('check', () => {
  it('marks a clean reading all clear, even with numbers written as digits', () => {
    const transcript = 'I wake up at 7:00 I open the window and look outside the sky is blue today my sister is 6 years old'
    const { marks, reached } = check(MORNING, transcript, true)
    expect(marks.every((m) => m === 'ok')).toBe(true)
    expect(reached).toBe(MORNING.words.length - 1)
  })

  it('marks a written number clear when it is said in words', () => {
    const p = parsePassage('She turned 21 today')
    expect(check(p, 'she turned twenty one today', true).marks).toEqual(['ok', 'ok', 'ok', 'ok'])
  })

  it('shows half of a number as not finished yet', () => {
    const p = parsePassage('She turned 21 today')
    expect(check(p, 'she turned twenty', false).marks[2]).toBe('almost')
  })

  it('reports how far the reader got, by printed word', () => {
    expect(check(MORNING, 'I wake up', false).reached).toBe(2)
    expect(check(MORNING, '', false).reached).toBe(-1)
  })

  it('stays calm word by word as a reading comes in', () => {
    // a recogniser streaming a correct reading must never put a red mark on the page
    const said = 'I wake up at seven o clock I open the window and look outside'.split(' ')
    for (let n = 1; n <= said.length; n++) {
      const { marks } = check(MORNING, said.slice(0, n).join(' '), false)
      expect(marks).not.toContain('retry')
    }
  })
})

describe('summarize', () => {
  it('scores only the words that were read, and lists each word to practise once', () => {
    const p = parsePassage('the cat and the dog and the bird')
    const s = summarize(p, ['ok', 'retry', 'ok', 'almost', 'ok', 'ok', '', ''])
    expect(s).toMatchObject({ score: 67, ok: 4, almost: 1, retry: 1, read: 6, total: 8 })
    expect(s?.practice).toEqual([
      { word: 'cat', mark: 'retry' },
      { word: 'the', mark: 'almost' },
    ])
  })

  it('keeps the worst result for a word that comes up twice', () => {
    const p = parsePassage('the cat the dog')
    expect(summarize(p, ['almost', 'ok', 'retry', 'ok'])?.practice).toEqual([{ word: 'the', mark: 'retry' }])
  })

  it('has nothing to say when nothing was read', () => {
    expect(summarize(MORNING, MORNING.words.map(() => ''))).toBeNull()
  })
})
