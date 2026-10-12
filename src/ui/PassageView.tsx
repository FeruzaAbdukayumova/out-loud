import { useEffect, useRef } from 'react'
import type { Mark } from '../reading/grade'
import type { Passage } from '../reading/text'
import { useSession, useSessionState } from './hooks'

// keep the first and last tick inside the track
const tickPos = (k: number, n: number) => (n > 1 ? 1 + (k / (n - 1)) * 98 : 50) + '%'

/** The text, each word tappable, coloured as it's read; under it the "voice track" of ticks. */
export function PassageView({ passage, onWord }: { passage: Passage; onWord: (word: string) => void }) {
  const { marks, reached, listening } = useSessionState()
  const n = passage.words.length
  const next = Math.min(reached + 1, n - 1)
  const markOf = (i: number): Mark => marks[i] ?? ''

  return (
    <>
      <p className="passage">
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

      <div className={'track' + (listening ? ' listening' : '')} aria-hidden="true">
        <div className="ticks">
          {passage.words.map((_, k) => (
            <div key={k} className={'tick' + (markOf(k) ? ' ' + markOf(k) : '')} style={{ left: tickPos(k, n) }} />
          ))}
        </div>
        <div className="playhead" style={{ left: tickPos(listening ? next : 0, n) }} />
        <LevelGlow />
      </div>
    </>
  )
}

/** Microphone level: written straight to the DOM, since it changes every frame. */
function LevelGlow() {
  const session = useSession()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(
    () =>
      session.onLevel((level) => {
        if (ref.current) ref.current.style.transform = `scaleY(${1 + level * 7})`
      }),
    [session],
  )
  return <div className="level-glow" ref={ref} />
}
