// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS_PER_TEXT,
  _resetForTests,
  addAttempt,
  addText,
  applyRemote,
  attemptsFor,
  deleteText,
  forgetSyncState,
  getCursor,
  listCards,
  listTexts,
  markSynced,
  pendingChanges,
  progressByText,
  setCursor,
  updateCards,
} from './library'
import { BUILT_IN } from './texts'

beforeEach(async () => {
  await _resetForTests()
  globalThis.indexedDB = new IDBFactory()
})

const attempt = (textId: string, score: number) => ({ textId, score, read: 10, total: 10, practice: [] })

describe('texts', () => {
  it('lists the built-in texts, then the reader’s own in the order they were added', async () => {
    await addText('  First  ', ' One two three. ')
    await addText('Second', 'Four five six.')
    const texts = await listTexts()
    expect(texts.slice(0, BUILT_IN.length)).toEqual(BUILT_IN)
    expect(texts.slice(BUILT_IN.length).map((t) => [t.title, t.body])).toEqual([
      ['First', 'One two three.'],
      ['Second', 'Four five six.'],
    ])
  })

  it('deletes a text along with its attempts, leaving others alone', async () => {
    const mine = await addText('Mine', 'Hello there.')
    await addAttempt(attempt(mine.id, 80))
    await addAttempt(attempt('shop', 90))
    await deleteText(mine.id)

    expect((await listTexts()).some((t) => t.id === mine.id)).toBe(false)
    expect(await attemptsFor(mine.id)).toEqual([])
    expect(await attemptsFor('shop')).toHaveLength(1)
  })
})

describe('attempts', () => {
  it('tracks the last and best score per text', async () => {
    await addAttempt(attempt('shop', 70))
    await addAttempt(attempt('shop', 95))
    await addAttempt(attempt('shop', 85))
    await addAttempt(attempt('morning', 60))
    const progress = await progressByText()
    expect(progress.get('shop')).toEqual({ last: 85, best: 95, count: 3 })
    expect(progress.get('morning')).toEqual({ last: 60, best: 60, count: 1 })
    expect(progress.has('family')).toBe(false)
  })

  it(`keeps only the newest ${MAX_ATTEMPTS_PER_TEXT} attempts per text`, async () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_TEXT + 5; i++) await addAttempt(attempt('shop', i))
    const kept = await attemptsFor('shop')
    expect(kept).toHaveLength(MAX_ATTEMPTS_PER_TEXT)
    expect(kept[0].score).toBe(5)
    expect(kept.at(-1)?.score).toBe(MAX_ATTEMPTS_PER_TEXT + 4)
  })
})

describe('practice cards', () => {
  it('adds, replaces and removes cards', async () => {
    const card = (word: string, box = 0) => ({ word, box, due: 0, misses: 1, example: word })
    await updateCards({ put: [card('window'), card('blue')], remove: [] })
    await updateCards({ put: [card('window', 2)], remove: ['blue'] })
    expect(await listCards()).toEqual([card('window', 2)])
  })
})

it('upgrades a version 2 database, keeping everything and marking it all to sync', async () => {
  const { openDB } = await import('idb')
  const v2 = await openDB('out-loud', 2, {
    upgrade(d) {
      d.createObjectStore('texts', { keyPath: 'id' })
      d.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true }).createIndex('byText', 'textId')
      d.createObjectStore('cards', { keyPath: 'word' })
    },
  })
  await v2.put('texts', { id: 'u:1', title: 'Old', body: 'Old text.', createdAt: 1 })
  await v2.add('attempts', { textId: 'u:1', at: 1, score: 70, read: 2, total: 2, practice: ['old'] })
  await v2.add('attempts', { textId: 'u:1', at: 2, score: 90, read: 2, total: 2, practice: [] })
  await v2.put('cards', { word: 'old', box: 1, due: 5, misses: 1, example: 'Old text.' })
  v2.close()

  expect((await attemptsFor('u:1')).map((a) => a.score)).toEqual([70, 90])
  expect(await listCards()).toEqual([{ word: 'old', box: 1, due: 5, misses: 1, example: 'Old text.' }])
  const pending = await pendingChanges()
  expect([pending.texts.length, pending.attempts.length, pending.cards.length]).toEqual([1, 2, 1])
  expect(new Set(pending.attempts.map((a) => a.id)).size).toBe(2)
})

it('upgrades a version 1 database without losing texts or scores', async () => {
  const { openDB } = await import('idb')
  const v1 = await openDB('out-loud', 1, {
    upgrade(d) {
      d.createObjectStore('texts', { keyPath: 'id' })
      d.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true }).createIndex('byText', 'textId')
    },
  })
  await v1.put('texts', { id: 'u:1', title: 'Old', body: 'Old text.', createdAt: 1 })
  await v1.add('attempts', { textId: 'u:1', at: 1, score: 70, read: 2, total: 2, practice: [] })
  v1.close()

  expect((await listTexts()).at(-1)?.title).toBe('Old')
  expect((await progressByText()).get('u:1')?.best).toBe(70)
  expect(await listCards()).toEqual([])
})

describe('sync bookkeeping', () => {
  it('lists what changed here, and stops once the server has it', async () => {
    const text = await addText('Mine', 'Hello there.')
    await updateCards({ put: [{ word: 'hello', box: 0, due: 0, misses: 1, example: 'Hello there.' }], remove: [] })
    const pending = await pendingChanges()
    expect(pending.texts).toEqual([expect.objectContaining({ id: text.id, deleted: false })])
    expect(pending.cards).toHaveLength(1)
    expect(pending.texts[0]).not.toHaveProperty('dirty')

    await markSynced(pending)
    expect(await pendingChanges()).toEqual({ texts: [], attempts: [], cards: [] })
  })

  it('keeps a change made while a sync was on its way', async () => {
    await updateCards({ put: [{ word: 'hello', box: 0, due: 0, misses: 1, example: '' }], remove: [] })
    const sent = await pendingChanges()
    await new Promise((r) => setTimeout(r, 2))
    await updateCards({ put: [{ word: 'hello', box: 1, due: 0, misses: 1, example: '' }], remove: [] })
    await markSynced(sent)
    expect((await pendingChanges()).cards).toEqual([expect.objectContaining({ word: 'hello', box: 1 })])
  })

  it('sends deletes as tombstones and hides them here', async () => {
    const text = await addText('Mine', 'Hello there.')
    await addAttempt(attempt(text.id, 50))
    await markSynced(await pendingChanges())
    await deleteText(text.id)

    expect((await listTexts()).some((t) => t.id === text.id)).toBe(false)
    const pending = await pendingChanges()
    expect(pending.texts).toEqual([expect.objectContaining({ id: text.id, deleted: true })])
    expect(pending.attempts).toEqual([expect.objectContaining({ textId: text.id, deleted: true })])
  })

  it('takes newer changes from other devices, but not over a newer one made here', async () => {
    const card = (box: number, updatedAt: number) => ({ word: 'hello', box, due: 0, misses: 1, example: '', updatedAt, deleted: false })
    await applyRemote({ texts: [], attempts: [], cards: [card(2, 100)] })
    expect(await listCards()).toEqual([expect.objectContaining({ box: 2 })])
    expect((await pendingChanges()).cards).toEqual([])

    await updateCards({ put: [{ word: 'hello', box: 3, due: 0, misses: 1, example: '' }], remove: [] }) // now, newer
    await applyRemote({ texts: [], attempts: [], cards: [card(1, 200)] })
    expect(await listCards()).toEqual([expect.objectContaining({ box: 3 })])
  })

  it('applies a delete from another device', async () => {
    const text = await addText('Mine', 'Hello there.')
    await applyRemote({
      texts: [{ ...text, createdAt: text.createdAt!, updatedAt: Date.now() + 1000, deleted: true }],
      attempts: [],
      cards: [],
    })
    expect((await listTexts()).some((t) => t.id === text.id)).toBe(false)
  })

  it('after signing out, keeps the data and marks it all to send again', async () => {
    await addText('Mine', 'Hello there.')
    await markSynced(await pendingChanges())
    await setCursor(42)
    await forgetSyncState()
    expect(await getCursor()).toBe(0)
    expect((await pendingChanges()).texts).toHaveLength(1)
    expect((await listTexts()).at(-1)?.title).toBe('Mine')
  })
})
