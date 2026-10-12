/** Messages between the page and the speech model's worker. */

/** Moonshine Base, quantised to 8 bits: about 63 MB, downloaded once and kept by the browser. */
export const MODEL = 'onnx-community/moonshine-base-ONNX'
export const MODEL_MB = 63

export type ToWorker = { type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array }

export type FromWorker =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'load-failed'; message: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'result-failed'; id: number; message: string }
