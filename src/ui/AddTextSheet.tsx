import { useEffect, useRef, useState } from 'react'
import { MAX_TITLE, MAX_WORDS } from '../library/texts'
import { countWords } from '../reading/text'

interface Props {
  onSave: (title: string, body: string) => void
  onClose: () => void
}

export function AddTextSheet({ onSave, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const words = countWords(body)
  const tooLong = words > MAX_WORDS
  const ok = title.trim() !== '' && words >= 3 && !tooLong
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="add-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="sheetin"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) onSave(title, body)
        }}
      >
        <h2 id="add-title">Add your own text</h2>
        <label className="field">
          Title
          <input ref={titleRef} value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lesson 4" />
        </label>
        <label className="field">
          Text
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste or type the text you want to practise." />
        </label>
        <span className={'count' + (tooLong ? ' over' : '')} aria-live="polite">
          {words} / {MAX_WORDS} words
        </span>
        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ok}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
