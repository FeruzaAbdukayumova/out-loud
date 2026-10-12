import { z } from 'zod'
import { MIN_PASSWORD } from './auth.ts'

const id = z.string().min(1).max(100)
const time = z.number().int().nonnegative()
const MAX_ITEMS = 1000

// emails are compared trimmed and in lower case: "Reader@Example.com " is the same account
const email = z.string().trim().toLowerCase().pipe(z.email().max(254))

export const signUpBody = z.object({ email, password: z.string().min(MIN_PASSWORD).max(200) })
/** No length rule on sign-in: the password is only compared with the stored one. */
export const signInBody = z.object({ email, password: z.string().min(1).max(200) })

export const syncRequest = z.object({
  cursor: z.number().int().nonnegative(),
  texts: z
    .array(
      z.object({
        id,
        title: z.string().max(100),
        body: z.string().max(20_000),
        createdAt: time,
        updatedAt: time,
        deleted: z.boolean(),
      }),
    )
    .max(MAX_ITEMS),
  attempts: z
    .array(
      z.object({
        id,
        textId: id,
        at: time,
        score: z.number().int().min(0).max(100),
        read: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        practice: z.array(z.string().max(100)).max(300),
        updatedAt: time,
        deleted: z.boolean(),
      }),
    )
    .max(MAX_ITEMS),
  cards: z
    .array(
      z.object({
        word: z.string().min(1).max(100),
        box: z.number().int().min(0).max(10),
        due: time,
        misses: z.number().int().nonnegative(),
        example: z.string().max(2000),
        updatedAt: time,
        deleted: z.boolean(),
      }),
    )
    .max(MAX_ITEMS),
})

export const clientError = z.object({
  message: z.string().max(1000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(2000).optional(),
})
