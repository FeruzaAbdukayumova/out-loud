import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addAttempt,
  addText,
  deleteText,
  listCards,
  listTexts,
  onLocalChange,
  onRemoteChange,
  progressByText,
  updateCards,
  type Progress,
} from '../library/library'
import { BUILT_IN, type Text } from '../library/texts'
import { afterReading, dueCards, type Card, type WordResult } from '../practice/schedule'
import { parsePassage, sentenceOfEachWord } from '../reading/text'
import { startMeter } from '../speech/meter'
import { modelDownloaded, WorkerModel, type SpeechModel } from '../speech/onDevice/model'
import { browserRecognizer } from '../speech/recognizer'
import { ReadingSession } from '../speech/session'
import { speak as browserSpeak, stopSpeaking } from '../speech/speak'
import type { Syncer } from '../sync/syncer'
import { AccountSheet } from './Account'
import { AddTextSheet } from './AddTextSheet'
import { SessionContext, useSessionState } from './hooks'
import { MicDot } from './MicDot'
import { PassageView } from './PassageView'
import { PracticeView } from './PracticeView'
import { Picker } from './Picker'
import { Results } from './Results'
import { Settings } from './Settings'
import { ThemeMenu } from './ThemePicker'
import { statusText } from './status'

type Speak = (text: string, rate?: number) => void

interface Props {
  session?: ReadingSession
  speak?: Speak
  /** Keeps data in step across devices; null when the app is built without a server. */
  syncer?: Syncer | null
  /** The speech model for listening on the device; nothing is downloaded until the reader asks. */
  model?: SpeechModel
}

const LAST_TEXT_KEY = 'out-loud:text'

function rememberedTextId() {
  try {
    return localStorage.getItem(LAST_TEXT_KEY) ?? BUILT_IN[0].id
  } catch {
    return BUILT_IN[0].id
  }
}

export function App({ session = defaultSession(), speak = browserSpeak, syncer = null, model = defaultModel() }: Props) {
  /** The practice deck, and when it was loaded (what's due depends on the time). */
  const [deck, setDeck] = useState<{ cards: Card[]; at: number }>({ cards: [], at: 0 })
  /** The words being practised this round; null while reading. */
  const [round, setRound] = useState<Card[] | null>(null)

  const refreshCards = useCallback(
    () =>
      listCards()
        .catch(() => [])
        .then((cards) => setDeck({ cards, at: Date.now() })),
    [],
  )
  useEffect(() => onRemoteChange(() => void refreshCards()), [refreshCards])
  useEffect(() => {
    if (!syncer) return
    const stopWatching = onLocalChange(() => syncer.schedule())
    const stop = syncer.start()
    return () => {
      stopWatching()
      stop()
    }
  }, [syncer])
  useEffect(() => {
    void refreshCards()
    // words fall due while the app sits in the background
    const onVisible = () => document.visibilityState === 'visible' && void refreshCards()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshCards])

  const onReadingDone = (results: WordResult[]) => {
    const byWord = new Map(deck.cards.map((c) => [c.word, c]))
    updateCards(afterReading(byWord, results, Date.now()))
      .then(refreshCards)
      .catch(() => {})
  }

  const onPracticeResult = (word: string, card: Card | null) => {
    updateCards(card ? { put: [card], remove: [] } : { put: [], remove: [word] })
      .then(refreshCards)
      .catch(() => {})
  }

  const due = dueCards(deck.cards, deck.at)
  return (
    <SessionContext.Provider value={session}>
      {round ? (
        <div className="shell">
          <Header />
          <PracticeView
            cards={round}
            speak={speak}
            onResult={onPracticeResult}
            onClose={() => {
              session.cancel()
              setRound(null)
            }}
          />
        </div>
      ) : (
        <Reader
          session={session}
          speak={speak}
          syncer={syncer}
          dueCount={due.length}
          onPractice={() => setRound(due)}
          onReadingDone={onReadingDone}
          model={model}
        />
      )}
    </SessionContext.Provider>
  )
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header>
      <h1 className="wordmark">
        Out<span> </span>Loud
      </h1>
      {children}
    </header>
  )
}

interface ReaderProps {
  session: ReadingSession
  speak: Speak
  syncer: Syncer | null
  dueCount: number
  onPractice: () => void
  onReadingDone: (results: WordResult[]) => void
  model: SpeechModel
}

function Reader({ session, speak, syncer, dueCount, onPractice, onReadingDone, model }: ReaderProps) {
  const [accountOpen, setAccountOpen] = useState(false)
  // a browser that can't listen by itself needs the speech model before anything else works
  const [settingsOpen, setSettingsOpen] = useState(() => session.builtInRecognizer === null && !modelDownloaded())
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
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
    return onRemoteChange(() => void refresh())
  }, [refresh])

  useEffect(() => {
    session.load(passage)
    try {
      localStorage.setItem(LAST_TEXT_KEY, text.id)
    } catch {
      // remembering the last text is a convenience
    }
  }, [session, passage, text.id])

  const onReadingDoneRef = useRef(onReadingDone)
  useEffect(() => {
    onReadingDoneRef.current = onReadingDone
  })

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
    const sentences = sentenceOfEachWord(passage)
    onReadingDoneRef.current(
      state.marks.flatMap((mark, i) => (mark ? [{ word: passage.words[i].toLowerCase(), mark, example: sentences[i] }] : [])),
    )
  }, [state, progress, text.id, passage, refresh])

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
      <Header>
        <div className="header-actions">
          {dueCount > 0 && (
            <button className="practice-entry" onClick={onPractice}>
              Practise {dueCount} {dueCount === 1 ? 'word' : 'words'}
            </button>
          )}
          <ThemeMenu />
          <button className="ghost" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </Header>

      <Picker texts={texts} selectedId={text.id} progress={progress} onSelect={setSelectedId} onAdd={() => setAdding(true)} />

      <main className="card">
        <div className="card-top">
          <span className="level">
            {text.level ?? 'Your text'} · {passage.words.length} words
          </span>
          <div className="card-actions">
            <button className="ghost" onClick={() => say(text.body, 0.8)}>
              Hear the whole text
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
            <MicDot /> {listening ? 'Finish now' : 'Start reading'}
          </button>
          <p className="status" aria-live="polite">
            {session.supported || listening ? statusText(status) : 'Open Settings to choose how the app listens.'}
          </p>
        </div>

        {status.kind === 'done' && (
          <Results summary={status.summary} previous={previous} onWord={(w) => say(w, 0.7)} />
        )}
      </main>

      <Settings
        open={settingsOpen}
        onClose={closeSettings}
        session={session}
        model={model}
        syncer={syncer}
        onAccount={() => {
          setSettingsOpen(false)
          setAccountOpen(true)
        }}
      />
      {syncer && accountOpen && (
        <AccountSheet
          syncer={syncer}
          onClose={() => {
            // back to the settings it was opened from
            setAccountOpen(false)
            setSettingsOpen(true)
          }}
        />
      )}
      {adding && <AddTextSheet onSave={(t, b) => void onSave(t, b)} onClose={() => setAdding(false)} />}
    </div>
  )
}

let sharedModel: SpeechModel | null = null
function defaultModel() {
  return (sharedModel ??= new WorkerModel())
}

let shared: ReadingSession | null = null
function defaultSession() {
  return (shared ??= new ReadingSession({ createRecognizer: browserRecognizer(), startMeter }))
}
