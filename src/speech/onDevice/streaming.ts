/**
 * Turns a live stream of microphone audio into a growing transcript, using a model that only
 * transcribes whole clips. Pure: time is counted in samples, and the model is passed in, so this is
 * tested with made-up audio and a fake model.
 *
 * Speech is cut into segments at pauses. While a segment is still being spoken, it's transcribed
 * again every so often, which gives the reader words on screen as they go; once there's a pause
 * it's transcribed one last time and kept. Clips stay short, so each transcription stays fast.
 */

export const SAMPLE_RATE = 16_000
const CHUNK = SAMPLE_RATE / 10 // speech or not is decided per 100 ms

export interface StreamingOptions {
  transcribe(audio: Float32Array): Promise<string>
  /** Everything heard so far. Called after each transcription of speech, even when unchanged. */
  onText(text: string): void
  /** Failures are reported once; the stream stops transcribing after one. */
  onError?(error: unknown): void
  /** New speech in a segment before it's transcribed again. */
  updateEveryMs?: number
  /** A pause this long ends a segment. */
  pauseMs?: number
  /** A segment is cut here even without a pause. */
  maxSegmentMs?: number
}

const ms = (n: number) => (n * SAMPLE_RATE) / 1000

export class StreamingTranscriber {
  private readonly o: Required<Omit<StreamingOptions, 'onError'>> & Pick<StreamingOptions, 'onError'>
  /** Transcripts of finished segments, then the live one. */
  private texts: string[] = []
  private live: Float32Array[] = []
  private liveLength = 0
  private liveHasSpeech = false
  private silentRun = 0
  private sinceUpdate = 0
  private pending = new Float32Array(CHUNK)
  private pendingLength = 0
  /** Quietest recent level, so the speech threshold follows the room. */
  private noiseFloor = 0.003
  private queue: Promise<void> = Promise.resolve()
  private updating = false
  private failed = false
  private closed = false

  constructor(options: StreamingOptions) {
    this.o = { updateEveryMs: 800, pauseMs: 700, maxSegmentMs: 12_000, ...options }
  }

  /** Audio at SAMPLE_RATE, in pieces of any size. */
  push(samples: Float32Array) {
    if (this.closed) return
    let i = 0
    while (i < samples.length) {
      const n = Math.min(CHUNK - this.pendingLength, samples.length - i)
      this.pending.set(samples.subarray(i, i + n), this.pendingLength)
      this.pendingLength += n
      i += n
      if (this.pendingLength === CHUNK) {
        this.chunk(this.pending)
        this.pending = new Float32Array(CHUNK)
        this.pendingLength = 0
      }
    }
  }

  /** Transcribes what's left and resolves once everything heard is in the transcript. */
  finish(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      if (this.liveHasSpeech) this.endSegment()
    }
    return this.queue
  }

  private chunk(chunk: Float32Array) {
    const speech = this.isSpeech(chunk)
    this.live.push(chunk)
    this.liveLength += CHUNK

    if (!this.liveHasSpeech) {
      if (!speech) {
        // before anyone speaks keep only a moment of lead-in, so the start of the first word isn't clipped
        if (this.liveLength > ms(300)) {
          this.live.shift()
          this.liveLength -= CHUNK
        }
        return
      }
      this.liveHasSpeech = true
      this.texts.push('')
    }

    this.silentRun = speech ? 0 : this.silentRun + CHUNK
    if (speech) this.sinceUpdate += CHUNK

    if (this.silentRun >= ms(this.o.pauseMs) || this.liveLength >= ms(this.o.maxSegmentMs)) {
      this.endSegment()
    } else if (this.sinceUpdate >= ms(this.o.updateEveryMs) && !this.updating) {
      this.update()
    }
  }

  private isSpeech(chunk: Float32Array) {
    let sum = 0
    for (const v of chunk) sum += v * v
    const rms = Math.sqrt(sum / chunk.length)
    // the floor drops at once to anything quieter and creeps up slowly, so speech doesn't raise it much
    this.noiseFloor = rms < this.noiseFloor ? rms : this.noiseFloor * 0.995 + rms * 0.005
    return rms > Math.max(0.008, this.noiseFloor * 3)
  }

  /** Transcribes the segment still being spoken; skipped while the model is busy, so nothing piles up. */
  private update() {
    this.sinceUpdate = 0
    this.updating = true
    const slot = this.texts.length - 1
    const audio = join(this.live, this.liveLength)
    this.run(audio, slot, () => {
      this.updating = false
    })
  }

  /** Every segment's final transcription runs, in order. */
  private endSegment() {
    const slot = this.texts.length - 1
    // the pause that ended it is only silence to the model; keep a little of it
    const tail = Math.max(0, this.silentRun - ms(200))
    this.run(join(this.live, this.liveLength).subarray(0, this.liveLength - tail), slot, () => {})
    this.live = []
    this.liveLength = 0
    this.liveHasSpeech = false
    this.silentRun = 0
    this.sinceUpdate = 0
  }

  private run(audio: Float32Array, slot: number, done: () => void) {
    this.queue = this.queue.then(async () => {
      if (this.failed) return done()
      try {
        const text = (await this.o.transcribe(audio)).trim()
        // the queue runs in order, so a segment's final transcription always lands after its updates
        this.texts[slot] = text
        this.o.onText(this.texts.filter(Boolean).join(' '))
      } catch (error) {
        this.failed = true
        this.o.onError?.(error)
      }
      done()
    })
  }
}

function join(chunks: Float32Array[], length: number) {
  const out = new Float32Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * Converts audio from the microphone's rate to SAMPLE_RATE, piece by piece. Averages the input
 * samples that fall in each output sample (a cheap low-pass), which is plenty for speech.
 */
export class Resampler {
  private readonly step: number
  private carry = 0
  private carrySum = 0
  private carryCount = 0

  constructor(fromRate: number) {
    this.step = fromRate / SAMPLE_RATE
  }

  push(input: Float32Array): Float32Array {
    if (this.step === 1) return input
    const out: number[] = []
    for (const v of input) {
      this.carrySum += v
      this.carryCount++
      this.carry += 1
      if (this.carry >= this.step) {
        out.push(this.carrySum / this.carryCount)
        this.carry -= this.step
        this.carrySum = 0
        this.carryCount = 0
      }
    }
    return Float32Array.from(out)
  }
}
