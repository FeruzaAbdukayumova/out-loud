import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Changes, SyncRequest, SyncResponse } from '../../shared/sync'
import { ApiError, NetworkError, type Api } from './api'
import { DEBOUNCE_MS, Syncer, type LocalStore, type TokenStore } from './syncer'

const none = (): Changes => ({ texts: [], attempts: [], cards: [] })
const card = (word: string) => ({ word, box: 0, due: 0, misses: 1, example: '', updatedAt: 1, deleted: false })

function setup({ signedIn = true } = {}) {
  let session: { token: string; email: string } | null = signedIn ? { token: 't', email: 'me@example.com' } : null
  const tokens: TokenStore = { get: () => session, set: (s) => (session = s) }
  const calls: string[] = []
  interface FakeLocal extends LocalStore {
    pending: Changes
    cursor: number
    applied: Changes[]
  }
  const local: FakeLocal = {
    pending: none(),
    cursor: 0,
    applied: [] as Changes[],
    pendingChanges: vi.fn(async () => local.pending),
    markSynced: vi.fn(async () => {
      calls.push('markSynced')
      local.pending = none()
    }),
    applyRemote: vi.fn(async (c: Changes) => {
      calls.push('applyRemote')
      local.applied.push(c)
    }),
    getCursor: vi.fn(async () => local.cursor),
    setCursor: vi.fn(async (c: number) => {
      local.cursor = c
    }),
    forgetSyncState: vi.fn(async () => {}),
  }
  const responses: (SyncResponse | Error)[] = []
  const requests: SyncRequest[] = []
  const api: Api = {
    signUp: vi.fn(async (email) => ({ token: 'new', email })),
    signIn: vi.fn(async (email) => ({ token: 'new', email })),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    sync: vi.fn(async (_token, req) => {
      requests.push(req)
      calls.push('sync')
      const next = responses.shift() ?? { ...none(), cursor: req.cursor, more: false }
      if (next instanceof Error) throw next
      return next
    }),
  }
  return { syncer: new Syncer(api, local, tokens), api, local, tokens, responses, requests, calls }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Syncer', () => {
  it('pushes what changed here, then takes in what changed elsewhere', async () => {
    const { syncer, local, responses, requests, calls } = setup()
    local.pending = { ...none(), cards: [card('mine')] }
    local.cursor = 7
    responses.push({ ...none(), cards: [card('theirs')], cursor: 9, more: false })

    await syncer.syncNow()

    expect(requests).toEqual([{ cursor: 7, ...none(), cards: [card('mine')] }])
    expect(calls).toEqual(['sync', 'markSynced', 'applyRemote'])
    expect(local.applied[0].cards).toEqual([card('theirs')])
    expect(local.cursor).toBe(9)
    expect(syncer.getState()).toMatchObject({ status: 'idle', email: 'me@example.com' })
    expect(syncer.getState().lastSyncedAt).not.toBeNull()
  })

  it('keeps going while the server has more', async () => {
    const { syncer, local, responses, requests } = setup()
    responses.push({ ...none(), cursor: 5, more: true }, { ...none(), cursor: 8, more: false })
    await syncer.syncNow()
    expect(requests.map((r) => r.cursor)).toEqual([0, 5])
    expect(local.cursor).toBe(8)
  })

  it('runs one sync at a time, and one more if asked meanwhile', async () => {
    const { syncer, api } = setup()
    const first = syncer.syncNow()
    void syncer.syncNow()
    void syncer.syncNow()
    await first
    await vi.waitFor(() => expect(api.sync).toHaveBeenCalledTimes(2))
  })

  it('waits for a burst of changes to end before syncing', async () => {
    const { syncer, api } = setup()
    syncer.schedule()
    vi.advanceTimersByTime(DEBOUNCE_MS - 100)
    syncer.schedule()
    vi.advanceTimersByTime(DEBOUNCE_MS - 100)
    expect(api.sync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    await vi.waitFor(() => expect(api.sync).toHaveBeenCalledTimes(1))
  })

  it('says it is offline when the server cannot be reached, and leaves the changes pending', async () => {
    const { syncer, local, responses } = setup()
    local.pending = { ...none(), cards: [card('mine')] }
    responses.push(new NetworkError())
    await syncer.syncNow()
    expect(syncer.getState().status).toBe('offline')
    expect(local.markSynced).not.toHaveBeenCalled()
    expect(local.pending.cards).toHaveLength(1)
  })

  it('signs out here when the server says the session is over', async () => {
    const { syncer, tokens, responses } = setup()
    responses.push(new ApiError(401, 'signed-out'))
    await syncer.syncNow()
    expect(syncer.getState()).toMatchObject({ status: 'signed-out', email: null })
    expect(tokens.get()).toBeNull()
  })

  it('does nothing while signed out', async () => {
    const { syncer, api } = setup({ signedIn: false })
    syncer.schedule()
    await syncer.syncNow()
    vi.advanceTimersByTime(DEBOUNCE_MS)
    expect(api.sync).not.toHaveBeenCalled()
  })

  it('signs in and syncs straight away', async () => {
    const { syncer, api, tokens } = setup({ signedIn: false })
    await syncer.signIn('me@example.com', 'secret password')
    expect(tokens.get()).toEqual({ token: 'new', email: 'me@example.com' })
    await vi.waitFor(() => expect(api.sync).toHaveBeenCalledWith('new', expect.anything()))
  })

  it('passes on a wrong password without signing in', async () => {
    const { syncer, api, tokens } = setup({ signedIn: false })
    vi.mocked(api.signIn).mockRejectedValueOnce(new ApiError(401, 'wrong-credentials'))
    await expect(syncer.signIn('me@example.com', 'nope')).rejects.toMatchObject({ code: 'wrong-credentials' })
    expect(tokens.get()).toBeNull()
    expect(syncer.getState().status).toBe('signed-out')
  })

  it('signs out: forgets the token and the sync position, tells the server', async () => {
    const { syncer, api, local, tokens } = setup()
    await syncer.signOut()
    expect(tokens.get()).toBeNull()
    expect(local.forgetSyncState).toHaveBeenCalled()
    expect(api.signOut).toHaveBeenCalledWith('t')
    expect(syncer.getState().status).toBe('signed-out')
  })

  it('signs out even when the server cannot be told', async () => {
    const { syncer, api } = setup()
    vi.mocked(api.signOut).mockRejectedValueOnce(new NetworkError())
    await syncer.signOut()
    expect(syncer.getState().status).toBe('signed-out')
  })
})
