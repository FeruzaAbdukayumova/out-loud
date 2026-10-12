import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { BUILT_IN, type Text } from './texts'

/** One reading of a text, as it was scored. */
export interface Attempt {
  id?: number
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

interface LibrarySchema extends DBSchema {
  texts: { key: string; value: Text }
  attempts: { key: number; value: Attempt; indexes: { byText: string } }
}

let db: Promise<IDBPDatabase<LibrarySchema>> | null = null

function open() {
  db ??= openDB<LibrarySchema>('out-loud', 1, {
    upgrade(d) {
      d.createObjectStore('texts', { keyPath: 'id' })
      d.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true }).createIndex('byText', 'textId')
    },
  })
  return db
}

/** The built-in texts, then the reader's own, oldest first. */
export async function listTexts(): Promise<Text[]> {
  const own = await (await open()).getAll('texts')
  return [...BUILT_IN, ...own.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))]
}

export async function addText(title: string, body: string): Promise<Text> {
  const text: Text = { id: 'u:' + crypto.randomUUID(), title: title.trim(), body: body.trim(), createdAt: Date.now() }
  await (await open()).put('texts', text)
  return text
}

/** Removes one of the reader's own texts, with its attempts. */
export async function deleteText(id: string): Promise<void> {
  const d = await open()
  const tx = d.transaction(['texts', 'attempts'], 'readwrite')
  await tx.objectStore('texts').delete(id)
  const attempts = tx.objectStore('attempts')
  for (const key of await attempts.index('byText').getAllKeys(id)) await attempts.delete(key)
  await tx.done
}

export async function addAttempt(attempt: Omit<Attempt, 'id' | 'at'>): Promise<void> {
  const d = await open()
  const tx = d.transaction('attempts', 'readwrite')
  await tx.store.add({ ...attempt, at: Date.now() })
  const keys = await tx.store.index('byText').getAllKeys(attempt.textId)
  // ids only grow, so the smallest are the oldest
  for (const key of keys.sort((a, b) => a - b).slice(0, -MAX_ATTEMPTS_PER_TEXT)) await tx.store.delete(key)
  await tx.done
}

export async function attemptsFor(textId: string): Promise<Attempt[]> {
  const all = await (await open()).getAllFromIndex('attempts', 'byText', textId)
  return all.sort((a, b) => a.at - b.at || a.id! - b.id!)
}

/** Last and best score for every text that has been read. */
export async function progressByText(): Promise<Map<string, Progress>> {
  const all = await (await open()).getAll('attempts')
  const map = new Map<string, Progress>()
  for (const a of all.sort((x, y) => x.at - y.at || x.id! - y.id!)) {
    const p = map.get(a.textId)
    map.set(a.textId, { last: a.score, best: Math.max(p?.best ?? 0, a.score), count: (p?.count ?? 0) + 1 })
  }
  return map
}

export async function _resetForTests(): Promise<void> {
  if (db) (await db).close()
  db = null
}
