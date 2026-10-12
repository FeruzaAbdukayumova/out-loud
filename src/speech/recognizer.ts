/** The browser's speech recogniser, behind a small interface so the reading session can be tested without it. */

export type RecognizerProblem = 'blocked' | 'network' | 'no-microphone' | 'language' | 'other'

export interface RecognizerHandlers {
  /** Everything heard in this run so far, interim words included. */
  onText(text: string): void
  onProblem(problem: RecognizerProblem): void
  /** The recogniser stopped by itself (it does after a while, or when the page is hidden). */
  onEnd(): void
}

export interface Recognizer {
  start(): void
  stop(): void
}

export type CreateRecognizer = (handlers: RecognizerHandlers) => Recognizer

// Not in TypeScript's DOM types yet, so only the parts used here.
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

const PROBLEMS: Record<string, RecognizerProblem> = {
  'not-allowed': 'blocked',
  'service-not-allowed': 'blocked',
  network: 'network',
  'audio-capture': 'no-microphone',
  'language-not-supported': 'language',
}

/** null when the browser can't recognise speech (Firefox, for one). */
export function browserRecognizer(lang = 'en-US'): CreateRecognizer | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!SR) return null

  return (h) => {
    const r = new SR()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => h.onText(Array.from(e.results, (res) => res[0].transcript).join(' '))
    // "no-speech" and "aborted" are routine; the session decides when silence means stop
    r.onerror = (e) => {
      if (e.error in PROBLEMS) h.onProblem(PROBLEMS[e.error])
    }
    r.onend = () => h.onEnd()
    return {
      start: () => r.start(),
      stop: () => {
        r.onresult = r.onerror = r.onend = null
        r.abort()
      },
    }
  }
}
