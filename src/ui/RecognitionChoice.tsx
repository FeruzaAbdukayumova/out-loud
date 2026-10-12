import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { modelDownloaded, type SpeechModel } from '../speech/onDevice/model'
import { MODEL_MB } from '../speech/onDevice/protocol'
import { onDeviceRecognizer } from '../speech/onDevice/recognizer'
import type { CreateRecognizer } from '../speech/recognizer'
import type { ReadingSession } from '../speech/session'

type Engine = 'browser' | 'device'
const ENGINE_KEY = 'out-loud:engine'

function rememberedEngine(hasBrowser: boolean): Engine {
  try {
    const saved = localStorage.getItem(ENGINE_KEY)
    if (saved === 'device' || (saved === 'browser' && hasBrowser)) return saved
  } catch {
    // remembering the choice is a convenience
  }
  return hasBrowser ? 'browser' : 'device'
}

interface Props {
  session: ReadingSession
  model: SpeechModel
  /** The browser's own recogniser; null where there isn't one (Firefox). */
  browser: CreateRecognizer | null
}

/**
 * Which recogniser listens: the browser's (Chrome's sends audio to Google), or a speech model
 * running on this device, which is private and works offline but is a one-time download.
 */
export function RecognitionChoice({ session, model, browser }: Props) {
  const [engine, setEngine] = useState<Engine>(() => rememberedEngine(browser !== null))
  const modelState = useSyncExternalStore(model.subscribe, model.getState)
  const onDevice = useMemo(() => onDeviceRecognizer(model), [model])
  const ready = modelState.kind === 'ready'

  // a model downloaded before comes from the browser's cache: load it without asking
  useEffect(() => {
    if (engine === 'device' && modelState.kind === 'not-loaded' && modelDownloaded()) void model.load().catch(() => {})
  }, [engine, modelState.kind, model])

  useEffect(() => {
    const wanted = engine === 'browser' ? browser : ready ? onDevice : null
    if (session.createRecognizer !== wanted) session.setRecognizer(wanted)
  }, [engine, ready, browser, onDevice, session])

  const choose = (next: Engine) => {
    setEngine(next)
    try {
      localStorage.setItem(ENGINE_KEY, next)
    } catch {
      // as above
    }
  }

  const download = () => void model.load().catch(() => {})

  return (
    <section className="engine" aria-labelledby="engine-label">
      <div className="engine-row">
        <span id="engine-label">Listening with</span>
        <div className="segmented" role="radiogroup" aria-labelledby="engine-label">
          <button
            role="radio"
            aria-checked={engine === 'browser'}
            disabled={!browser}
            onClick={() => choose('browser')}
          >
            The browser
          </button>
          <button role="radio" aria-checked={engine === 'device'} onClick={() => choose('device')}>
            This device
          </button>
        </div>
      </div>

      {engine === 'browser' && (
        <p className="engine-note">Fast. In Chrome your voice goes to Google’s speech service, so it needs a connection.</p>
      )}

      {engine === 'device' && modelState.kind === 'ready' && (
        <p className="engine-note">Private: your voice never leaves this device, and it works offline.</p>
      )}

      {engine === 'device' && modelState.kind === 'loading' && (
        <div className="engine-note">
          <label htmlFor="model-progress">
            {modelDownloaded() ? 'Loading the speech model…' : 'Downloading the speech model…'}
          </label>
          <progress id="model-progress" max={1} value={modelState.fraction} />
        </div>
      )}

      {engine === 'device' && (modelState.kind === 'not-loaded' || modelState.kind === 'failed') && (
        <div className="engine-note" role={browser ? undefined : 'alert'}>
          <p>
            {modelState.kind === 'failed'
              ? 'The speech model didn’t load. Check the connection and try again.'
              : browser
                ? `A speech model runs on this device: private, and works offline. It’s a ${MODEL_MB} MB download, once.`
                : `This browser has no speech recognition of its own. Download a speech model (${MODEL_MB} MB, once) to read here; it runs on this device and works offline.`}
          </p>
          <button className="ghost" onClick={download}>
            {modelState.kind === 'failed' ? 'Try again' : `Download (${MODEL_MB} MB)`}
          </button>
        </div>
      )}
    </section>
  )
}
