/**
 * Microphone level, 0–1, so the page shows it really hears you. Returns a function that stops it.
 * It's a nicety: if the microphone can't be opened, reading still works.
 */
export function startMeter(onLevel: (level: number) => void): () => void {
  let stopped = false
  let release = () => {}

  navigator.mediaDevices
    ?.getUserMedia({ audio: true })
    .then((stream) => {
      // stopped while the permission prompt was open: hand the microphone straight back
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let raf = 0
      const loop = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        onLevel(Math.min(peak / 84, 1))
        raf = requestAnimationFrame(loop)
      }
      loop()
      release = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        onLevel(0)
      }
    })
    .catch(() => {})

  return () => {
    stopped = true
    release()
  }
}
