import { describe, expect, it } from 'vitest'
import { INTERVAL_DAYS, LEARNED, afterReading, dueCards, missed, said, type Card } from './schedule'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 12)
const card = (word: string, extra: Partial<Card> = {}): Card => ({ word, box: 0, due: NOW, misses: 1, example: word, ...extra })

describe('the schedule', () => {
  it('moves a clearly said word up a box and brings it back later', () => {
    let c: Card | null = card('window')
    for (let box = 1; box < LEARNED; box++) {
      c = said(c!, NOW)
      expect(c).toMatchObject({ box, due: NOW + INTERVAL_DAYS[box] * DAY })
    }
    expect(said(c!, NOW)).toBeNull() // learned
  })

  it('sends a missed word back to the start, due now, and remembers the sentence', () => {
    const c = missed(card('window', { box: 3, due: NOW + 5 * DAY, misses: 2 }), 'window', 'I open the window.', NOW)
    expect(c).toEqual({ word: 'window', box: 0, due: NOW, misses: 3, example: 'I open the window.' })
  })

  it('picks the most overdue words first, then the shakiest', () => {
    const cards = [
      card('later', { due: NOW + DAY }),
      card('old', { due: NOW - 3 * DAY, box: 2 }),
      card('new-hard', { misses: 4 }),
      card('new-easy', { misses: 1 }),
    ]
    expect(dueCards(cards, NOW).map((c) => c.word)).toEqual(['old', 'new-hard', 'new-easy'])
    expect(dueCards(cards, NOW, 1)).toHaveLength(1)
  })
})

describe('afterReading', () => {
  it('adds missed and close words to the deck', () => {
    const { put, remove } = afterReading(
      new Map(),
      [
        { word: 'the', mark: 'ok', example: '' },
        { word: 'window', mark: 'almost', example: 'I open the window.' },
        { word: 'outside', mark: 'retry', example: 'I look outside.' },
      ],
      NOW,
    )
    expect(put.map((c) => c.word)).toEqual(['window', 'outside'])
    expect(remove).toEqual([])
  })

  it('counts a clear reading of a due word as a review, but not of one that is not due yet', () => {
    const deck = new Map([
      ['window', card('window', { box: 1, due: NOW - 1 })],
      ['outside', card('outside', { box: 1, due: NOW + DAY })],
      ['blue', card('blue', { box: LEARNED - 1, due: NOW })],
    ])
    const { put, remove } = afterReading(
      deck,
      ['window', 'outside', 'blue'].map((word) => ({ word, mark: 'ok' as const, example: '' })),
      NOW,
    )
    expect(put).toEqual([expect.objectContaining({ word: 'window', box: 2 })])
    expect(remove).toEqual(['blue'])
  })

  it('a word missed once and read clearly later in the same text stays missed', () => {
    const { put } = afterReading(
      new Map(),
      [
        { word: 'the', mark: 'retry', example: 'The sky.' },
        { word: 'the', mark: 'ok', example: '' },
      ],
      NOW,
    )
    expect(put).toEqual([expect.objectContaining({ word: 'the', box: 0 })])
  })
})
