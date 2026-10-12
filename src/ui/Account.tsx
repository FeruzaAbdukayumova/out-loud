import { useEffect, useRef, useState } from 'react'
import { ApiError, NetworkError } from '../sync/api'
import type { SyncState, Syncer } from '../sync/syncer'
import { useSyncState } from './hooks'

function statusLine({ status, lastSyncedAt }: SyncState): string {
  if (status === 'syncing') return 'Syncing…'
  if (status === 'offline') return 'Offline — will sync when you’re back online'
  if (status === 'error') return 'Couldn’t sync — will try again'
  return lastSyncedAt ? 'Synced' : 'Signed in'
}

/** The header's account button: "Sign in", or the reader's initial with a dot for how syncing is going. */
export function AccountButton({ syncer, onOpen }: { syncer: Syncer; onOpen: () => void }) {
  const state = useSyncState(syncer)
  if (!state.email) {
    return (
      <button className="sign-in" onClick={onOpen}>
        Sign in
      </button>
    )
  }
  return (
    <>
      <button className="avatar" aria-label={state.email} title={`${state.email} · ${statusLine(state)}`} onClick={onOpen}>
        {state.email[0].toUpperCase()}
        <span className={'sync-dot ' + state.status} aria-hidden="true" />
      </button>
      <span className="visually-hidden" aria-live="polite">
        {statusLine(state)}
      </span>
    </>
  )
}

const MESSAGES: Record<string, string> = {
  'wrong-credentials': 'That email and password don’t match.',
  'email-taken': 'There’s already an account with that email. Sign in instead.',
  'too-many': 'Too many tries. Wait a few minutes, then try again.',
  invalid: 'Check the email, and use at least 8 characters for the password.',
  network: 'Can’t reach the server. Check the internet and try again.',
}
const messageFor = (e: unknown) =>
  e instanceof NetworkError ? MESSAGES.network : e instanceof ApiError ? (MESSAGES[e.code] ?? 'Something went wrong. Try again.') : 'Something went wrong. Try again.'

/** The free server sleeps when idle; say so if a request is slow, so it doesn't look broken. */
const WAKING_AFTER_MS = 3000

export function AccountSheet({ syncer, onClose }: { syncer: Syncer; onClose: () => void }) {
  const state = useSyncState(syncer)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [waking, setWaking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (action: () => Promise<void>, closeAfter = true) => {
    setBusy(true)
    setError('')
    const wake = setTimeout(() => setWaking(true), WAKING_AFTER_MS)
    try {
      await action()
      if (closeAfter) onClose()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      clearTimeout(wake)
      setWaking(false)
      setBusy(false)
    }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {state.email ? (
        <div className="sheetin">
          <h2 id="account-title">Your account</h2>
          <p className="sheet-note">
            Signed in as <b>{state.email}</b>. Your texts, scores and practice words sync to every device you sign in on.
          </p>
          <p className="sync-line">
            <span className={'sync-dot ' + state.status} aria-hidden="true" />
            {statusLine(state)}
          </p>
          <div className="sheet-actions start">
            <button className="ghost" disabled={busy} onClick={() => void run(() => syncer.syncNow(), false)}>
              Sync now
            </button>
            <button className="ghost" disabled={busy} onClick={() => void run(() => syncer.signOut())}>
              Sign out
            </button>
          </div>
          <p className="sheet-note small">
            Signing out keeps everything on this device. Deleting the account removes it from the server; this device keeps its copy.
          </p>
          <div className="sheet-actions start">
            <button
              className="ghost danger"
              disabled={busy}
              onBlur={() => setConfirmDelete(false)}
              onClick={() => (confirmDelete ? void run(() => syncer.deleteAccount()) : setConfirmDelete(true))}
            >
              {confirmDelete ? 'Tap again to delete the account' : 'Delete account'}
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {waking && <p className="sheet-note small">Waking the server — the first request after a quiet spell can take up to a minute.</p>}
          <div className="sheet-actions">
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          className="sheetin"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => (mode === 'signin' ? syncer.signIn(email, password) : syncer.signUp(email, password)))
          }}
        >
          <h2 id="account-title">{mode === 'signin' ? 'Sign in to sync' : 'Create an account'}</h2>
          <p className="sheet-note">Keep your texts, scores and practice words in step across your phone and computer.</p>
          <label className="field">
            Email
            <input ref={first} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode === 'signup' && <span className="count">At least 8 characters</span>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {waking && <p className="sheet-note small">Waking the server — the first request after a quiet spell can take up to a minute.</p>}
          <div className="sheet-actions">
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setError('')
              }}
            >
              {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
