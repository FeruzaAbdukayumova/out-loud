import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'
import type { Changes, SyncedAttempt, SyncedCard, SyncedText } from '../../shared/sync'
import type { Card } from '../practice/schedule'
import { BUILT_IN, type Text } from './texts'

/** One reading of a text, as it was scored. */
export interface Attempt {
  id: string
  textId: string
  at: number
  score: number
  read: number
  total: number
  /** Words that weren't clear, in reading order. */
  practice: string[]
}

export interface Progress {
  last: number
  best: number
  count: number
}

/** Older attempts at a text are dropped past this. */
export const MAX_ATTEMPTS_PER_TEXT = 20

/**
 * What every stored record carries for sync: when it last changed, whether it's a deletion
 * (kept as a tombstone until other devices have heard about it), and whether this device has
 * changes the server hasn't seen. `dirty` is 0/1 rather than a boolean because IndexedDB can't
 * index booleans.
 */
interface Tracked {
  updatedAt: number
  deleted: boolean
  dirty: 0 | 1
}
type StoredText = SyncedText & Tracked
type StoredAttempt = SyncedAttempt & Tracked
type StoredCard = SyncedCard & Tracked

interface LibrarySchema extends DBSchema {
  texts: { key: string; value: StoredText; indexes: { dirty: number } }
  /** Version 3 replaced the auto-numbered `attempts` store: ids are now made on the device, so they're unique across devices. */
  history: { key: string; value: StoredAttempt; indexes: { byText: string; dirty: number } }
  cards: { key: string; value: StoredCard; indexes: { dirty: number } }
  meta: { key: string; value: unknown }
}

let db: Promise<IDBPDatabase<LibrarySchema>> | null = null

function open() {
  db ??= openDB<LibrarySchema>('out-loud', 3, {
    async upgrade(d, from, _to, tx) {
      // v1: texts + attempts. v2: + cards. v3: sync fields everywhere, attempts → history, + meta.
      const untyped = d as unknown as IDBPDatabase
      const utx = tx as unknown as IDBPTransaction<unknown, string[], 'versionchange'>
      if (from < 1) {
        untyped.createObjectStore('texts', { keyPath: 'id' })
        untyped.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true }).createIndex('byText', 'textId')
      }
      if (from < 2) untyped.createObjectStore('cards', { keyPath: 'word' })
      if (from < 3) {
        const now = Date.now()
        // everything already here is new to the server
        const track = <T extends object>(v: T) => ({ ...v, updatedAt: now, deleted: false, dirty: 1 as const })

        tx.objectStore('texts').createIndex('dirty', 'dirty')
        for (const t of (await utx.objectStore('texts').getAll()) as Text[]) {
          await utx.objectStore('texts').put(track({ id: t.id, title: t.title, body: t.body, createdAt: t.createdAt ?? now }))
        }
        tx.objectStore('cards').createIndex('dirty', 'dirty')
        for (const c of (await utx.objectStore('cards').getAll()) as Card[]) await utx.objectStore('cards').put(track(c))

        const history = d.createObjectStore('history', { keyPath: 'id' })
        history.createIndex('byText', 'textId')
        history.createIndex('dirty', 'dirty')
        const old = (await utx.objectStore('attempts').getAll()) as (Omit<Attempt, 'id'> & { id: number })[]
        for (const { id: _old, ...a } of old) await history.put(track({ ...a, id: crypto.randomUUID() }))
        untyped.deleteObjectStore('attempts')

        d.createObjectStore('meta')
      }
    },
  })
  return db
}

// ---------- change notifications ----------

type Listener = () => void
const localListeners = new Set<Listener>()
const remoteListeners = new Set<Listener>()
/** Something changed on this device (so there's something to sync). */
export const onLocalChange = (fn: Listener) => (localListeners.add(fn), () => void localListeners.delete(fn))
/** Changes from another device arrived (so the screen should reload what it shows). */
export const onRemoteChange = (fn: Listener) => (remoteListeners.add(fn), () => void remoteListeners.delete(fn))
const changedHere = () => localListeners.forEach((fn) => fn())

const fresh = () => ({ updatedAt: Date.now(), deleted: false, dirty: 1 as const })
const removed = () => ({ updatedAt: Date.now(), deleted: true, dirty: 1 as const })

// ---------- texts ----------

/** The built-in texts, then the reader's own, oldest first. */
export async function listTexts(): Promise<Text[]> {
  const own = (await (await open()).getAll('texts')).filter((t) => !t.deleted)
  own.sort((a, b) => a.createdAt - b.createdAt)
  return [...BUILT_IN, ...own.map(({ id, title, body, createdAt }) => ({ id, title, body, createdAt }))]
}

export async function addText(title: string, body: string): Promise<Text> {
  const text = { id: 'u:' + crypto.randomUUID(), title: title.trim(), body: body.trim(), createdAt: Date.now() }
  await (await open()).put('texts', { ...text, ...fresh() })
  changedHere()
  return text
}

/** Removes one of the reader's own texts, with its attempts. */
export async function deleteText(id: string): Promise<void> {
  const d = await open()
  const tx = d.transaction(['texts', 'history'], 'readwrite')
  const text = await tx.objectStore('texts').get(id)
  if (text) await tx.objectStore('texts').put({ ...text, body: '', ...removed() })
  const history = tx.objectStore('history')
  for (const a of await history.index('byText').getAll(id)) await history.put({ ...a, ...removed() })
  await tx.done
  changedHere()
}

// ---------- history ----------

/** Attempts are ordered by time, so two in the same millisecond still get distinct times. */
let lastAt = 0

export async function addAttempt(attempt: Omit<Attempt, 'id' | 'at'>): Promise<void> {
  const d = await open()
  const tx = d.transaction('history', 'readwrite')
  lastAt = Math.max(Date.now(), lastAt + 1)
  await tx.store.put({ ...attempt, id: crypto.randomUUID(), at: lastAt, ...fresh() })
  await trimHistory(tx, attempt.textId)
  await tx.done
  changedHere()
}

/**
 * Keeps the newest MAX_ATTEMPTS_PER_TEXT on this device. Old ones are dropped here only, not
 * deleted on the server, so this needn't sync (one never sent is simply never sent).
 */
async function trimHistory(tx: IDBPTransaction<LibrarySchema, ['history'], 'readwrite'>, textId: string) {
  const live = (await tx.store.index('byText').getAll(textId)).filter((a) => !a.deleted)
  const excess = live.length - MAX_ATTEMPTS_PER_TEXT
  if (excess <= 0) return
  for (const a of live.sort((x, y) => x.at - y.at).slice(0, excess)) await tx.store.delete(a.id)
}

export async function attemptsFor(textId: string): Promise<Attempt[]> {
  const all = await (await open()).getAllFromIndex('history', 'byText', textId)
  return all.filter((a) => !a.deleted).sort((a, b) => a.at - b.at).map(toAttempt)
}

const toAttempt = ({ id, textId, at, score, read, total, practice }: StoredAttempt): Attempt => ({ id, textId, at, score, read, total, practice })

/** Last and best score for every text that has been read. */
export async function progressByText(): Promise<Map<string, Progress>> {
  const all = (await (await open()).getAll('history')).filter((a) => !a.deleted)
  const map = new Map<string, Progress>()
  for (const a of all.sort((x, y) => x.at - y.at)) {
    const p = map.get(a.textId)
    map.set(a.textId, { last: a.score, best: Math.max(p?.best ?? 0, a.score), count: (p?.count ?? 0) + 1 })
  }
  return map
}

// ---------- practice cards ----------

export async function listCards(): Promise<Card[]> {
  const all = await (await open()).getAll('cards')
  return all.filter((c) => !c.deleted).map(({ word, box, due, misses, example }) => ({ word, box, due, misses, example }))
}

/** Applies a change to the practice deck in one transaction. */
export async function updateCards({ put, remove }: { put: Card[]; remove: string[] }): Promise<void> {
  const d = await open()
  const tx = d.transaction('cards', 'readwrite')
  for (const card of put) await tx.store.put({ ...card, ...fresh() })
  for (const word of remove) {
    const card = await tx.store.get(word)
    if (card) await tx.store.put({ ...card, ...removed() })
  }
  await tx.done
  changedHere()
}

// ---------- sync ----------

type SyncStore = 'texts' | 'history' | 'cards'
function strip<T extends Tracked>(record: T): Omit<T, 'dirty'> {
  const { dirty, ...rest } = record
  void dirty
  return rest
}

/** Everything changed on this device that the server hasn't seen. */
export async function pendingChanges(): Promise<Changes> {
  const d = await open()
  const [texts, attempts, cards] = await Promise.all([
    d.getAllFromIndex('texts', 'dirty', 1),
    d.getAllFromIndex('history', 'dirty', 1),
    d.getAllFromIndex('cards', 'dirty', 1),
  ])
  return { texts: texts.map(strip), attempts: attempts.map(strip), cards: cards.map(strip) }
}

/** The server has these now; unless they changed again meanwhile, they're no longer pending. */
export async function markSynced(sent: Changes): Promise<void> {
  const d = await open()
  const tx = d.transaction(['texts', 'history', 'cards'], 'readwrite')
  const clear = async (store: SyncStore, records: { updatedAt: number }[], key: (r: never) => string) => {
    const s = tx.objectStore(store)
    for (const r of records) {
      const local = await s.get(key(r as never))
      if (local && local.updatedAt === r.updatedAt) await s.put({ ...local, dirty: 0 } as never)
    }
  }
  await clear('texts', sent.texts, (t: SyncedText) => t.id)
  await clear('history', sent.attempts, (a: SyncedAttempt) => a.id)
  await clear('cards', sent.cards, (c: SyncedCard) => c.word)
  await tx.done
}

/** Takes in changes from other devices. A newer change made here (not yet sent) wins. */
export async function applyRemote(changes: Changes): Promise<void> {
  const count = changes.texts.length + changes.attempts.length + changes.cards.length
  if (!count) return
  const d = await open()
  const tx = d.transaction(['texts', 'history', 'cards'], 'readwrite')
  const merge = async <S extends SyncStore>(store: S, records: LibrarySchema[S]['value'][], key: (r: LibrarySchema[S]['value']) => string) => {
    const s = tx.objectStore(store as SyncStore)
    for (const r of records) {
      const local = (await s.get(key(r))) as Tracked | undefined
      if (!local || r.updatedAt >= local.updatedAt) await s.put({ ...r, dirty: 0 } as never)
    }
  }
  await merge('texts', changes.texts as StoredText[], (t) => t.id)
  await merge('history', changes.attempts as StoredAttempt[], (a) => a.id)
  await merge('cards', changes.cards as StoredCard[], (c) => c.word)
  await tx.done
  remoteListeners.forEach((fn) => fn())
}

export async function getCursor(): Promise<number> {
  return ((await (await open()).get('meta', 'cursor')) as number | undefined) ?? 0
}

export async function setCursor(cursor: number): Promise<void> {
  await (await open()).put('meta', cursor, 'cursor')
}

/**
 * After signing out: the data stays on this device, and it will all be sent again (merging
 * harmlessly) if someone signs in here later.
 */
export async function forgetSyncState(): Promise<void> {
  const d = await open()
  const tx = d.transaction(['texts', 'history', 'cards', 'meta'], 'readwrite')
  for (const store of ['texts', 'history', 'cards'] as const) {
    const s = tx.objectStore(store)
    for (const r of await s.getAll()) await s.put({ ...r, dirty: 1 } as never)
  }
  await tx.objectStore('meta').delete('cursor')
  await tx.done
}

export async function _resetForTests(): Promise<void> {
  if (db) (await db).close()
  db = null
}
