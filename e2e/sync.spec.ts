import type { Browser, Page } from '@playwright/test'
import { Reader, expect, installFakes, test } from './fixtures'

/** A separate browser profile: its own storage, like a second phone or laptop. */
async function device(browser: Browser): Promise<{ page: Page; reader: Reader }> {
  const context = await browser.newContext()
  await context.addInitScript(installFakes)
  const page = await context.newPage()
  await page.goto('./')
  return { page, reader: new Reader(page) }
}

async function signIn(page: Page, email: string, create = false) {
  await page.getByRole('button', { name: 'Sign in to sync' }).click()
  const dialog = page.getByRole('dialog')
  if (create) await dialog.getByRole('button', { name: /create an account/i }).click()
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Password').fill('a good long password')
  await dialog.getByRole('button', { name: create ? 'Create account' : 'Sign in' }).click()
  await expect(page.getByRole('button', { name: email })).toBeVisible()
}

test('a text, a score and a practice word made on one device show up on another', async ({ browser }, info) => {
  const email = `reader-${info.project.name}-${Date.now()}@example.com`
  const phone = await device(browser)
  await signIn(phone.page, email, true)

  await phone.page.getByRole('button', { name: /your own text/i }).click()
  await phone.page.getByLabel('Title', { exact: true }).fill('Lesson 4')
  await phone.page.getByLabel('Text', { exact: true }).fill('The train leaves at nine from platform two.')
  await phone.page.getByRole('button', { name: 'Save' }).click()
  await phone.reader.read('the train leaves at nine from platform too')
  await expect(phone.page.getByRole('button', { name: 'Lesson 4, best 100%' })).toBeVisible()
  const uploaded = phone.page.waitForResponse((r) => r.url().endsWith('/sync') && r.ok())
  await phone.reader.read('the train leafs at nine from platform two')
  await expect(phone.page.getByRole('button', { name: 'Practise 1 word' })).toBeVisible()
  await uploaded // changes go up a moment after the last one

  const laptop = await device(browser)
  await signIn(laptop.page, email)
  await expect(laptop.page.getByRole('button', { name: 'Lesson 4, best 100%' })).toBeVisible()
  await expect(laptop.page.getByRole('button', { name: 'Practise 1 word' })).toBeVisible()

  // a delete travels too
  await laptop.page.getByRole('button', { name: /Lesson 4/ }).click()
  await laptop.page.getByRole('button', { name: 'Delete' }).click()
  const deleted = laptop.page.waitForResponse((r) => r.url().endsWith('/sync') && r.ok())
  await laptop.page.getByRole('button', { name: 'Tap again to delete' }).click()
  await deleted

  await phone.page.reload() // opening the app syncs
  await expect(phone.page.getByRole('button', { name: /Lesson 4/ })).toHaveCount(0)
})

test('changes made offline are sent once back online', async ({ browser }, info) => {
  const email = `offline-${info.project.name}-${Date.now()}@example.com`
  const phone = await device(browser)
  await signIn(phone.page, email, true)

  await phone.page.context().setOffline(true)
  await phone.page.getByRole('button', { name: /your own text/i }).click()
  await phone.page.getByLabel('Title', { exact: true }).fill('On the bus')
  await phone.page.getByLabel('Text', { exact: true }).fill('Written with no signal at all.')
  await phone.page.getByRole('button', { name: 'Save' }).click()
  await expect(phone.page.getByText(/Offline/)).toBeVisible({ timeout: 10_000 })
  const uploaded = phone.page.waitForResponse((r) => r.url().endsWith('/sync') && r.ok())
  await phone.page.context().setOffline(false) // the "online" event triggers a sync
  await uploaded

  const laptop = await device(browser)
  await signIn(laptop.page, email)
  await expect(laptop.page.getByRole('button', { name: 'On the bus' })).toBeVisible()
})
