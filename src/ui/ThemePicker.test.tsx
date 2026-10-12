import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'
import { applyTheme, rememberedTheme } from './theme'
import { ThemeMenu } from './ThemePicker'

beforeEach(() => {
  localStorage.clear()
  applyTheme('auto')
})

test('starts on Auto, which leaves the page to the system setting', async () => {
  render(<ThemeMenu />)
  await userEvent.click(screen.getByRole('button', { name: 'Page' }))
  expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked()
  expect(document.documentElement.dataset.theme).toBeUndefined()
})

test('choosing a page changes it and remembers it', async () => {
  render(<ThemeMenu />)
  await userEvent.click(screen.getByRole('button', { name: 'Page' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Blackboard' }))
  expect(screen.getByRole('radio', { name: 'Blackboard' })).toBeChecked()
  expect(document.documentElement.dataset.theme).toBe('board')
  expect(rememberedTheme()).toBe('board')

  await userEvent.click(screen.getByRole('radio', { name: 'Auto' }))
  expect(document.documentElement.dataset.theme).toBeUndefined()
  expect(rememberedTheme()).toBe('auto')
})

test('closes with Escape', async () => {
  render(<ThemeMenu />)
  await userEvent.click(screen.getByRole('button', { name: 'Page' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
})

test('ignores a saved value it does not know', () => {
  localStorage.setItem('out-loud:theme', 'neon')
  expect(rememberedTheme()).toBe('auto')
})
