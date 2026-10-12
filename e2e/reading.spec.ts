import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('a reading is marked live, scored, and remembered after a reload', async ({ page, reader }) => {
  await reader.start()
  await reader.hear('I wake up at 7:00 I open the windy')

  // marked while still listening
  await expect(reader.word("o'clock")).toHaveAttribute('data-mark', 'ok')
  await expect(reader.word('window')).toHaveAttribute('data-mark', 'almost')
  await expect(page.getByText('Listening — read at your own speed.')).toBeVisible()

  await reader.finish()
  const results = page.getByRole('region', { name: 'Results' })
  // 9 clear words of 36: the unread rest counts against the score
  await expect(results).toContainText('25%')
  await expect(results).toContainText('10 of 36 words read')

  await results.getByRole('button', { name: 'Hear “window”' }).click()
  expect(await reader.spoken()).toContain('window')

  const pill = page.getByRole('button', { name: 'My morning, best 25%' })
  await expect(pill).toBeVisible()
  await page.reload()
  await expect(pill).toBeVisible()
})

test('finishes on its own after the reader goes quiet', async ({ page, reader }) => {
  await reader.start()
  await reader.hear("I wake up at seven o'clock")
  await expect(page.getByText(/Finishing in \d/)).toBeVisible({ timeout: 4000 })
  await expect(page.getByRole('region', { name: 'Results' })).toBeVisible({ timeout: 6000 })
  await expect(page.getByRole('button', { name: /start reading/i })).toBeVisible()
})

test('your own text is kept across reloads and can be deleted', async ({ page, reader }) => {
  await page.getByRole('button', { name: /your own text/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Add your own text' })
  await dialog.getByLabel('Title').fill('Lesson 4')
  await dialog.getByLabel('Text').fill('The train leaves at 9:15 from platform 2.')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Your text · 8 words')).toBeVisible()

  await reader.read('the train leaves at nine fifteen from platform two')
  await expect(page.getByRole('region', { name: 'Results' })).toContainText('100%')

  await page.reload()
  await expect(page.getByRole('button', { name: /Lesson 4/ })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Tap again to delete' }).click()
  await expect(page.getByRole('button', { name: /Lesson 4/ })).toHaveCount(0)
})

test('works offline once it has been opened', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload() // now controlled by the service worker
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Out Loud' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'At the shop' })).toBeVisible()
})

test('fits the screen without sideways scrolling', async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('has no accessibility violations, before and after a reading', async ({ page, reader }) => {
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect((await scan()).violations).toEqual([])
  await reader.read('I wake up at 7:00 I open the windy')
  expect((await scan()).violations).toEqual([])
  // every page, with words marked and a score showing; no colour fades, so axe sees the final colours
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Page' }).click()
  for (const name of ['Notebook', 'Night', 'Legal pad', 'Squared', 'Blackboard', 'Brown paper']) {
    await page.getByRole('radio', { name }).click()
    expect((await scan()).violations, name).toEqual([])
  }
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /your own text/i }).click()
  expect((await scan()).violations).toEqual([])
})

test('a missed word can be practised on its own', async ({ page, reader }) => {
  await reader.read('I wake up at seven o clock I open the windy')
  await page.getByRole('button', { name: 'Practise 1 word' }).click()
  await expect(page.getByRole('button', { name: 'Hear “window”' })).toBeVisible()
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])

  await page.getByRole('button', { name: /say it/i }).click()
  await reader.hear('window')
  await page.getByRole('button', { name: /done/i }).click()
  await expect(page.getByText('Clear!')).toBeVisible()
  await page.getByRole('button', { name: 'Next word' }).click()
  await page.getByRole('button', { name: 'Back to reading' }).click()
  await expect(page.getByRole('button', { name: /^Practise/ })).toHaveCount(0)

  // still gone after a reload: the word is scheduled for tomorrow
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Out Loud' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Practise/ })).toHaveCount(0)
})
