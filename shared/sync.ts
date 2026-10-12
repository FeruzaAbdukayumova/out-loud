/**
 * The sync contract between the app and the server. Types only, so both sides can import it
 * without pulling in each other's dependencies. The server validates it at runtime with zod.
 *
 * Every synced record carries `updatedAt` (client clock, ms) and `deleted` (a tombstone, so a
 * delete on one device reaches the others). The newer `updatedAt` wins.
 */

export interface SyncedText {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
  deleted: boolean
}

export interface SyncedAttempt {
  id: string
  textId: string
  at: number
  score: number
  read: number
  total: number
  practice: string[]
  updatedAt: number
  deleted: boolean
}

export interface SyncedCard {
  word: string
  box: number
  due: number
  misses: number
  example: string
  updatedAt: number
  deleted: boolean
}

export interface Changes {
  texts: SyncedText[]
  attempts: SyncedAttempt[]
  cards: SyncedCard[]
}

export interface SyncRequest extends Changes {
  /** The server's cursor from the last sync; 0 the first time. */
  cursor: number
}

export interface SyncResponse extends Changes {
  /** Pass back next time to get only what changed since. */
  cursor: number
  /** More changes are waiting: sync again straight away. */
  more: boolean
}

export interface SessionResponse {
  token: string
  email: string
}
