import { afterEach, expect, it, vi } from 'vitest'
import { startMeter } from './meter'

afterEach(() => vi.unstubAllGlobals())

it('hands the microphone back if stopped before permission was granted', async () => {
  const track = { stop: vi.fn() }
  let grant!: (s: unknown) => void
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: () => new Promise((r) => (grant = r)) },
  })
  const audioContext = vi.fn()
  vi.stubGlobal('AudioContext', audioContext)

  const stop = startMeter(() => {})
  stop()
  grant({ getTracks: () => [track] })
  await Promise.resolve()

  expect(track.stop).toHaveBeenCalled()
  expect(audioContext).not.toHaveBeenCalled()
})

it('does nothing where there is no microphone API', () => {
  vi.stubGlobal('navigator', {})
  expect(() => startMeter(() => {})()).not.toThrow()
})
