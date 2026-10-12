/// <reference lib="webworker" />
/** Runs the speech model off the main thread, so the page stays smooth while it works. */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
// the ONNX runtime is served with the app instead of from a CDN, so no outside code runs here;
// the plain build (not the "asyncify" one, which only WebGPU needs) works in every browser
import runtimeJs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import runtimeWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { MODEL, MODEL_REVISION, type FromWorker, type ToWorker } from './protocol'

env.allowLocalModels = false
env.backends.onnx.wasm!.wasmPaths = { mjs: runtimeJs, wasm: runtimeWasm }

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null
const post = (m: FromWorker) => self.postMessage(m)

function load() {
  asr ??= pipeline('automatic-speech-recognition', MODEL, {
    revision: MODEL_REVISION,
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress') post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total })
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>
  return asr
}

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === 'load') {
    try {
      await load()
      post({ type: 'ready' })
    } catch (e) {
      asr = null
      post({ type: 'load-failed', message: String(e) })
    }
  } else {
    try {
      const out = await (await load())(data.audio)
      post({ type: 'result', id: data.id, text: (Array.isArray(out) ? out[0] : out).text })
    } catch (e) {
      post({ type: 'result-failed', id: data.id, message: String(e) })
    }
  }
}
