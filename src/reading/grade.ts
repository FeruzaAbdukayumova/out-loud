import { align } from './align'
import { spokenKeys, type Passage } from './text'

/** '' = not read (yet). */
export type Mark = '' | 'ok' | 'almost' | 'retry'

export const CLEAR = 0.82
export const CLOSE = 0.55
/**
 * Words right at the frontier are still being revised by the recogniser, so only words this
 * far behind it may turn red while reading. Nothing ahead of the reader is ever marked.
 */
export const LAG = 2
/**
 * While reading, a long run of "skipped" words means the recogniser is behind, not that the
 * reader jumped a line. Those only turn red at the end.
 */
export const MAX_LIVE_SKIP_RUN = 3

/** Marks each spoken unit of the text. `final` is the pass after reading ends. */
export function markUnits(matched: number[], lastTarget: number, final: boolean): Mark[] {
  const settledMax = final ? matched.length : lastTarget - LAG

  const runLength = new Array<number>(matched.length).fill(0)
  for (let k = 0; k < matched.length; ) {
    if (matched[k] !== -1) {
      k++
      continue
    }
    let e = k
    while (e < matched.length && matched[e] === -1) e++
    runLength.fill(e - k, k, e)
    k = e
  }

  return matched.map((s, k) => {
    const settled = k <= settledMax
    if (k > lastTarget) return ''
    if (s === -1) return settled && (final || runLength[k] <= MAX_LIVE_SKIP_RUN) ? 'retry' : ''
    if (s >= CLEAR) return 'ok'
    if (s >= CLOSE) return 'almost'
    return settled ? 'retry' : ''
  })
}

/** A printed word is as good as its worst part, and not done while a part of it is still to come. */
function worst(marks: Mark[]): Mark {
  if (marks.every((m) => m === '')) return ''
  if (marks.includes('retry')) return 'retry'
  if (marks.includes('almost') || marks.includes('')) return 'almost'
  return 'ok'
}

export interface Check {
  /** One mark per printed word. */
  marks: Mark[]
  /** The printed word the reader has got to, -1 before the first. */
  reached: number
}

export function check(passage: Passage, transcript: string, final: boolean): Check {
  const spoken = spokenKeys(transcript)
  if (!spoken.length) return { marks: passage.words.map(() => ''), reached: -1 }
  const { matched, lastTarget } = align(
    spoken,
    passage.units.map((u) => u.key),
  )
  const unitMarks = markUnits(matched, lastTarget, final)
  const perWord: Mark[][] = passage.words.map(() => [])
  passage.units.forEach((u, k) => perWord[u.word].push(unitMarks[k]))
  return {
    marks: perWord.map(worst),
    reached: lastTarget === -1 ? -1 : passage.units[lastTarget].word,
  }
}

export interface Summary {
  /** Share of the whole text that came out clear, 0–100: words not read count against it. */
  score: number
  ok: number
  almost: number
  retry: number
  read: number
  total: number
  /** Words to practise, each once, worst result kept, in reading order. */
  practice: { word: string; mark: 'almost' | 'retry' }[]
}

/** null when nothing was read. */
export function summarize(passage: Passage, marks: Mark[]): Summary | null {
  const read = marks.filter((m) => m !== '')
  if (!read.length) return null
  const count = (mark: Mark) => read.filter((m) => m === mark).length
  const ok = count('ok')

  const practice = new Map<string, 'almost' | 'retry'>()
  marks.forEach((mark, i) => {
    if (mark !== 'almost' && mark !== 'retry') return
    const word = passage.words[i].toLowerCase()
    if (mark === 'retry' || !practice.has(word)) practice.set(word, mark)
  })

  return {
    score: Math.round((ok / passage.words.length) * 100),
    ok,
    almost: count('almost'),
    retry: count('retry'),
    read: read.length,
    total: passage.words.length,
    practice: Array.from(practice, ([word, mark]) => ({ word, mark })),
  }
}
