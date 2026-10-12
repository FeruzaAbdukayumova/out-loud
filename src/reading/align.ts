/** Edit distance between two words. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/** 1 for the same word, falling towards 0 the more letters differ. */
export const similarity = (a: string, b: string) =>
  a === b ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length)

/** Spoken and printed words this alike are allowed to pair up; below it, a pairing costs. */
const PAIR_THRESHOLD = 0.45
/** Sounds that aren't an attempt at a word, so they never stand in for one. */
const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'ah', 'hmm', 'mm'])
const GAP = -0.6
const MISMATCH = -0.9

export interface Alignment {
  /** For each printed word: how alike the word said for it was (0–1), or -1 if nothing was said for it. */
  matched: number[]
  /** The last printed word anything was said for; -1 if none. */
  lastTarget: number
}

/**
 * Needleman–Wunsch: lines the spoken words up with the printed ones, so a skipped or extra word
 * doesn't throw off everything after it.
 */
export function align(spoken: string[], target: string[]): Alignment {
  const n = spoken.length
  const m = target.length
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  // 0 = pair, 1 = spoken word with no printed match, 2 = printed word that wasn't said
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
  for (let i = 1; i <= n; i++) {
    score[i][0] = score[i - 1][0] + GAP
    move[i][0] = 1
  }
  for (let j = 1; j <= m; j++) {
    score[0][j] = score[0][j - 1] + GAP
    move[0][j] = 2
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = similarity(spoken[i - 1], target[j - 1])
      let best = score[i - 1][j - 1] + (s >= PAIR_THRESHOLD ? s * 1.6 - 0.2 : MISMATCH)
      let p = 0
      const extra = score[i - 1][j] + GAP
      const skipped = score[i][j - 1] + GAP
      if (extra > best) [best, p] = [extra, 1]
      if (skipped > best) [best, p] = [skipped, 2]
      score[i][j] = best
      move[i][j] = p
    }
  }

  // Free end gap: the reader has only got as far as they've got, so the unread tail costs nothing.
  // Without it, one spoken "I" can pair with the LAST "I" in the text and everything before it
  // counts as skipped. Ties go to the earliest column, because leading gaps still cost.
  let endJ = 0
  let best = -Infinity
  for (let j = 0; j <= m; j++) {
    if (score[n][j] > best) [best, endJ] = [score[n][j], j]
  }

  const matched = new Array<number>(m).fill(-1)
  let lastTarget = -1
  /** The spoken word paired with `lastTarget`. */
  let lastSpoken = -1
  let i = n
  let j = endJ
  while (i > 0 || j > 0) {
    const p = i === 0 ? 2 : j === 0 ? 1 : move[i][j]
    if (p === 0) {
      matched[j - 1] = similarity(spoken[i - 1], target[j - 1])
      if (j - 1 > lastTarget) [lastTarget, lastSpoken] = [j - 1, i - 1]
      i--
      j--
    } else if (p === 1) i--
    else j--
  }

  // Words said after the last one that matched are the reader carrying on and getting the next
  // words wrong, not extra words: the free end gap would otherwise drop them, and the words they
  // were tries at would look unread instead of misread.
  for (let k = lastSpoken + 1; k < n && lastTarget < m - 1; k++) {
    if (FILLERS.has(spoken[k])) continue
    lastTarget++
    matched[lastTarget] = similarity(spoken[k], target[lastTarget])
  }
  return { matched, lastTarget }
}
