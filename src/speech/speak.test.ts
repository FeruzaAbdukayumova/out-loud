import { expect, it } from 'vitest'
import { sentences } from './speak'

it('splits a text into sentences, so long texts are not cut off', () => {
  expect(sentences('I wake up. Is the sky blue? Yes! "Go," she said… Then home')).toEqual([
    'I wake up.',
    'Is the sky blue?',
    'Yes!',
    '"Go," she said…',
    'Then home',
  ])
  expect(sentences('cat')).toEqual(['cat'])
})
