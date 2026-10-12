import type { Mark } from '../reading/grade'
import type { Passage } from '../reading/text'
import { useSessionState } from './hooks'

/** The text, each word tappable, marked as it's read. */
export function PassageView({ passage, onWord }: { passage: Passage; onWord: (word: string) => void }) {
  const { marks, reached, listening } = useSessionState()
  const next = Math.min(reached + 1, passage.words.length - 1)
  const markOf = (i: number): Mark => marks[i] ?? ''

  return (
    <p className={'passage' + (listening ? ' reading' : '')}>
      {passage.pieces.map((p, idx) => {
        if (p.kind === 'gap') return p.text
        const mark = markOf(p.word)
        const current = listening && p.word === next && !mark
        return (
          <button
            key={idx}
            className={'w' + (mark ? ' ' + mark : '') + (current ? ' current' : '')}
            aria-label={`Hear “${p.text}”`}
            data-mark={mark || undefined}
            onClick={() => onWord(p.text)}
          >
            {p.text}
          </button>
        )
      })}
    </p>
  )
}
