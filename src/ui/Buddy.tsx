import { useEffect, useRef } from 'react'
import type { Status } from '../speech/session'
import { useSession } from './hooks'

export type Mood = 'idle' | 'listening' | 'happy' | 'unsure'

/** How the buddy looks at each moment of a reading. */
export function moodOf(status: Status): Mood {
  switch (status.kind) {
    case 'listening':
    case 'finishing-in':
    case 'at-end':
    case 'catching-up':
      return 'listening'
    case 'done': {
      const { score, read, total } = status.summary
      return read >= total * 0.8 && score >= 70 ? 'happy' : 'unsure'
    }
    case 'heard-nothing':
    case 'problem':
      return 'unsure'
    case 'ready':
      return 'idle'
  }
}

/**
 * The reading buddy: a little round listener who says the status out loud in a speech bubble.
 * While you read, its mouth opens with your voice.
 */
export function Buddy({ mood, says }: { mood: Mood; says: string }) {
  const session = useSession()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(
    () =>
      session.onLevel((level) => {
        ref.current?.style.setProperty('--level', String(Math.min(level * 3, 1)))
      }),
    [session],
  )
  useEffect(() => {
    if (mood !== 'listening') ref.current?.style.setProperty('--level', '0')
  }, [mood])

  return (
    <div className={'buddy ' + mood} ref={ref}>
      <p className="bubble" aria-live="polite">
        {says}
      </p>
      <svg className="buddy-face" viewBox="0 0 210 190" aria-hidden="true">
        <ellipse className="shadow" cx="105" cy="182" rx="66" ry="7" />
        <g className="bob">
          <path className="body" d="M30 108c0-50 34-86 75-86s75 36 75 86-30 68-75 68-75-18-75-68z" />
          {mood === 'happy' ? (
            <g className="eyes-happy">
              <path d="M66 96q12-14 24 0" />
              <path d="M120 96q12-14 24 0" />
            </g>
          ) : (
            <g className="eyes">
              <ellipse cx="78" cy="94" rx="12" ry="15" />
              <ellipse cx="132" cy="94" rx="12" ry="15" />
              <circle className="shine" cx="82" cy="89" r="4" />
              <circle className="shine" cx="136" cy="89" r="4" />
            </g>
          )}
          {mood === 'happy' ? (
            <path className="smile" d="M84 124q21 24 42 0" />
          ) : mood === 'unsure' ? (
            <path className="smile" d="M90 134q15-8 30 0" />
          ) : (
            <g className="mouth">
              <ellipse cx="105" cy="130" rx="15" ry="16" />
              <ellipse className="tongue" cx="105" cy="138" rx="8" ry="6" />
            </g>
          )}
          <ellipse className="cheek" cx="57" cy="120" rx="11" ry="7" />
          <ellipse className="cheek" cx="153" cy="120" rx="11" ry="7" />
        </g>
        <g className="waves">
          <path d="M188 70q13 10 0 24" />
          <path d="M198 60q24 22 0 44" />
        </g>
      </svg>
    </div>
  )
}
