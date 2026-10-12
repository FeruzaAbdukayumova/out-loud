import { describe, expect, it } from 'vitest'
import { Resampler, SAMPLE_RATE, StreamingTranscriber } from './streaming'

const samples = (ms: number) => Math.round((ms * SAMPLE_RATE) / 1000)
const speech = (ms: number) => Float32Array.from({ length: samples(ms) }, (_, i) => 0.3 * Math.sin(i / 3))
const quiet = (ms: number) => Float32Array.from({ length: samples(ms) }, (_, i) => 0.001 * Math.sin(i))

/**
 * A stand-in model: "hears" one word per 200 ms of loud audio in the clip, numbered across the
 * whole stream by where the clip started, so a test can see which audio each transcription got.
 */
function fakeModel() {
  const clips: number[] = []
  const transcribe = async (audio: Float32Array) => {
    clips.push(audio.length)
    let loud = 0
    for (let i = 0; i < audio.length; i += samples(100)) {
      if (audio.subarray(i, i + samples(100)).some((v) => Math.abs(v) > 0.05)) loud++
    }
    return Array.from({ length: Math.floor(loud / 2) }, () => 'word').join(' ')
  }
  return { transcribe, clips }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('StreamingTranscriber', () => {
  it('shows words while someone is still talking, then the whole sentence after the pause', async () => {
    const model = fakeModel()
    const heard: string[] = []
    const t = new StreamingTranscriber({ ...model, onText: (s) => heard.push(s) })

    t.push(speech(1000))
    await settle()
    expect(heard.length).toBe(1) // an update while still speaking
    t.push(speech(1000))
    t.push(quiet(800))
    await t.finish()

    expect(heard.at(-1)).toBe(Array(10).fill('word').join(' '))
  })

  it('splits speech at pauses and keeps every segment, in order', async () => {
    const model = fakeModel()
    let last = ''
    const t = new StreamingTranscriber({ ...model, onText: (s) => (last = s) })

    t.push(speech(400))
    t.push(quiet(800))
    t.push(speech(800))
    t.push(quiet(800))
    await t.finish()

    expect(last).toBe('word word word word word word')
    // the second segment was transcribed on its own, not together with the first
    expect(Math.max(...model.clips)).toBeLessThan(samples(1200))
  })

  it('ignores silence: nothing is transcribed, and nothing is reported', async () => {
    const model = fakeModel()
    const heard: string[] = []
    const t = new StreamingTranscriber({ ...model, onText: (s) => heard.push(s) })
    t.push(quiet(5000))
    await t.finish()
    expect(model.clips).toEqual([])
    expect(heard).toEqual([])
  })

  it('keeps a moment before the first loud chunk, so the start of a word isn’t cut', async () => {
    const model = fakeModel()
    const t = new StreamingTranscriber({ ...model, onText: () => {} })
    t.push(quiet(2000))
    t.push(speech(300))
    await t.finish()
    expect(model.clips[0]).toBe(samples(300 + 300))
  })

  it('cuts a long stretch without pauses, so clips stay short', async () => {
    const model = fakeModel()
    const t = new StreamingTranscriber({ ...model, onText: () => {}, maxSegmentMs: 5000 })
    t.push(speech(12_000))
    await t.finish()
    expect(Math.max(...model.clips)).toBeLessThanOrEqual(samples(5000))
  })

  it('does not queue up updates while the model is slow', async () => {
    let release = () => {}
    let calls = 0
    const t = new StreamingTranscriber({
      transcribe: () => {
        calls++
        return new Promise((r) => (release = () => r('x')))
      },
      onText: () => {},
    })
    t.push(speech(5000)) // several update intervals' worth, while the first is still running
    await settle()
    expect(calls).toBe(1)
    release()
    await settle()
  })

  it('finishes the segment being spoken when asked to stop', async () => {
    const model = fakeModel()
    let last = ''
    const t = new StreamingTranscriber({ ...model, onText: (s) => (last = s) })
    t.push(speech(600)) // no pause yet
    await t.finish()
    expect(last).toBe('word word word')
  })

  it('reports a failing model once and stops trying', async () => {
    const errors: unknown[] = []
    let calls = 0
    const t = new StreamingTranscriber({
      transcribe: async () => {
        calls++
        throw new Error('out of memory')
      },
      onText: () => {},
      onError: (e) => errors.push(e),
    })
    t.push(speech(400))
    t.push(quiet(800))
    t.push(speech(400))
    await t.finish()
    expect(errors).toHaveLength(1)
    expect(calls).toBe(1)
  })
})

describe('Resampler', () => {
  it('turns 48 kHz into 16 kHz across pieces of any size', () => {
    const r = new Resampler(48_000)
    const input = Float32Array.from({ length: 48_000 }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / 48_000))
    let total = 0
    for (let i = 0; i < input.length; i += 128) total += r.push(input.subarray(i, i + 128)).length
    expect(total).toBe(16_000)
  })

  it('handles rates that don’t divide evenly (44.1 kHz)', () => {
    const r = new Resampler(44_100)
    const out = r.push(new Float32Array(44_100).fill(0.5))
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1)
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true)
  })

  it('passes 16 kHz through untouched', () => {
    const input = new Float32Array([0.1, 0.2])
    expect(new Resampler(16_000).push(input)).toBe(input)
  })
})
