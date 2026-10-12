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
/**
 * A microphone level this loud is the reader's voice. While it's heard, reading carries on even if
 * the recogniser has nothing to show: it holds back words it can't make out, which is exactly
 * what a misread word sounds like.
 */
export const VOICE_LEVEL = 0.06
/** …but sound with no words at all for this long is the room, not reading. */
export const VOICE_WITHOUT_WORDS_MS = 15000
/**
 * Talking this long after the last word the recogniser gave back means words it couldn't make
 * out, which the browser's recogniser drops without a trace. They're counted as unclear, at the
 * reader's pace, instead of looking unread.
 */
export const UNHEARD_MIN_MS = 1500
/** Limits on the reading pace used for that estimate, in ms per word. */
const MS_PER_WORD = { min: 250, max: 900 }
/** The longest "Finish now" waits for a recogniser to catch up before grading what it has. */
export const CATCH_UP_MS = 6000

export type Status =
  | { kind: 'ready' }
  | { kind: 'listening' }
  | { kind: 'finishing-in'; seconds: number }
  | { kind: 'at-end' }
  | { kind: 'catching-up' }
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
  private lastVoiceAt = 0
  private lastLevelAt = 0
  /** When the reader started talking, for their pace. */
  private firstVoiceAt = 0
  /** How long the reader has been talking since the recogniser last gave back any words. */
  private voicedSinceText = 0
  private runStartedAt = 0
  private quickEnds = 0
  private watchdog: ReturnType<typeof setInterval> | undefined
  private stopMeter: (() => void) | null = null
  /** Counts readings, so a late catch-up from an earlier one can't grade a later one. */
  private readings = 0
  private catchingUp = false
  private deps: SessionDeps

  /** The recogniser it was made with: the browser's, in the app. */
  readonly builtInRecognizer: CreateRecognizer | null

  constructor(deps: SessionDeps) {
    this.deps = deps
    this.builtInRecognizer = deps.createRecognizer
  }

  get createRecognizer() {
    return this.deps.createRecognizer
  }

  get supported() {
    return this.deps.createRecognizer !== null
  }

  /** Switches between the browser's recogniser and the one on the device. */
  setRecognizer(createRecognizer: CreateRecognizer | null) {
    this.cancel()
    this.deps = { ...this.deps, createRecognizer }
    this.set({}) // `supported` may have changed
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
    this.readings++

    this.recognizer = create({
      onText: (text) => this.onText(text),
      onProblem: (problem) => this.fail(problem),
      onEnd: () => this.onEnd(),
    })
    if (!this.run()) return

    this.lastSpeechAt = Date.now()
    this.lastVoiceAt = 0
    this.lastLevelAt = 0
    this.firstVoiceAt = 0
    this.voicedSinceText = 0
    this.set({
      listening: true,
      marks: this.passage.words.map(() => ''),
      reached: -1,
      status: { kind: 'listening' },
    })
    this.stopMeter =
      this.deps.startMeter?.((level) => {
        const now = Date.now()
        const since = this.lastLevelAt ? Math.min(now - this.lastLevelAt, 200) : 0
        this.lastLevelAt = now
        if (level >= VOICE_LEVEL) {
          this.lastVoiceAt = now
          this.firstVoiceAt ||= now
          this.voicedSinceText += since
        }
        this.levelListeners.forEach((fn) => fn(level))
      }) ?? null
    this.watchdog = setInterval(() => this.watch(), WATCH_EVERY_MS)
  }

  /**
   * Ends the reading and grades it, skipped words included. A recogniser that transcribes after
   * the fact gets a moment to finish the last words first.
   */
  stop() {
    if (!this.state.listening || !this.passage || this.catchingUp) return
    const recognizer = this.recognizer
    if (!recognizer?.finish) return this.grade()

    this.catchingUp = true
    clearInterval(this.watchdog)
    this.stopMeter?.()
    this.stopMeter = null
    this.set({ status: { kind: 'catching-up' } })
    const run = this.readings
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((r) => (timer = setTimeout(r, CATCH_UP_MS)))
    void Promise.race([recognizer.finish().catch(() => {}), timeout]).then(() => {
      clearTimeout(timer)
      if (run !== this.readings || !this.catchingUp) return
      this.catchingUp = false
      this.grade()
    })
  }

  private grade() {
    if (!this.state.listening || !this.passage) return
    const transcript = this.transcript()
    this.teardown()
    const { marks, reached } = withUnheard(check(this.passage, transcript, true), this.unheardWords())
    const summary = summarize(this.passage, marks)
    this.set({ listening: false, marks, reached, status: summary ? { kind: 'done', summary } : { kind: 'heard-nothing' } })
  }

  /** How many words the reader said that the recogniser never gave back, at their pace. */
  private unheardWords() {
    if (this.voicedSinceText < UNHEARD_MIN_MS || !this.firstVoiceAt) return 0
    const { reached } = check(this.passage!, this.transcript(), true)
    if (reached < 0) return 0
    const pace = (this.lastSpeechAt - this.firstVoiceAt) / (reached + 1)
    const msPerWord = Math.min(Math.max(pace, MS_PER_WORD.min), MS_PER_WORD.max)
    return Math.round(this.voicedSinceText / msPerWord)
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
    this.voicedSinceText = 0
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
    const now = Date.now()
    const voiceCounts = now - this.lastSpeechAt < VOICE_WITHOUT_WORDS_MS
    const quiet = now - Math.max(this.lastSpeechAt, voiceCounts ? this.lastVoiceAt : 0)
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
    this.catchingUp = false
    clearInterval(this.watchdog)
    this.recognizer?.stop()
    this.recognizer = null
    this.stopMeter?.()
    this.stopMeter = null
  }
}

/** Marks the next `count` unread words after the reader's place as ones to practise. */
function withUnheard({ marks, reached }: { marks: Mark[]; reached: number }, count: number) {
  if (!count) return { marks, reached }
  const end = Math.min(reached + count, marks.length - 1)
  const next = marks.map((m, i) => (i > reached && i <= end && m === '' ? ('retry' as const) : m))
  return { marks: next, reached: Math.max(reached, end) }
}
