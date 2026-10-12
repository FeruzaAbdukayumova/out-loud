import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addAttempt, addText, deleteText, listTexts, progressByText, type Progress } from '../library/library'
import { BUILT_IN, type Text } from '../library/texts'
import { parsePassage } from '../reading/text'
import { startMeter } from '../speech/meter'
import { browserRecognizer } from '../speech/recognizer'
import { ReadingSession } from '../speech/session'
import { speak as browserSpeak, stopSpeaking } from '../speech/speak'
import { AddTextSheet } from './AddTextSheet'
import { SessionContext, useSessionState } from './hooks'
import { PassageView } from './PassageView'
import { Picker } from './Picker'
import { Results } from './Results'
import { statusText } from './status'

type Speak = (text: string, rate?: number) => void

interface Props {
  session?: ReadingSession
  speak?: Speak
}

const LAST_TEXT_KEY = 'out-loud:text'

function rememberedTextId() {
  try {
    return localStorage.getItem(LAST_TEXT_KEY) ?? BUILT_IN[0].id
  } catch {
    return BUILT_IN[0].id
  }
}

export function App({ session = defaultSession(), speak = browserSpeak }: Props) {
  return (
    <SessionContext.Provider value={session}>
      <Reader session={session} speak={speak} />
    </SessionContext.Provider>
  )
}

function Reader({ session, speak }: { session: ReadingSession; speak: Speak }) {
  const [texts, setTexts] = useState<Text[]>(BUILT_IN)
  const [selectedId, setSelectedId] = useState(rememberedTextId)
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map())
  const [adding, setAdding] = useState(false)
  /** The text whose Delete button was tapped once; a second tap deletes it. */
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  /** The score before the reading just finished, to show how it changed. */
  const [previous, setPrevious] = useState<number | undefined>(undefined)
  const state = useSessionState()

  const text = texts.find((t) => t.id === selectedId) ?? texts[0]
  const passage = useMemo(() => parsePassage(text.body), [text.body])

  const refresh = useCallback(
    () =>
      Promise.all([listTexts(), progressByText()])
        .catch(() => [BUILT_IN, new Map<string, Progress>()] as const)
        .then(([t, p]) => {
          setTexts(t)
          setProgress(p)
        }),
    [],
  )
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    session.load(passage)
    try {
      localStorage.setItem(LAST_TEXT_KEY, text.id)
    } catch {
      // remembering the last text is a convenience
    }
  }, [session, passage, text.id])

  // every finished reading is saved, once
  const saved = useRef<object | null>(null)
  useEffect(() => {
    const { status } = state
    if (status.kind !== 'done' || saved.current === status) return
    saved.current = status
    setPrevious(progress.get(text.id)?.last)
    const { score, read, total, practice } = status.summary
    addAttempt({ textId: text.id, score, read, total, practice: practice.map((p) => p.word) })
      .then(refresh)
      .catch(() => {})
  }, [state, progress, text.id, refresh])

  const say = (words: string, rate: number) => {
    if (session.getState().listening) session.stop()
    speak(words, rate)
  }

  const onStart = () => {
    stopSpeaking()
    session.start()
  }

  const onSave = async (title: string, body: string) => {
    const added = await addText(title, body)
    void navigator.storage?.persist?.()
    setAdding(false)
    await refresh()
    setSelectedId(added.id)
  }

  const onDelete = async () => {
    if (armedDelete !== text.id) {
      setArmedDelete(text.id)
      return
    }
    await deleteText(text.id).catch(() => {})
    setSelectedId(BUILT_IN[0].id)
    await refresh()
  }

  const { status, listening } = state
  return (
    <div className="shell">
      <header>
        <h1 className="wordmark">
          Out<span> </span>Loud
        </h1>
        <p className="eyebrow">Read aloud · hear what to fix</p>
      </header>

      {!session.supported && (
        <div className="warn show" role="alert">
          This browser can’t listen yet. Open the page in Chrome, Edge or Safari to use the reading check — the texts and
          the audio buttons still work here.
        </div>
      )}

      <Picker texts={texts} selectedId={text.id} progress={progress} onSelect={setSelectedId} onAdd={() => setAdding(true)} />

      <main className="card">
        <div className="card-top">
          <span className="level">
            {text.level ?? 'Your text'} · {passage.words.length} words
          </span>
          <div className="card-actions">
            <button className="ghost" onClick={() => say(text.body, 0.8)}>
              ▶ Hear the whole text
            </button>
            {text.createdAt !== null && (
              <button className="ghost danger" onClick={() => void onDelete()} onBlur={() => setArmedDelete(null)}>
                {armedDelete === text.id ? 'Tap again to delete' : 'Delete'}
              </button>
            )}
          </div>
        </div>

        <PassageView passage={passage} onWord={(w) => say(w, 0.75)} />

        <div className="controls">
          <button
            className={'mic' + (listening ? ' on' : '')}
            disabled={!session.supported}
            onClick={() => (listening ? session.stop() : onStart())}
          >
            <span className="dot" /> {listening ? 'Finish now' : 'Start reading'}
          </button>
          <p className="status" aria-live="polite">
            {statusText(status)}
          </p>
        </div>

        {status.kind === 'done' && (
          <Results summary={status.summary} previous={previous} onWord={(w) => say(w, 0.7)} />
        )}
      </main>

      <p className="note">
        Reading ends on its own a few seconds after you stop talking. Tap any word in the text to hear how it sounds.
        Works in Chrome, Edge and Safari — the page needs a microphone, and Chrome needs an internet connection for
        speech recognition.
      </p>

      {adding && <AddTextSheet onSave={(t, b) => void onSave(t, b)} onClose={() => setAdding(false)} />}
    </div>
  )
}

let shared: ReadingSession | null = null
function defaultSession() {
  return (shared ??= new ReadingSession({ createRecognizer: browserRecognizer(), startMeter }))
}
