import { numberWords } from './numbers'

/** A piece of a text as it's shown: a word you can tap, or the spaces and punctuation between words. */
export type Piece = { kind: 'word'; text: string; word: number } | { kind: 'gap'; text: string }

/** One spoken word the reader is expected to say. A printed word can stand for several ("21" → twenty one). */
export interface Unit {
  key: string
  /** Index of the printed word it belongs to. */
  word: number
}

export interface Passage {
  pieces: Piece[]
  /** The printed words, in order. */
  words: string[]
  units: Unit[]
}

// a run of digits (with :30, .5, ,000, 21st or 50%) or a run of letters (with inner apostrophes: don't, o'clock)
const WORD = /\d+(?:,\d{3})*(?:[:.]\d+)?(?:st|nd|rd|th|%)?|[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/giu

/**
 * Words that sound the same. The recogniser picks a spelling from context, so a reader who says
 * "blue" perfectly can come back as "blew"; that's not the reader's mistake.
 */
const SOUNDS_LIKE: Record<string, string> = Object.fromEntries(
  [
    ['to', 'too', 'two'],
    ['for', 'four'],
    ['by', 'buy', 'bye'],
    ['there', 'their', 'theyre'],
    ['blue', 'blew'],
    ['ate', 'eight'],
    ['see', 'sea'],
    ['write', 'right'],
    ['know', 'no'],
    ['knew', 'new'],
    ['hear', 'here'],
    ['its', 'it’s'],
    ['one', 'won'],
    ['son', 'sun'],
    ['road', 'rode'],
    ['meet', 'meat'],
    ['week', 'weak'],
    ['wear', 'where'],
    ['whole', 'hole'],
    ['hour', 'our'],
    ['flower', 'flour'],
    ['piece', 'peace'],
    ['red', 'read'],
    ['tail', 'tale'],
    ['made', 'maid'],
    ['night', 'knight'],
    ['wait', 'weight'],
    ['which', 'witch'],
    ['would', 'wood'],
  ].flatMap((group) => group.map((w) => [w.replace(/['’]/g, ''), group[0]])),
)

/** How a word is compared: lower case, apostrophes dropped (o'clock = oclock), sound-alikes as one. */
export function keyOf(word: string) {
  const k = word.toLowerCase().replace(/['’]/g, '')
  return SOUNDS_LIKE[k] ?? k
}

/** What a written word sounds like, as comparable keys. Hyphenated words are said as separate words. */
export function keysOf(word: string): string[] {
  const spoken = numberWords(word) ?? [word]
  return spoken.flatMap((w) => w.split('-')).map(keyOf).filter(Boolean)
}

export function parsePassage(text: string): Passage {
  const pieces: Piece[] = []
  const words: string[] = []
  const units: Unit[] = []
  let last = 0
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) pieces.push({ kind: 'gap', text: text.slice(last, m.index) })
    const word = words.length
    words.push(m[0])
    pieces.push({ kind: 'word', text: m[0], word })
    for (const key of keysOf(m[0])) units.push({ key, word })
    last = m.index + m[0].length
  }
  if (last < text.length) pieces.push({ kind: 'gap', text: text.slice(last) })
  return { pieces, words, units }
}

/** What the recogniser heard, as comparable keys. */
export const spokenKeys = (transcript: string): string[] =>
  Array.from(transcript.matchAll(WORD), (m) => m[0]).flatMap(keysOf)

/** Counts printed words, the way the "Add a text" form limits length. */
export const countWords = (text: string) => Array.from(text.matchAll(WORD)).length

/** For each printed word, the sentence it's in, to show a practice word in context. */
export function sentenceOfEachWord(passage: Passage): string[] {
  const out: string[] = []
  let sentence = ''
  let pending: number[] = []
  const close = () => {
    for (const w of pending) out[w] = sentence.trim()
    sentence = ''
    pending = []
  }
  for (const p of passage.pieces) {
    if (p.kind === 'word') {
      pending.push(p.word)
      sentence += p.text
      continue
    }
    const end = p.text.search(/[.!?…]/)
    if (end === -1) {
      sentence += p.text
      continue
    }
    // the closing punctuation (and any quote after it) belongs to this sentence
    const tail = /^[^.!?…]*[.!?…]+["'”’)]*/.exec(p.text)![0]
    sentence += tail
    close()
    sentence = p.text.slice(tail.length).trimStart()
  }
  close()
  return out
}
