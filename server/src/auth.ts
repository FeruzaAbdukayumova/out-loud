import { hash, verify } from '@node-rs/argon2'
import { createHash, randomBytes } from 'node:crypto'
import type { Db, Queryable } from './db.ts'

export const SESSION_DAYS = 90
export const MIN_PASSWORD = 8

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** Compared against when the email is unknown, so a wrong email takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null

export class EmailTaken extends Error {}

/** `email` is expected trimmed and lower case (the request schema does that). */
export async function signUp(db: Db, email: string, password: string): Promise<{ userId: string; token: string }> {
  const passwordHash = await hash(password)
  const { rows } = await db.query<{ id: string }>(
    'insert into users (email, password_hash) values ($1, $2) on conflict (email) do nothing returning id',
    [email, passwordHash],
  )
  if (!rows.length) throw new EmailTaken()
  return { userId: rows[0].id, token: await createSession(db, rows[0].id) }
}

/** null for a wrong email or password; the caller can't tell which, and neither can an attacker. */
export async function signIn(db: Db, email: string, password: string): Promise<{ userId: string; token: string } | null> {
  const { rows } = await db.query<{ id: string; password_hash: string }>('select id, password_hash from users where email = $1', [email])
  if (!rows.length) {
    dummyHash ??= hash('not a real password')
    await verify(await dummyHash, password)
    return null
  }
  if (!(await verify(rows[0].password_hash, password))) return null
  return { userId: rows[0].id, token: await createSession(db, rows[0].id) }
}

async function createSession(db: Queryable, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [
    sha256(token),
    userId,
  ])
  return token
}

export async function userForToken(db: Db, token: string): Promise<{ id: string; email: string } | null> {
  const { rows } = await db.query<{ id: string; email: string }>(
    'select u.id, u.email from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()',
    [sha256(token)],
  )
  return rows[0] ?? null
}

export async function signOut(db: Db, token: string): Promise<void> {
  await db.query('delete from sessions where token_hash = $1', [sha256(token)])
}

/** Deletes the account and, through the foreign keys, everything synced for it. */
export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.query('delete from users where id = $1', [userId])
}
