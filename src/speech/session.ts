import { check, summarize, type Mark, type Summary } from '../reading/grade'
import type { Passage } from '../reading/text'
import type { CreateRecognizer, Recognizer, RecognizerProblem } from './recognizer'

/** Reading ends on its own after this much quiet mid-text… */
export const PAUSE_MID_MS = 5000
/** …or this much after the last word. */
export const PAUSE_END_MS = 2500
/** The status line counts down this long before a mid-text stop. */
export const COUNTDOWN_MS = 2500
const WATCH_EVERY_MS = 250
/** A recogniser that keeps ending this soon after starting, hearing nothing, is broken, not listening. */
const QUICK_END_MS = 1000
const MAX_QUICK_ENDS = 3

export type Status =
  | { kind: 'ready' }
  | { kind: 'listening' }
  | { kind: 'finishing-in'; seconds: number }
  | { kind: 'at-end' }
  | { kind: 'done'; summary: Summary }
  | { kind: 'heard-nothing' }
  | { kind: 'problem'; problem: RecognizerProblem | 'keeps-stopping' | 'could-not-start' }

export interface SessionState {
  listening: boolean
  /** One mark per printed word. */
  marks: Mark[]
  /** The printed word the reader has got to, -1 before the first. */
  reached: number
  status: Status
}

export interface SessionDeps {
  createRecognizer: CreateRecognizer | null
  /** Starts the microphone level meter; returns a function that stops it. */
  startMeter?: (onLevel: (level: number) => void) => () => void
}

/**
 * One reading of one text: listens, marks words as they come in, and stops by itself once the
 * reader goes quiet. React reads it through `subscribe` / `getState`; the mic level goes to
 * `onLevel` listeners instead, since it changes every frame.
 */
export class ReadingSession {
  private passage: Passage | null = null
  private pauseEndMs = PAUSE_END_MS
  private state: SessionState = { listening: false, marks: [], reached: -1, status: { kind: 'ready' } }
  private listeners = new Set<() => void>()
  private levelListeners = new Set<(level: number) => void>()

  private recognizer: Recognizer | null = null
  /** What earlier runs of the recogniser heard; it ends by itself now and then and is restarted. */
  private heard = ''
  private current = ''
  private lastSpeechAt = 0
  private runStartedAt = 0
  private quickEnds = 0
  private watchdog: ReturnType<typeof setInterval> | undefined
  private stopMeter: (() => void) | null = null
  private readonly deps: SessionDeps

  constructor(deps: SessionDeps) {
    this.deps = deps
  }

  get supported() {
    return this.deps.createRecognizer !== null
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getState = () => this.state

  onLevel(fn: (level: number) => void) {
    this.levelListeners.add(fn)
    return () => void this.levelListeners.delete(fn)
  }

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  /** `pauseEndMs`: how long to wait after the last word; shorter for a single practice word. */
  load(passage: Passage, { pauseEndMs = PAUSE_END_MS } = {}) {
    if (this.state.listening) this.cancel()
    this.passage = passage
    this.pauseEndMs = pauseEndMs
    this.set({ marks: passage.words.map(() => ''), reached: -1, status: { kind: 'ready' } })
  }

  start() {
    const create = this.deps.createRecognizer
    if (!create || !this.passage || this.state.listening) return
    this.heard = ''
    this.current = ''
    this.quickEnds = 0

    this.recognizer = create({
      onText: (text) => this.onText(text),
      onProblem: (problem) => this.fail(problem),
      onEnd: () => this.onEnd(),
    })
    if (!this.run()) return

    this.lastSpeechAt = Date.now()
    this.set({
      listening: true,
      marks: this.passage.words.map(() => ''),
      reached: -1,
      status: { kind: 'listening' },
    })
    this.stopMeter = this.deps.startMeter?.((level) => this.levelListeners.forEach((fn) => fn(level))) ?? null
    this.watchdog = setInterval(() => this.watch(), WATCH_EVERY_MS)
  }

  /** Ends the reading and grades it, skipped words included. */
  stop() {
    if (!this.state.listening || !this.passage) return
    const transcript = this.transcript()
    this.teardown()
    const { marks, reached } = check(this.passage, transcript, true)
    const summary = summarize(this.passage, marks)
    this.set({ listening: false, marks, reached, status: summary ? { kind: 'done', summary } : { kind: 'heard-nothing' } })
  }

  /** Ends the reading without grading it. */
  cancel() {
    if (!this.state.listening || !this.passage) return
    this.teardown()
    this.set({ listening: false, marks: this.passage.words.map(() => ''), reached: -1, status: { kind: 'ready' } })
  }

  private run(): boolean {
    try {
      this.recognizer!.start()
      this.runStartedAt = Date.now()
      return true
    } catch {
      this.teardown()
      this.set({ listening: false, status: { kind: 'problem', problem: 'could-not-start' } })
      return false
    }
  }

  private transcript() {
    return this.heard + ' ' + this.current
  }

  private onText(text: string) {
    if (!this.passage) return
    this.current = text
    this.quickEnds = 0
    this.lastSpeechAt = Date.now()
    const { marks, reached } = check(this.passage, this.transcript(), false)
    this.set({ marks, reached })
  }

  private onEnd() {
    if (!this.state.listening) return
    // whatever was still interim when it ended is all we'll get of those words; keep it
    this.heard = this.transcript()
    this.current = ''
    if (Date.now() - this.runStartedAt < QUICK_END_MS && ++this.quickEnds >= MAX_QUICK_ENDS) {
      this.fail('keeps-stopping')
      return
    }
    this.run()
  }

  private fail(problem: RecognizerProblem | 'keeps-stopping') {
    if (!this.state.listening) return
    this.teardown()
    this.set({ listening: false, status: { kind: 'problem', problem } })
  }

  private watch() {
    const { reached, status } = this.state
    const atEnd = !!this.passage && reached >= this.passage.words.length - 1
    const quiet = Date.now() - this.lastSpeechAt
    const limit = atEnd ? this.pauseEndMs : PAUSE_MID_MS
    if (quiet >= limit) {
      this.stop()
      return
    }
    const left = limit - quiet
    const next: Status = atEnd
      ? { kind: 'at-end' }
      : left <= COUNTDOWN_MS
        ? { kind: 'finishing-in', seconds: Math.ceil(left / 1000) }
        : { kind: 'listening' }
    if (JSON.stringify(next) !== JSON.stringify(status)) this.set({ status: next })
  }

  private teardown() {
    clearInterval(this.watchdog)
    this.recognizer?.stop()
    this.recognizer = null
    this.stopMeter?.()
    this.stopMeter = null
  }
}
