import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'
import { applyTheme, rememberedTheme } from './theme'
import { ThemePicker } from './ThemePicker'

beforeEach(() => {
  localStorage.clear()
  applyTheme('auto')
})

test('starts on Auto, which leaves the page to the system setting', () => {
  render(<ThemePicker />)
  expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked()
  expect(document.documentElement.dataset.theme).toBeUndefined()
})

test('choosing a page changes it and remembers it', async () => {
  render(<ThemePicker />)
  await userEvent.click(screen.getByRole('radio', { name: 'Blackboard' }))
  expect(screen.getByRole('radio', { name: 'Blackboard' })).toBeChecked()
  expect(document.documentElement.dataset.theme).toBe('board')
  expect(rememberedTheme()).toBe('board')

  await userEvent.click(screen.getByRole('radio', { name: 'Auto' }))
  expect(document.documentElement.dataset.theme).toBeUndefined()
  expect(rememberedTheme()).toBe('auto')
})

test('ignores a saved value it does not know', () => {
  localStorage.setItem('out-loud:theme', 'neon')
  expect(rememberedTheme()).toBe('auto')
})
