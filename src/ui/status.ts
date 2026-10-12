import type { Status } from '../speech/session'

export function statusText(status: Status): string {
  switch (status.kind) {
    case 'ready':
      return 'Press start and read the text to me. Tap any word to hear it.'
    case 'listening':
      return 'Listening — read at your own speed.'
    case 'finishing-in':
      return `Finishing in ${status.seconds}… keep reading to carry on.`
    case 'at-end':
      return 'That’s the whole text — finishing up…'
    case 'catching-up':
      return 'Catching up with the last few words…'
    case 'done': {
      const { score, read, total } = status.summary
      if (read < total * 0.8) return 'Read to the end for a full check.'
      return score >= 90 ? 'Great reading.' : score >= 70 ? 'Good — a few words to practise.' : 'Keep going, read it once more.'
    }
    case 'heard-nothing':
      return 'I didn’t catch anything. Check the microphone and try again.'
    case 'problem':
      return PROBLEMS[status.problem]
  }
}

const PROBLEMS = {
  blocked: 'The microphone is blocked. Allow it in the address bar, then start again.',
  network: 'No connection to the speech service. Check the internet and start again.',
  'no-microphone': 'No microphone found. Connect one and start again.',
  language: 'This browser can’t recognise English speech.',
  model: 'The speech model on this device stopped working. Reload the page, or switch to the browser’s recognition.',
  other: 'Something went wrong while listening. Try again.',
  'keeps-stopping': 'Listening keeps stopping. Try again, or open the page in another browser.',
  'could-not-start': 'Couldn’t start listening. Try again.',
} satisfies Record<Extract<Status, { kind: 'problem' }>['problem'], string>
