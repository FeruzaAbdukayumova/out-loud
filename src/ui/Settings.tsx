import { useEffect } from 'react'
import type { SpeechModel } from '../speech/onDevice/model'
import type { ReadingSession } from '../speech/session'
import type { Syncer } from '../sync/syncer'
import { AccountBar } from './Account'
import { RecognitionChoice } from './RecognitionChoice'
import { ThemePicker } from './ThemePicker'

interface Props {
  open: boolean
  onClose: () => void
  session: ReadingSession
  model: SpeechModel
  syncer: Syncer | null
  onAccount: () => void
}

/**
 * Everything that isn't reading. It stays mounted while closed: the listening choice
 * keeps the session's recogniser in step even when nobody is looking at it.
 */
export function Settings({ open, onClose, session, model, syncer, onAccount }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div
      className="sheet"
      hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheetin">
        <h2 id="settings-title">Settings</h2>
        <RecognitionChoice session={session} model={model} browser={session.builtInRecognizer} />
        <ThemePicker />
        {syncer && <AccountBar syncer={syncer} onOpen={onAccount} />}
        <div className="sheet-actions">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
