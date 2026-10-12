import type { CreateRecognizer, RecognizerProblem } from '../recognizer'
import type { SpeechModel } from './model'
import { Resampler, StreamingTranscriber } from './streaming'

const MIC_PROBLEMS: Record<string, RecognizerProblem> = {
  NotAllowedError: 'blocked',
  SecurityError: 'blocked',
  NotFoundError: 'no-microphone',
  OverconstrainedError: 'no-microphone',
}

/**
 * Recognition on the device: the microphone's audio goes to a speech model running in a worker,
 * and nothing leaves the browser. Works offline once the model is downloaded, and in browsers
 * without speech recognition of their own (Firefox).
 */
export function onDeviceRecognizer(model: SpeechModel): CreateRecognizer {
  return (h) => {
    let stopped = false
    let release = () => {}
    let transcriber: StreamingTranscriber | null = null

    const problem = (p: RecognizerProblem) => {
      if (!stopped) h.onProblem(p)
    }

    return {
      start() {
        transcriber = new StreamingTranscriber({
          transcribe: (audio) => model.transcribe(audio),
          onText: (text) => !stopped && h.onText(text),
          onError: () => problem('model'),
        })
        // loads from the cache in a moment if it isn't in memory yet; audio waits in the queue meanwhile
        model.load().catch(() => problem('model'))

        navigator.mediaDevices
          .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
          .then(async (stream) => {
            if (stopped) return stream.getTracks().forEach((t) => t.stop())
            const ctx = new AudioContext()
            release = () => {
              release = () => {}
              stream.getTracks().forEach((t) => t.stop())
              void ctx.close()
            }
            await ctx.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url))
            if (stopped) return
            const capture = new AudioWorkletNode(ctx, 'capture')
            const resampler = new Resampler(ctx.sampleRate)
            capture.port.onmessage = ({ data }: MessageEvent<Float32Array>) => transcriber?.push(resampler.push(data))
            ctx.createMediaStreamSource(stream).connect(capture)
            // a worklet that leads nowhere may never be asked to process; it outputs silence
            capture.connect(ctx.destination)
          })
          .catch((e: unknown) => problem(MIC_PROBLEMS[(e as Error)?.name] ?? 'other'))
      },
      async finish() {
        release()
        await transcriber?.finish()
      },
      stop() {
        stopped = true
        release()
      },
    }
  }
}
