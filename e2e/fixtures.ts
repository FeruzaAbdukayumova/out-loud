import { test as base, type Page } from '@playwright/test'

/**
 * A real browser can't be made to speak into its own microphone, so the page gets a stand-in
 * speech recogniser before any app code runs. The test then says what it "heard".
 * Spoken output is recorded instead of played.
 */
function installFakes() {
  type Handler = ((e: unknown) => void) | null
  class FakeRecognition {
    lang = ''
    continuous = false
    interimResults = false
    onresult: Handler = null
    onerror: Handler = null
    onend: Handler = null
    start() {
      ;(window as unknown as { __rec: FakeRecognition }).__rec = this
    }
    stop() {}
    abort() {}
  }
  const w = window as unknown as Record<string, unknown>
  w.SpeechRecognition = FakeRecognition
  w.webkitSpeechRecognition = FakeRecognition
  // no permission prompt in tests; the level meter is optional anyway
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => Promise.reject(new Error('no mic in tests')) },
  })
  const spoken: string[] = []
  w.__spoken = spoken
  Object.defineProperty(window, 'speechSynthesis', {
    value: { speak: (u: SpeechSynthesisUtterance) => spoken.push(u.text), cancel() {}, getVoices: () => [] },
  })
}

export class Reader {
  private readonly page: Page
  constructor(page: Page) {
    this.page = page
  }

  async start() {
    await this.page.getByRole('button', { name: /start reading/i }).click()
  }
  /** The recogniser has heard `text` so far. */
  async hear(text: string) {
    await this.page.evaluate((t) => {
      const rec = (window as unknown as { __rec: { onresult: (e: unknown) => void } }).__rec
      rec.onresult({ results: [[{ transcript: t }]] })
    }, text)
  }
  async finish() {
    await this.page.getByRole('button', { name: /finish now/i }).click()
  }
  async read(text: string) {
    await this.start()
    await this.hear(text)
    await this.finish()
  }
  word(text: string) {
    return this.page.getByRole('button', { name: `Hear “${text}”` }).first()
  }
  spoken() {
    return this.page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)
  }
}

export const test = base.extend<{ reader: Reader }>({
  page: async ({ page }, use) => {
    await page.addInitScript(installFakes)
    await use(page)
  },
  reader: async ({ page }, use) => {
    await use(new Reader(page))
  },
})

export { expect } from '@playwright/test'
