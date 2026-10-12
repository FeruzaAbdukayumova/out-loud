/**
 * Words to practise, on a Leitner schedule: a word you miss goes back to box 0 and is due now;
 * each time you say it clearly it moves up a box and comes back later. Past the last box it's learned.
 */

/** Days until a word in each box is due again. */
export const INTERVAL_DAYS = [0, 1, 3, 7, 16]
export const LEARNED = INTERVAL_DAYS.length
const DAY_MS = 24 * 60 * 60 * 1000

export interface Card {
  /** Lower case, as written in the text. */
  word: string
  box: number
  due: number
  misses: number
  /** The sentence it was last missed in, to practise it in context. */
  example: string
}

/** A word missed (or only close) in a reading or a drill. */
export function missed(card: Card | undefined, word: string, example: string, now: number): Card {
  return { word, box: 0, due: now, misses: (card?.misses ?? 0) + 1, example: example || card?.example || word }
}

/** A word said clearly. Returns null once it's learned. */
export function said(card: Card, now: number): Card | null {
  const box = card.box + 1
  if (box >= LEARNED) return null
  return { ...card, box, due: now + INTERVAL_DAYS[box] * DAY_MS }
}

export const isDue = (card: Card, now: number) => card.due <= now

/** What to practise now: the most overdue first, then the shakiest. */
export function dueCards(cards: Card[], now: number, limit = 10): Card[] {
  return cards
    .filter((c) => isDue(c, now))
    .sort((a, b) => a.due - b.due || a.box - b.box || b.misses - a.misses)
    .slice(0, limit)
}

export interface WordResult {
  word: string
  mark: 'ok' | 'almost' | 'retry'
  example: string
}

/**
 * How a reading changes the deck. Missed words go in (or back to box 0). A word already in the
 * deck that was read clearly while due counts as a review; one read clearly before it's due
 * doesn't move, so reading the same text twice in a row can't fast-forward the schedule.
 */
export function afterReading(deck: Map<string, Card>, results: WordResult[], now: number): { put: Card[]; remove: string[] } {
  const next = new Map<string, Card | null>()
  for (const { word, mark, example } of results) {
    const card = next.has(word) ? next.get(word) : deck.get(word)
    if (mark !== 'ok') next.set(word, missed(card ?? undefined, word, example, now))
    else if (card && isDue(card, now) && !next.has(word)) next.set(word, said(card, now))
  }
  const put: Card[] = []
  const remove: string[] = []
  next.forEach((card, word) => (card ? put.push(card) : remove.push(word)))
  return { put, remove }
}
