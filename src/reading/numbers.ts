/**
 * Speech recognisers write numbers as digits ("I wake up at 7:00"), while texts usually spell
 * them out ("seven o'clock"). Both sides are turned into the words a reader would say.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function below100(n: number): string[] {
  if (n < 20) return [ONES[n]]
  const rest = n % 10
  return rest ? [TENS[Math.floor(n / 10)], ONES[rest]] : [TENS[n / 10]]
}

function below1000(n: number): string[] {
  if (n < 100) return below100(n)
  const rest = n % 100
  return [ONES[Math.floor(n / 100)], 'hundred', ...(rest ? below100(rest) : [])]
}

/** 0 – 999 999 as words; bigger numbers are read digit by digit. */
export function cardinal(n: number): string[] {
  if (n < 1000) return below1000(n)
  if (n < 1_000_000) {
    const rest = n % 1000
    return [...below1000(Math.floor(n / 1000)), 'thousand', ...(rest ? below1000(rest) : [])]
  }
  return String(n).split('').map((d) => ONES[Number(d)])
}

/** 1990 → "nineteen ninety", 2026 → "twenty twenty six", the way years are said. */
function year(n: number): string[] {
  const hi = Math.floor(n / 100)
  const lo = n % 100
  if (lo === 0) return [...below100(hi), 'hundred']
  return [...below100(hi), ...(lo < 10 ? ['oh', ONES[lo]] : below100(lo))]
}
const looksLikeYear = (n: number) => (n >= 1100 && n <= 1999) || (n >= 2010 && n <= 2099)

const ORDINAL: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
}
function toOrdinal(words: string[]): string[] {
  const last = words[words.length - 1]
  const ord = ORDINAL[last] ?? (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th')
  return [...words.slice(0, -1), ord]
}

/**
 * The spoken words for a number as it's written: "7", "7:30", "3.5", "1,000", "21st", "50%".
 * Returns null if `token` isn't a number.
 */
export function numberWords(token: string): string[] | null {
  const m = /^(\d+(?:,\d{3})*)(?:([:.])(\d+))?(st|nd|rd|th|%)?$/i.exec(token)
  if (!m) return null
  const [, whole, sep, frac, suffix] = m
  const n = Number(whole.replace(/,/g, ''))
  if (!Number.isSafeInteger(n)) return null

  if (sep === ':') {
    const minutes = Number(frac)
    const hour = cardinal(n)
    if (minutes === 0) return [...hour, "o'clock"]
    return [...hour, ...(minutes < 10 ? ['oh', ONES[minutes]] : below100(minutes % 100))]
  }

  let words = !sep && !suffix && !whole.includes(',') && looksLikeYear(n) ? year(n) : cardinal(n)
  if (sep === '.') words = [...words, 'point', ...frac.split('').map((d) => ONES[Number(d)])]
  if (suffix === '%') words = [...words, 'percent']
  else if (suffix) words = toOrdinal(words)
  return words
}
