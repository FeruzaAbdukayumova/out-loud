// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS_PER_TEXT,
  _resetForTests,
  addAttempt,
  addText,
  attemptsFor,
  deleteText,
  listCards,
  listTexts,
  updateCards,
  progressByText,
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
