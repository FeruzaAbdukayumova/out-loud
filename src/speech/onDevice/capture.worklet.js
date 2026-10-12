// Hands microphone audio to the page in 100 ms pieces (posting every 128-sample block would be
// hundreds of messages a second). Plain JS: it's loaded by the audio thread as it is.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(Math.round(sampleRate / 10))
    this.length = 0
  }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i]
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer)
          this.buffer = new Float32Array(this.buffer.length)
          this.length = 0
        }
      }
    }
    return true
  }
}
registerProcessor('capture', Capture)
