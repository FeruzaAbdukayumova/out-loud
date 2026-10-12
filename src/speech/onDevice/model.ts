import { MODEL, type FromWorker, type ToWorker } from './protocol'

export type ModelState =
  | { kind: 'not-loaded' }
  | { kind: 'loading'; fraction: number }
  | { kind: 'ready' }
  | { kind: 'failed' }

/** The speech model as the page sees it: load it once, then transcribe clips of 16 kHz audio. */
export interface SpeechModel {
  getState(): ModelState
  subscribe(fn: () => void): () => void
  /** Downloads the model the first time; later it comes from the browser's cache. */
  load(): Promise<void>
  transcribe(audio: Float32Array): Promise<string>
}

const DOWNLOADED_KEY = 'out-loud:model'

/** Whether this browser has downloaded the model before (so loading it is quick and needs no connection). */
export function modelDownloaded() {
  try {
    return localStorage.getItem(DOWNLOADED_KEY) === MODEL
  } catch {
    return false
  }
}

/** The model running in a web worker. Nothing is downloaded until `load` is called. */
export class WorkerModel implements SpeechModel {
  private worker: Worker | null = null
  private state: ModelState = { kind: 'not-loaded' }
  private listeners = new Set<() => void>()
  private loading: Promise<void> | null = null
  private files = new Map<string, { loaded: number; total: number }>()
  private nextId = 0
  private waiting = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()
  private readonly createWorker: () => Worker

  constructor(createWorker = () => new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' })) {
    this.createWorker = createWorker
  }

  getState = () => this.state
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  private set(state: ModelState) {
    this.state = state
    this.listeners.forEach((fn) => fn())
  }

  load(): Promise<void> {
    if (this.loading) return this.loading
    this.set({ kind: 'loading', fraction: 0 })
    this.loading = new Promise<void>((resolve, reject) => {
      const worker = (this.worker = this.createWorker())
      worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
        switch (data.type) {
          case 'progress': {
            this.files.set(data.file, { loaded: data.loaded, total: data.total })
            let loaded = 0
            let total = 0
            for (const f of this.files.values()) {
              loaded += f.loaded
              total += f.total
            }
            this.set({ kind: 'loading', fraction: total ? loaded / total : 0 })
            break
          }
          case 'ready':
            try {
              localStorage.setItem(DOWNLOADED_KEY, MODEL)
            } catch {
              // only used to skip the download prompt next time
            }
            this.set({ kind: 'ready' })
            resolve()
            break
          case 'load-failed':
            this.fail(new Error(data.message))
            reject(new Error(data.message))
            break
          case 'result':
            this.waiting.get(data.id)?.resolve(data.text)
            this.waiting.delete(data.id)
            break
          case 'result-failed':
            this.waiting.get(data.id)?.reject(new Error(data.message))
            this.waiting.delete(data.id)
            break
        }
      }
      worker.onerror = (e) => {
        this.fail(new Error(e.message || 'worker error'))
        reject(new Error('worker error'))
      }
      this.send({ type: 'load' })
    })
    return this.loading
  }

  async transcribe(audio: Float32Array): Promise<string> {
    await this.load()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      // the audio's memory moves to the worker instead of being copied
      this.send({ type: 'transcribe', id, audio }, [audio.buffer])
    })
  }

  private send(message: ToWorker, transfer: Transferable[] = []) {
    this.worker!.postMessage(message, transfer)
  }

  /** A failed load can be tried again (say, once the connection is back). */
  private fail(error: Error) {
    this.worker?.terminate()
    this.worker = null
    this.loading = null
    this.files.clear()
    this.waiting.forEach((w) => w.reject(error))
    this.waiting.clear()
    this.set({ kind: 'failed' })
  }
}
