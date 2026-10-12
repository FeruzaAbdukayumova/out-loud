import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncRequest, SyncResponse } from '../../shared/sync'
import * as library from '../library/library'
import { ReadingSession } from '../speech/session'
import { ApiError, type Api } from '../sync/api'
import { Syncer, type TokenStore } from '../sync/syncer'
import { fakeRecognizer } from '../test/fakeRecognizer'
import { App } from './App'

beforeEach(async () => {
  await library._resetForTests()
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
})

function setup() {
  let session: { token: string; email: string } | null = null
  const tokens: TokenStore = { get: () => session, set: (s) => (session = s) }
  const requests: SyncRequest[] = []
  const incoming: SyncResponse[] = []
  const api: Api = {
    signUp: vi.fn(async (email) => ({ token: 'tok', email })),
    signIn: vi.fn(async (email, password) => {
      if (password !== 'right password') throw new ApiError(401, 'wrong-credentials')
      return { token: 'tok', email }
    }),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    sync: vi.fn(async (_t, req) => {
      requests.push(req)
      return incoming.shift() ?? { texts: [], attempts: [], cards: [], cursor: req.cursor, more: false }
    }),
  }
  const syncer = new Syncer(api, library, tokens)
  const user = userEvent.setup()
  render(<App session={new ReadingSession({ createRecognizer: fakeRecognizer().create })} speak={vi.fn()} syncer={syncer} />)
  return { user, api, requests, incoming, syncer }
}

async function signIn(user: ReturnType<typeof userEvent.setup>, password = 'right password') {
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  const dialog = screen.getByRole('dialog', { name: 'Sign in to sync' })
  await user.type(within(dialog).getByLabelText('Email'), 'me@example.com')
  await user.type(within(dialog).getByLabelText('Password'), password)
  await user.click(within(dialog).getByRole('button', { name: 'Sign in' }))
}

describe('accounts and sync', () => {
  it('signs in, uploads what is already on the device, and shows it is synced', async () => {
    await library.addText('Before signing in', 'Some words here.')
    const { user, requests } = setup()
    await signIn(user)

    expect(await screen.findByText('Synced')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'me@example.com' })).toBeInTheDocument()
    expect(requests[0].texts).toEqual([expect.objectContaining({ title: 'Before signing in' })])
  })

  it('explains a wrong password and stays signed out', async () => {
    const { user } = setup()
    await signIn(user, 'wrong password')
    expect(await screen.findByRole('alert')).toHaveTextContent('That email and password don’t match.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows texts that arrive from another device', async () => {
    const { user, incoming } = setup()
    incoming.push({
      texts: [{ id: 'u:other', title: 'From my laptop', body: 'Hello from the laptop.', createdAt: 1, updatedAt: 1, deleted: false }],
      attempts: [],
      cards: [],
      cursor: 3,
      more: false,
    })
    await signIn(user)
    expect(await screen.findByRole('button', { name: 'From my laptop' })).toBeInTheDocument()
  })

  it('sends a new text to the server shortly after it is added', async () => {
    const { user, requests } = setup()
    await signIn(user)
    await screen.findByText('Synced')

    await user.click(screen.getByRole('button', { name: /your own text/i }))
    await user.type(screen.getByLabelText('Title'), 'Lesson 5')
    await user.type(screen.getByLabelText('Text'), 'A short lesson text.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(requests.at(-1)?.texts).toEqual([expect.objectContaining({ title: 'Lesson 5' })]), { timeout: 3000 })
  })

  it('signs out, keeping the texts on this device', async () => {
    await library.addText('Mine', 'Some words here.')
    const { user, api } = setup()
    await signIn(user)
    await user.click(await screen.findByRole('button', { name: 'me@example.com' }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(api.signOut).toHaveBeenCalledWith('tok')
    expect(screen.getByRole('button', { name: 'Mine' })).toBeInTheDocument()
  })
})
