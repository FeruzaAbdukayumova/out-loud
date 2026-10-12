import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'
import { applyTheme, rememberedTheme } from './theme'
import { ThemeMenu } from './ThemePicker'

beforeEach(() => {
  localStorage.clear()
  applyTheme('light')
})

test('starts on the notebook', async () => {
  render(<ThemeMenu />)
  await userEvent.click(screen.getByRole('button', { name: 'Page' }))
  expect(screen.getByRole('radio', { name: 'Notebook' })).toBeChecked()
  expect(rememberedTheme()).toBe('light')
})

test('choosing a page changes it and remembers it', async () => {
  render(<ThemeMenu />)
  await userEvent.click(screen.getByRole('button', { name: 'Page' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Blackboard' }))
  expect(screen.getByRole('radio', { name: 'Blackboard' })).toBeChecked()
  expect(document.documentElement.dataset.theme).toBe('board')
  expect(rememberedTheme()).toBe('board')

  await userEvent.click(screen.getByRole('radio', { name: 'Notebook' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(rememberedTheme()).toBe('light')
})

test('closes with Escape', async () => {
  render(<ThemeMenu />)
  await userEvent.click(screen.getByRole('button', { name: 'Page' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
})

test('falls back to the notebook for a saved value it does not know, like the old Auto', () => {
  localStorage.setItem('out-loud:theme', 'auto')
  expect(rememberedTheme()).toBe('light')
})
