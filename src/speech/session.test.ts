import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePassage } from '../reading/text'
import { fakeRecognizer } from '../test/fakeRecognizer'
import { CATCH_UP_MS, PAUSE_END_MS, PAUSE_MID_MS, ReadingSession, VOICE_WITHOUT_WORDS_MS } from './session'

const TEXT = parsePassage('The shop is near my house. I buy milk and eggs.')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup() {
  const rec = fakeRecognizer()
  const stopMeter = vi.fn()
  let level = (_: number) => {}
  const session = new ReadingSession({
    createRecognizer: rec.create,
    startMeter: (onLevel) => {
      level = onLevel
      return stopMeter
    },
  })
  session.load(TEXT)
  /** The microphone hears this loud a sound, every 100 ms for `ms`. */
  const sound = (loudness: number, ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      level(loudness)
      vi.advanceTimersByTime(100)
    }
  }
  return { rec, session, stopMeter, sound }
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
    // stopping halfway is half a reading, not a perfect one
    expect(status).toMatchObject({ kind: 'done', summary: { score: 55, read: 6, total: 11 } })
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

  it('keeps listening while the reader is talking, even when the recogniser shows no words', () => {
    const { rec, session, sound } = setup()
    session.start()
    rec.hear('the shop is')
    // misread words: the microphone hears them, the recogniser holds them back
    sound(0.4, PAUSE_MID_MS * 2)
    expect(session.getState().listening).toBe(true)
    // then the reader stops: it finishes after the usual pause
    sound(0.02, PAUSE_MID_MS)
    expect(session.getState().listening).toBe(false)
  })

  it('counts talking the recogniser gave no words for as unclear words, at the reader’s pace', () => {
    const { rec, session, sound } = setup()
    session.start()
    // three words in 1.2 s: 400 ms a word
    sound(0.4, 600)
    rec.hear('the shop')
    sound(0.4, 600)
    rec.hear('the shop is')
    // then 1.6 s of talking the recogniser shows nothing for: about four words
    sound(0.4, 1600)
    sound(0.02, PAUSE_MID_MS)
    const { status, marks } = session.getState()
    expect(marks.slice(0, 3)).toEqual(['ok', 'ok', 'ok'])
    expect(marks.slice(3, 7)).toEqual(['retry', 'retry', 'retry', 'retry'])
    expect(marks.slice(7)).toEqual(['', '', '', ''])
    expect(status).toMatchObject({ kind: 'done', summary: { read: 7 } })
  })

  it('does not count a short sound after the last word as unclear words', () => {
    const { rec, session, sound } = setup()
    session.start()
    rec.hear('the shop is')
    sound(0.4, 800)
    sound(0.02, PAUSE_MID_MS)
    expect(session.getState().status).toMatchObject({ kind: 'done', summary: { read: 3 } })
  })

  it('does not let noise in the room keep a reading going forever', () => {
    const { rec, session, sound } = setup()
    session.start()
    rec.hear('the shop is')
    sound(0.4, VOICE_WITHOUT_WORDS_MS + PAUSE_MID_MS)
    expect(session.getState().listening).toBe(false)
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

describe('a recogniser that transcribes after the fact (on the device)', () => {
  function setupLagging() {
    let release = () => {}
    const rec = fakeRecognizer()
    const create: typeof rec.create = (h) => ({
      ...rec.create(h),
      finish: () => new Promise<void>((r) => (release = r)),
    })
    const session = new ReadingSession({ createRecognizer: create })
    session.load(TEXT)
    return { rec, session, release: () => release() }
  }

  it('waits for the last words before grading “Finish now”', async () => {
    const { rec, session, release } = setupLagging()
    session.start()
    rec.hear('the shop is near my house i buy milk')
    session.stop()
    expect(session.getState()).toMatchObject({ listening: true, status: { kind: 'catching-up' } })

    rec.hear('the shop is near my house i buy milk and eggs')
    release()
    await vi.runAllTimersAsync()

    const { status, marks } = session.getState()
    expect(status.kind).toBe('done')
    expect(marks.every((m) => m === 'ok')).toBe(true)
  })

  it('grades what it has if catching up takes too long', async () => {
    const { rec, session } = setupLagging()
    session.start()
    rec.hear('the shop is near my house')
    session.stop()
    await vi.advanceTimersByTimeAsync(CATCH_UP_MS)
    expect(session.getState()).toMatchObject({ listening: false, status: { kind: 'done' } })
  })

  it('does not let a late catch-up grade the next reading', async () => {
    const { rec, session, release } = setupLagging()
    session.start()
    rec.hear('the shop')
    session.stop()
    session.cancel()
    session.start()
    rec.hear('the shop is near')
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(session.getState()).toMatchObject({ listening: true, status: { kind: 'listening' } })
  })
})

describe('switching recognisers', () => {
  it('stops a reading in progress and uses the new one next time', () => {
    const { rec, session } = setup()
    session.start()
    const other = fakeRecognizer()
    session.setRecognizer(other.create)
    expect(rec.running).toBe(false)
    expect(session.getState().listening).toBe(false)
    session.start()
    expect(other.running).toBe(true)
  })

  it('reports whether it can listen at all', () => {
    const { session } = setup()
    session.setRecognizer(null)
    expect(session.supported).toBe(false)
  })
})
