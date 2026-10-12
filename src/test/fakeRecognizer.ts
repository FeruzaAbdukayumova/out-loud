import type { CreateRecognizer, RecognizerHandlers } from '../speech/recognizer'

/** A stand-in for the browser's recogniser that the test speaks into. */
export function fakeRecognizer() {
  const fake = {
    handlers: null as RecognizerHandlers | null,
    running: false,
    starts: 0,
    failNextStart: false,
    create: ((h) => {
      fake.handlers = h
      return {
        start: () => {
          if (fake.failNextStart) {
            fake.failNextStart = false
            throw new Error('InvalidStateError')
          }
          fake.running = true
          fake.starts++
        },
        stop: () => {
          fake.running = false
        },
      }
    }) as CreateRecognizer,
    /** The recogniser has heard `text` so far in this run. */
    hear(text: string) {
      fake.handlers!.onText(text)
    },
    /** The recogniser stops by itself, as browsers' do. */
    end() {
      fake.running = false
      fake.handlers!.onEnd()
    },
  }
  return fake
}
