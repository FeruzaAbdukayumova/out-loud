import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Results } from './Results'

const summary = { score: 31, ok: 11, almost: 0, retry: 0, read: 11, total: 36, practice: [] }

it('does not call a reading that stopped partway all clear', () => {
  render(<Results summary={summary} previous={undefined} onWord={vi.fn()} />)
  expect(screen.getByText(/No mistakes in the part you read/)).toBeInTheDocument()
  expect(screen.queryByText(/Every word was clear/)).not.toBeInTheDocument()
})

it('says every word was clear only after the whole text', () => {
  render(<Results summary={{ ...summary, score: 100, ok: 36, read: 36 }} previous={undefined} onWord={vi.fn()} />)
  expect(screen.getByText(/Every word was clear/)).toBeInTheDocument()
})
