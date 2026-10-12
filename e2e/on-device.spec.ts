import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext } from '@playwright/test'

/**
 * The real thing, nothing faked: Chromium's microphone plays a recording of the first text being
 * read (made with macOS's text-to-speech), and the real speech model, running in the page, has to
 * recognise it.
 */
test.setTimeout(300_000)

/**
 * The model (about 63 MB) and the ONNX runtime come from Hugging Face and jsDelivr. Every browser
 * context starts with an empty cache, so the test keeps its own copy on disk, which CI caches
 * between runs: the test doesn't download them every time, or depend on those sites being up.
 */
const FILES = path.join(import.meta.dirname, '.model-cache')
/** Every outside host the page asked for something. */
const hosts = new Set<string>()

async function cacheDownloads(context: BrowserContext) {
  mkdirSync(FILES, { recursive: true })
  await context.route(
    (url) => url.hostname !== 'localhost',
    async (route) => {
      const request = route.request()
      hosts.add(new URL(request.url()).hostname)
      const file = path.join(FILES, createHash('sha256').update(request.url()).digest('hex'))
      if (!existsSync(file)) {
        // always the whole file, whatever was asked for: the loader also asks for byte ranges and HEADs
        const headers = { ...request.headers() }
        delete headers.range
        const response = await route.fetch({ method: 'GET', headers })
        if (!response.ok()) return route.fulfill({ response })
        writeFileSync(file, await response.body())
        writeFileSync(file + '.type', response.headers()['content-type'] ?? 'application/octet-stream')
      }
      const body = readFileSync(file)
      const headers: Record<string, string> = {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-length, content-range',
        'content-type': readFileSync(file + '.type', 'utf8'),
      }
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers().range ?? '')
      if (range) {
        const start = Number(range[1])
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
        headers['content-range'] = `bytes ${start}-${end}/${body.length}`
        return route.fulfill({ status: 206, headers, body: body.subarray(start, end + 1) })
      }
      if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'content-length': String(body.length) } })
      await route.fulfill({ status: 200, headers, body })
    },
  )
}

test('reads a text through the microphone with the model on the device, online and then offline', async ({ page, context }) => {
  await cacheDownloads(context)
  await page.goto('./')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'This device' }).click()
  await page.getByRole('button', { name: /download/i }).click()
  await expect(page.getByText(/never leaves this device/)).toBeVisible({ timeout: 180_000 })
  await page.getByRole('button', { name: 'Done' }).click()

  async function readAndCheck() {
    await page.getByRole('button', { name: /start reading/i }).click()
    // words are marked while the recording plays…
    await expect(page.locator('[data-mark="ok"]').first()).toBeVisible({ timeout: 20_000 })
    // …and the reading finishes by itself after the last word
    const results = page.getByRole('region', { name: 'Results' })
    await expect(results).toBeVisible({ timeout: 40_000 })
    await expect(results).toContainText('36 of 36 words read')
    const score = Number(await results.locator('.score').evaluate((e) => e.firstChild?.textContent))
    console.log(`on-device score: ${score}%`)
    expect(score).toBeGreaterThanOrEqual(85)
  }
  await readAndCheck()
  // the model's files are the only thing fetched from outside; no code comes from a CDN
  expect([...hosts]).toEqual(['huggingface.co'])

  // with no connection at all: the app, the model and the runtime all come from the browser's caches
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('radio', { name: 'This device' })).toBeChecked()
  await expect(page.getByText(/never leaves this device/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await readAndCheck()
})
