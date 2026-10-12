import type { ModelState, SpeechModel } from '../speech/onDevice/model'

/** A speech model whose download the test moves along by hand. */
export function fakeModel() {
  let state: ModelState = { kind: 'not-loaded' }
  const listeners = new Set<() => void>()
  let finish: { resolve: () => void; reject: (e: Error) => void } | null = null
  const set = (s: ModelState) => {
    state = s
    listeners.forEach((fn) => fn())
  }
  const model: SpeechModel & {
    progress(fraction: number): void
    done(): void
    fail(): void
    loads: number
  } = {
    loads: 0,
    getState: () => state,
    subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    load() {
      model.loads++
      set({ kind: 'loading', fraction: 0 })
      return new Promise<void>((resolve, reject) => (finish = { resolve, reject }))
    },
    transcribe: async () => '',
    progress: (fraction) => set({ kind: 'loading', fraction }),
    done() {
      set({ kind: 'ready' })
      finish?.resolve()
    },
    fail() {
      set({ kind: 'failed' })
      finish?.reject(new Error('offline'))
    },
  }
  return model
}
