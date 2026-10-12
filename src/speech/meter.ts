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
      // a timer, not animation frames: those stop in a background tab, and the reading session
      // uses the level to tell that the reader is still talking
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        onLevel(Math.min(peak / 84, 1))
      }, 50)
      release = () => {
        clearInterval(timer)
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
