import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetForTests } from '../library/library'
import { MAX_WORDS } from '../library/texts'
import { ReadingSession } from '../speech/session'
import { fakeRecognizer } from '../test/fakeRecognizer'
import { App } from './App'

const MORNING =
  "I wake up at seven o'clock. I open the window and look outside. The sky is blue today. I drink a cup of tea and eat some bread. Then I walk to school with my friend."

beforeEach(async () => {
  await _resetForTests()
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
})

function setup() {
  const rec = fakeRecognizer()
  const session = new ReadingSession({ createRecognizer: rec.create })
  const speak = vi.fn()
  const user = userEvent.setup()
  const view = render(<App session={session} speak={speak} />)
  return { rec, session, speak, user, ...view }
}

async function read(user: ReturnType<typeof userEvent.setup>, rec: ReturnType<typeof fakeRecognizer>, transcript: string) {
  await user.click(screen.getByRole('button', { name: /start reading/i }))
  rec.hear(transcript)
  await user.click(screen.getByRole('button', { name: /finish now/i }))
}

const wordButton = (word: string) => screen.getAllByRole('button', { name: `Hear “${word}”` })[0]

describe('reading a text', () => {
  it('marks the words, scores the reading and lists the words to practise', async () => {
    const { user, rec } = setup()
    // "seven o'clock" comes back as digits; "window" is misread; the end isn't read
    await read(user, rec, 'I wake up at 7:00 I open the windy and look outside the sky is blue today')

    expect(wordButton('wake')).toHaveAttribute('data-mark', 'ok')
    expect(wordButton("o'clock")).toHaveAttribute('data-mark', 'ok')
    expect(wordButton('window')).toHaveAttribute('data-mark', 'almost')
    expect(wordButton('bread')).not.toHaveAttribute('data-mark')

    const results = screen.getByRole('region', { name: 'Results' })
    expect(results).toHaveTextContent('94%17 clear · 1 close · 0 to practise18 of 36 words read')
    expect(within(results).getByRole('button', { name: 'Hear “window”' })).toBeInTheDocument()
    expect(screen.getByText('Read to the end for a full check.')).toBeInTheDocument()
  })

  it('remembers the score and shows how the next reading compares', async () => {
    const { user, rec } = setup()
    await read(user, rec, 'I wake up at seven o clock I opened the windows')
    expect(await screen.findByRole('button', { name: /My morning, best 90%/ })).toBeInTheDocument()

    await read(user, rec, "I wake up at seven o'clock I open the window")
    expect(screen.getByText(/Last time 90%/)).toHaveTextContent('Last time 90% · +10')
    expect(await screen.findByRole('button', { name: /My morning, best 100%/ })).toBeInTheDocument()
  })

  it('says the word you tap, stopping a reading in progress', async () => {
    const { user, rec, speak, session } = setup()
    await user.click(screen.getByRole('button', { name: /start reading/i }))
    rec.hear('I wake')
    await user.click(wordButton('window'))

    expect(speak).toHaveBeenCalledWith('window', 0.75)
    expect(session.getState().listening).toBe(false)
    expect(rec.running).toBe(false)
  })

  it('reads the whole text aloud', async () => {
    const { user, speak } = setup()
    await user.click(screen.getByRole('button', { name: /hear the whole text/i }))
    expect(speak).toHaveBeenCalledWith(MORNING, 0.8)
  })

  it('switches texts and comes back to the last one next time', async () => {
    const { user, unmount } = setup()
    await user.click(screen.getByRole('button', { name: 'At the shop' }))
    expect(wordButton('milk')).toBeInTheDocument()
    unmount()

    setup()
    expect(screen.getByRole('button', { name: 'At the shop' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('explains what is wrong in a browser that cannot listen', () => {
    render(<App session={new ReadingSession({ createRecognizer: null })} speak={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/can’t listen/)
    expect(screen.getByRole('button', { name: /start reading/i })).toBeDisabled()
  })
})

describe('your own texts', () => {
  it('adds a text, reads it, and deletes it after a second tap', async () => {
    const { user, rec } = setup()
    await user.click(screen.getByRole('button', { name: /your own text/i }))
    const dialog = screen.getByRole('dialog', { name: 'Add your own text' })
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Title'), 'Lesson 4')
    await user.type(within(dialog).getByLabelText('Text'), 'The train leaves at 9:15 from platform 2.')
    await user.click(save)

    expect(await screen.findByRole('button', { name: 'Lesson 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Your text · 8 words')).toBeInTheDocument()

    await read(user, rec, 'the train leaves at 9:15 from platform two')
    expect(screen.getByRole('region', { name: 'Results' })).toHaveTextContent('100%')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Tap again to delete' }))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Lesson 4/ })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'My morning' })).toHaveAttribute('aria-pressed', 'true')
  })

  it(`won't save a text longer than ${MAX_WORDS} words`, async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /your own text/i }))
    await user.type(screen.getByLabelText('Title'), 'Too long')
    await user.click(screen.getByLabelText('Text'))
    await user.paste('word '.repeat(MAX_WORDS + 1))
    expect(screen.getByText(`${MAX_WORDS + 1} / ${MAX_WORDS} words`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('closes the form with Escape', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /your own text/i }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
