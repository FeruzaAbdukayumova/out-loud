import { useEffect, useMemo, useRef, useState } from 'react'
import { missed, said, type Card } from '../practice/schedule'
import { parsePassage } from '../reading/text'
import { useSession, useSessionState } from './hooks'
import { MicDot } from './MicDot'
import { statusText } from './status'

/** How long to wait after the word is said before checking it. */
const PAUSE_AFTER_WORD_MS = 1200

interface Props {
  /** The words due now, fixed for this round. */
  cards: Card[]
  speak: (text: string, rate?: number) => void
  /** Saves a card after its first try this round; null = learned. */
  onResult: (word: string, card: Card | null) => void
  onClose: () => void
}

type Outcome = 'clear' | 'again'

/** One round of practice: each due word, said on its own, with its sentence for context. */
export function PracticeView({ cards, speak, onResult, onClose }: Props) {
  const session = useSession()
  const { listening, status } = useSessionState()
  const [index, setIndex] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [tally, setTally] = useState({ clear: 0, again: 0 })
  /** Words whose first try this round has been saved. */
  const recorded = useRef(new Set<string>())

  const card = cards[index] as Card | undefined
  const passage = useMemo(() => card && parsePassage(card.word), [card])

  useEffect(() => {
    if (passage) session.load(passage, { pauseEndMs: PAUSE_AFTER_WORD_MS })
  }, [session, passage])

  // grade each try as the session finishes it
  const onResultRef = useRef(onResult)
  useEffect(() => {
    onResultRef.current = onResult
  })
  useEffect(() => {
    if (!card) return
    let last = session.getState().status
    return session.subscribe(() => {
      const { status, marks } = session.getState()
      if (status === last) return
      last = status
      if (status.kind !== 'done') return
      const clear = marks.every((m) => m === 'ok')
      setOutcome(clear ? 'clear' : 'again')
      // only the first try at a word moves it on the schedule; the rest is practice
      if (recorded.current.has(card.word)) return
      recorded.current.add(card.word)
      setTally((t) => (clear ? { ...t, clear: t.clear + 1 } : { ...t, again: t.again + 1 }))
      onResultRef.current(card.word, clear ? said(card, Date.now()) : missed(card, card.word, card.example, Date.now()))
    })
  }, [session, card])

  const next = () => {
    setOutcome(null)
    setIndex((i) => i + 1)
  }

  if (!card) {
    return (
      <main className="card practice">
        <h2 className="practice-title">Practice done</h2>
        <p className="practice-sub">
          {tally.clear} clear first time · {tally.again} to keep practising
        </p>
        <p className="practice-sub">Words you said clearly come back in a few days, so they stick.</p>
        <div className="controls">
          <button className="mic" onClick={onClose}>
            Back to reading
          </button>
        </div>
      </main>
    )
  }

  const [before, match, after] = splitAround(card.example, card.word)
  return (
    <main className="card practice">
      <div className="card-top">
        <span className="level">
          Word {index + 1} of {cards.length}
        </span>
        <button className="ghost" onClick={onClose}>
          Stop practising
        </button>
      </div>

      <button className={'practice-word' + (outcome ? ' ' + outcome : '')} onClick={() => speak(card.word, 0.7)} aria-label={`Hear “${card.word}”`}>
        {card.word}
      </button>
      {card.example !== card.word && (
        <p className="practice-example">
          <button className="ghost" onClick={() => speak(card.example, 0.8)} aria-label="Hear the sentence">
            ▶
          </button>{' '}
          {before}
          <b>{match}</b>
          {after}
        </p>
      )}

      <div className="controls">
        {outcome === 'clear' ? (
          <button className="mic" onClick={next} autoFocus>
            Next word
          </button>
        ) : (
          <button
            className={'mic' + (listening ? ' on' : '')}
            disabled={!session.supported}
            onClick={() => (listening ? session.stop() : session.start())}
          >
            <MicDot /> {listening ? 'Done' : outcome === 'again' ? 'Try again' : 'Say it'}
          </button>
        )}
        {outcome === 'again' && !listening && (
          <button className="ghost" onClick={next}>
            Skip
          </button>
        )}
        <p className="status" aria-live="polite">
          {outcome === 'clear'
            ? 'Clear!'
            : outcome === 'again' && !listening
              ? 'Not quite. Tap the word to hear it, then try again.'
              : status.kind === 'done'
                ? ''
                : listening
                  ? 'Listening — say the word.'
                  : status.kind === 'ready'
                    ? 'Tap the word to hear it, then say it.'
                    : statusText(status)}
        </p>
      </div>
    </main>
  )
}

/** The sentence split around the practice word, matched as a whole word in any case. */
function splitAround(sentence: string, word: string): [string, string, string] {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'iu').exec(sentence)
  if (!m) return [sentence, '', '']
  return [sentence.slice(0, m.index), m[0], sentence.slice(m.index + m[0].length)]
}
