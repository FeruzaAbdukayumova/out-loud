import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePassage } from '../reading/text'
import { fakeRecognizer } from '../test/fakeRecognizer'
import { PAUSE_END_MS, PAUSE_MID_MS, ReadingSession } from './session'

const TEXT = parsePassage('The shop is near my house. I buy milk and eggs.')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup() {
  const rec = fakeRecognizer()
  const stopMeter = vi.fn()
  const session = new ReadingSession({ createRecognizer: rec.create, startMeter: () => stopMeter })
  session.load(TEXT)
  return { rec, session, stopMeter }
}

describe('ReadingSession', () => {
  it('marks words as they are heard', () => {
    const { rec, session } = setup()
    session.start()
    expect(session.getState()).toMatchObject({ listening: true, status: { kind: 'listening' } })

    rec.hear('the shop is near')
    const { marks, reached } = session.getState()
    expect(marks.slice(0, 5)).toEqual(['ok', 'ok', 'ok', 'ok', ''])
    expect(reached).toBe(3)
  })

  it('finishes on its own after a long pause mid-text, counting down first', () => {
    const { rec, session, stopMeter } = setup()
    session.start()
    rec.hear('the shop is near my house')

    vi.advanceTimersByTime(PAUSE_MID_MS - 2000)
    expect(session.getState().status).toEqual({ kind: 'finishing-in', seconds: 2 })
    vi.advanceTimersByTime(2000)

    const { listening, status, marks } = session.getState()
    expect(listening).toBe(false)
    expect(rec.running).toBe(false)
    expect(stopMeter).toHaveBeenCalled()
    expect(status).toMatchObject({ kind: 'done', summary: { score: 100, read: 6, total: 11 } })
    expect(marks.slice(6)).toEqual(['', '', '', '', ''])
  })

  it('keeps listening while the reader keeps reading', () => {
    const { rec, session } = setup()
    session.start()
    const words = 'the shop is near my house I buy milk'.split(' ')
    words.forEach((_, n) => {
      vi.advanceTimersByTime(PAUSE_MID_MS - 500)
      rec.hear(words.slice(0, n + 1).join(' '))
    })
    expect(session.getState().listening).toBe(true)
  })

  it('finishes sooner once the last word is read', () => {
    const { rec, session } = setup()
    session.start()
    rec.hear('the shop is near my house I buy milk and eggs')
    vi.advanceTimersByTime(300)
    expect(session.getState().status).toEqual({ kind: 'at-end' })
    vi.advanceTimersByTime(PAUSE_END_MS)
    expect(session.getState().status).toMatchObject({ kind: 'done', summary: { score: 100 } })
  })

  it('keeps what was heard when the recogniser restarts by itself', () => {
    const { rec, session } = setup()
    session.start()
    rec.hear('the shop is near my') // still interim when it ends
    vi.advanceTimersByTime(2000)
    rec.end()
    expect(rec.starts).toBe(2)
    rec.hear('house I buy milk and eggs')
    session.stop()
    expect(session.getState().status).toMatchObject({ kind: 'done', summary: { score: 100, read: 11 } })
  })

  it('gives up if the recogniser keeps stopping straight away', () => {
    const { rec, session } = setup()
    session.start()
    rec.end()
    rec.end()
    rec.end()
    expect(session.getState()).toMatchObject({ listening: false, status: { kind: 'problem', problem: 'keeps-stopping' } })
  })

  it('reports a blocked microphone and stops', () => {
    const { rec, session, stopMeter } = setup()
    session.start()
    rec.handlers!.onProblem('blocked')
    expect(session.getState()).toMatchObject({ listening: false, status: { kind: 'problem', problem: 'blocked' } })
    expect(rec.running).toBe(false)
    expect(stopMeter).toHaveBeenCalled()
  })

  it('says so when it could not start listening', () => {
    const { rec, session } = setup()
    rec.failNextStart = true
    session.start()
    expect(session.getState()).toMatchObject({ listening: false, status: { kind: 'problem', problem: 'could-not-start' } })
  })

  it('says it heard nothing rather than scoring an empty reading', () => {
    const { session } = setup()
    session.start()
    vi.advanceTimersByTime(PAUSE_MID_MS)
    expect(session.getState().status).toEqual({ kind: 'heard-nothing' })
  })

  it('waits to mark a skipped word right behind the reader until reading is over', () => {
    const { rec, session } = setup()
    session.start()
    rec.hear('the shop is near my house I milk')
    expect(session.getState().marks).not.toContain('retry')
    session.stop()
    expect(session.getState().marks[7]).toBe('retry') // "buy"
  })

  it('drops a reading in progress when another text is loaded', () => {
    const { rec, session } = setup()
    session.start()
    rec.hear('the shop')
    session.load(parsePassage('Another text'))
    expect(rec.running).toBe(false)
    expect(session.getState()).toEqual({ listening: false, marks: ['', ''], reached: -1, status: { kind: 'ready' } })
  })

  it('cannot start without speech recognition', () => {
    const session = new ReadingSession({ createRecognizer: null })
    session.load(TEXT)
    session.start()
    expect(session.supported).toBe(false)
    expect(session.getState().listening).toBe(false)
  })
})
