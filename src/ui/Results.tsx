import type { Summary } from '../reading/grade'

const SPEAKER = (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8.5 2.5 5 5.5H2.5v5H5l3.5 3v-11Z" fill="currentColor" />
    <path
      d="M11 5.6a3.4 3.4 0 0 1 0 4.8M13.2 3.6a6.4 6.4 0 0 1 0 8.8"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
)

interface Props {
  summary: Summary
  /** The score the time before, if this text was read before. */
  previous: number | undefined
  onWord: (word: string) => void
}

export function Results({ summary: s, previous, onWord }: Props) {
  const delta = previous === undefined ? null : s.score - previous
  return (
    <section className="results show" aria-label="Results">
      <div className="score-row">
        <div className="score">
          {s.score}
          <small>%</small>
        </div>
        <div className="breakdown">
          <b>{s.ok}</b> clear · <b>{s.almost}</b> close · <b>{s.retry}</b> to practise
          <br />
          <b>{s.read}</b> of {s.total} words read
        </div>
      </div>
      {delta !== null && (
        <p className="delta">
          Last time {previous}% ·{' '}
          {delta === 0 ? (
            'same as before'
          ) : (
            <b className={delta < 0 ? 'down' : undefined}>
              {delta > 0 ? '+' : '−'}
              {Math.abs(delta)}
            </b>
          )}
        </p>
      )}
      <p className="practice-label">
        {s.practice.length ? 'Tap a word to hear it, then read the text again.' : 'Every word was clear. Try the next text.'}
      </p>
      <div className="chips">
        {s.practice.map(({ word, mark }) => (
          <button key={word} className={'chip ' + mark} onClick={() => onWord(word)} aria-label={`Hear “${word}”`}>
            {SPEAKER}
            {word}
          </button>
        ))}
      </div>
    </section>
  )
}
