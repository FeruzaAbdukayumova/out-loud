import type { Changes, SyncResponse } from '../../shared/sync'
import { ApiError, NetworkError, type Api } from './api'

/** What the syncer needs from local storage (the library), so it can be tested without IndexedDB. */
export interface LocalStore {
  pendingChanges(): Promise<Changes>
  markSynced(sent: Changes): Promise<void>
  applyRemote(changes: Changes): Promise<void>
  getCursor(): Promise<number>
  setCursor(cursor: number): Promise<void>
  forgetSyncState(): Promise<void>
}

/** Where the session token lives. Same-origin storage; the server is on another site, so cookies wouldn't reach it reliably. */
export interface TokenStore {
  get(): { token: string; email: string } | null
  set(session: { token: string; email: string } | null): void
}

export type SyncStatus = 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncState {
  email: string | null
  status: SyncStatus
  lastSyncedAt: number | null
}

/** Changes are sent this long after the last one, so a burst of edits goes in one request. */
export const DEBOUNCE_MS = 1500
/** While the app is open, it also checks for changes from other devices this often. */
export const POLL_MS = 5 * 60_000

/**
 * Keeps this device and the server in step: pushes local changes, pulls everyone else's.
 * One sync runs at a time; a sync asked for meanwhile runs straight after.
 */
export class Syncer {
  private state: SyncState
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly api: Api
  private readonly local: LocalStore
  private readonly tokens: TokenStore

  constructor(api: Api, local: LocalStore, tokens: TokenStore) {
    this.api = api
    this.local = local
    this.tokens = tokens
    const session = tokens.get()
    this.state = { email: session?.email ?? null, status: session ? 'idle' : 'signed-out', lastSyncedAt: null }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getState = () => this.state

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  async signUp(email: string, password: string) {
    this.signedIn(await this.api.signUp(email, password))
  }

  async signIn(email: string, password: string) {
    this.signedIn(await this.api.signIn(email, password))
  }

  private signedIn(session: { token: string; email: string }) {
    this.tokens.set(session)
    this.set({ email: session.email, status: 'idle' })
    void this.syncNow()
  }

  /** Signs out on this device. The data stays here. */
  async signOut() {
    const session = this.tokens.get()
    this.tokens.set(null)
    clearTimeout(this.timer)
    await this.local.forgetSyncState()
    this.set({ email: null, status: 'signed-out', lastSyncedAt: null })
    // telling the server is a courtesy; the token is gone from here either way
    if (session) await this.api.signOut(session.token).catch(() => {})
  }

  /** Deletes the account and everything on the server. The data on this device stays. */
  async deleteAccount() {
    const session = this.tokens.get()
    if (!session) return
    await this.api.deleteAccount(session.token)
    this.tokens.set(null)
    await this.local.forgetSyncState()
    this.set({ email: null, status: 'signed-out', lastSyncedAt: null })
  }

  /** Something changed here: sync shortly. */
  schedule() {
    if (!this.tokens.get()) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.syncNow(), DEBOUNCE_MS)
  }

  syncNow(): Promise<void> {
    if (!this.tokens.get()) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.run().finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        void this.syncNow()
      }
    })
    return this.running
  }

  private async run() {
    this.set({ status: 'syncing' })
    try {
      let res: SyncResponse
      do {
        const session = this.tokens.get()
        if (!session) return
        const sent = await this.local.pendingChanges()
        res = await this.api.sync(session.token, { cursor: await this.local.getCursor(), ...sent })
        await this.local.markSynced(sent)
        await this.local.applyRemote(res)
        await this.local.setCursor(res.cursor)
      } while (res.more)
      this.set({ status: 'idle', lastSyncedAt: Date.now() })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // the session ended (expired, or signed out elsewhere)
        this.tokens.set(null)
        this.set({ email: null, status: 'signed-out' })
      } else {
        this.set({ status: e instanceof NetworkError ? 'offline' : 'error' })
      }
    }
  }

  /** Syncs when the app comes back into view or online, and every few minutes while open. */
  start(): () => void {
    const onVisible = () => document.visibilityState === 'visible' && void this.syncNow()
    const onOnline = () => void this.syncNow()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    const poll = setInterval(() => document.visibilityState === 'visible' && void this.syncNow(), POLL_MS)
    void this.syncNow()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      clearInterval(poll)
      clearTimeout(this.timer)
    }
  }
}

export function localStorageTokens(key = 'out-loud:session'): TokenStore {
  return {
    get() {
      try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as { token: string; email: string }) : null
      } catch {
        return null
      }
    },
    set(session) {
      try {
        if (session) localStorage.setItem(key, JSON.stringify(session))
        else localStorage.removeItem(key)
      } catch {
        // private mode: signed in for this visit only
      }
    },
  }
}
