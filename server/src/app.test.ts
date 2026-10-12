import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SyncRequest, SyncResponse, SyncedCard, SyncedText } from '../../shared/sync.ts'
import { createApp } from './app.ts'
import { migrate, type Db } from './db.ts'
import { sync } from './sync.ts'
import { testDb } from './test/pglite.ts'

const ORIGIN = 'https://feruzaabdukayumova.github.io'
let db: Db
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  db = await testDb()
  app = createApp({ db, origins: [ORIGIN], authLimit: 5 })
})
afterEach(() => db.close())

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })

async function account(email = 'reader@example.com', password = 'correct horse') {
  const res = await post('/auth/signup', { email, password })
  expect(res.status).toBe(201)
  return ((await res.json()) as { token: string }).token
}

const text = (id: string, updatedAt: number, extra: Partial<SyncedText> = {}): SyncedText => ({
  id,
  title: id,
  body: 'Some text.',
  createdAt: 1,
  updatedAt,
  deleted: false,
  ...extra,
})
const card = (word: string, updatedAt: number, box = 0): SyncedCard => ({
  word,
  box,
  due: 0,
  misses: 1,
  example: word,
  updatedAt,
  deleted: false,
})
const req = (cursor: number, changes: Partial<SyncRequest> = {}): SyncRequest => ({ cursor, texts: [], attempts: [], cards: [], ...changes })

async function syncAs(token: string, body: SyncRequest): Promise<SyncResponse> {
  const res = await post('/sync', body, token)
  expect(res.status).toBe(200)
  return res.json() as Promise<SyncResponse>
}

describe('accounts', () => {
  it('signs up, signs in, and signs out', async () => {
    await account('Reader@Example.com ')
    const res = await post('/auth/signin', { email: 'reader@example.com', password: 'correct horse' })
    expect(res.status).toBe(200)
    const { token, email } = (await res.json()) as { token: string; email: string }
    expect(email).toBe('reader@example.com')

    const me = await app.request('/me', { headers: { Authorization: `Bearer ${token}` } })
    expect(await me.json()).toEqual({ email: 'reader@example.com' })

    expect((await post('/auth/signout', {}, token)).status).toBe(204)
    expect((await app.request('/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
  })

  it('refuses a second account for the same email, whatever its case', async () => {
    await account('reader@example.com')
    expect((await post('/auth/signup', { email: 'READER@example.com', password: 'another one' })).status).toBe(409)
  })

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await account()
    const wrongPassword = await post('/auth/signin', { email: 'reader@example.com', password: 'nope nope' })
    const unknownEmail = await post('/auth/signin', { email: 'nobody@example.com', password: 'nope nope' })
    expect([wrongPassword.status, unknownEmail.status]).toEqual([401, 401])
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json())
  })

  it('rejects bad input', async () => {
    expect((await post('/auth/signup', { email: 'not an email', password: 'long enough' })).status).toBe(400)
    expect((await post('/auth/signup', { email: 'a@b.co', password: 'short' })).status).toBe(400)
    expect((await app.request('/auth/signup', { method: 'POST', body: '{' })).status).toBe(400)
  })

  it('stores only a hash of the session token and password', async () => {
    const token = await account()
    const { rows } = await db.query<{ token_hash: string; password_hash: string }>(
      'select token_hash, password_hash from sessions join users on users.id = sessions.user_id',
    )
    expect(rows[0].token_hash).not.toContain(token)
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/)
  })

  it('does not accept an expired session', async () => {
    const token = await account()
    await db.query("update sessions set expires_at = now() - interval '1 second'")
    expect((await app.request('/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
  })

  it('limits by the address the proxy saw, not one the client made up', async () => {
    const proxied = createApp({ db, origins: [ORIGIN], authLimit: 2, proxyHops: 1 })
    const attempt = (forwardedFor: string) =>
      proxied.request('/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
        body: JSON.stringify({ email: 'a@b.co', password: 'guess' }),
      })
    const statuses = []
    // a fresh fake address each time, but the same real one appended by the proxy
    for (let i = 0; i < 3; i++) statuses.push((await attempt(`10.0.0.${i}, 203.0.113.7`)).status)
    expect(statuses).toEqual([401, 401, 429])
    expect((await attempt('198.51.100.1')).status).toBe(401)
  })

  it('slows down guessing one account’s password, without letting a stranger lock its owner out', async () => {
    // generous per-address limit, so only the per-account rules are in play
    const proxied = createApp({ db, origins: [ORIGIN], authLimit: 2, proxyHops: 1 })
    await post('/auth/signup', { email: 'owner@example.com', password: 'the right one' })
    const signin = (address: string, password: string) =>
      proxied.request('/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address },
        body: JSON.stringify({ email: 'owner@example.com', password }),
      })

    // a stranger's guesses from one address are cut off…
    const stranger = []
    for (let i = 0; i < 3; i++) stranger.push((await signin('203.0.113.9', 'guess ' + i)).status)
    expect(stranger).toEqual([401, 401, 429])
    // …but the owner, elsewhere, still gets in
    expect((await signin('198.51.100.4', 'the right one')).status).toBe(200)

    // guesses spread over many addresses still hit the per-account limit (10× the per-address one)
    const spread = []
    for (let i = 0; i < 20; i++) spread.push((await signin(`192.0.2.${i}`, 'guess ' + i)).status)
    expect(spread.filter((s) => s === 429).length).toBeGreaterThan(0)
  })

  it('slows down password guessing', async () => {
    const tries = []
    for (let i = 0; i < 6; i++) tries.push((await post('/auth/signin', { email: 'a@b.co', password: 'guess ' + i })).status)
    expect(tries).toEqual([401, 401, 401, 401, 401, 429])
  })

  it('deletes an account with everything synced for it', async () => {
    const token = await account()
    await syncAs(token, req(0, { texts: [text('u:1', 5)], cards: [card('window', 5)] }))
    const res = await app.request('/me', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(204)
    for (const table of ['users', 'sessions', 'texts', 'cards']) {
      expect((await db.query(`select count(*)::int as n from ${table}`)).rows[0]).toEqual({ n: 0 })
    }
  })
})

describe('sync', () => {
  it('needs a session', async () => {
    expect((await post('/sync', req(0))).status).toBe(401)
    expect((await post('/sync', req(0), 'made-up')).status).toBe(401)
  })

  it('brings one device’s changes to another', async () => {
    const token = await account()
    const phone = await syncAs(token, req(0, { texts: [text('u:1', 10)], cards: [card('window', 10)] }))
    const laptop = await syncAs(token, req(0))
    expect(laptop.texts).toEqual([text('u:1', 10)])
    expect(laptop.cards).toEqual([card('window', 10)])
    expect(laptop.cursor).toBe(phone.cursor)

    // nothing new since
    expect(await syncAs(token, req(laptop.cursor))).toEqual({ texts: [], attempts: [], cards: [], cursor: laptop.cursor, more: false })
  })

  it('keeps the newer version when two devices changed the same thing', async () => {
    const token = await account()
    await syncAs(token, req(0, { cards: [card('window', 20, 2)] }))
    // an older change arriving late doesn't overwrite it
    await syncAs(token, req(0, { cards: [card('window', 10, 0)] }))
    expect((await syncAs(token, req(0))).cards).toEqual([card('window', 20, 2)])
    // a newer one does
    await syncAs(token, req(0, { cards: [card('window', 30, 3)] }))
    expect((await syncAs(token, req(0))).cards).toEqual([card('window', 30, 3)])
  })

  it('passes a delete on to other devices', async () => {
    const token = await account()
    const first = await syncAs(token, req(0, { texts: [text('u:1', 10)] }))
    await syncAs(token, req(first.cursor, { texts: [text('u:1', 20, { deleted: true })] }))
    expect((await syncAs(token, req(first.cursor))).texts).toEqual([text('u:1', 20, { deleted: true })])
  })

  it('keeps attempts, practice words included', async () => {
    const token = await account()
    const attempt = { id: 'a1', textId: 'shop', at: 5, score: 80, read: 10, total: 30, practice: ['milk'], updatedAt: 5, deleted: false }
    await syncAs(token, req(0, { attempts: [attempt] }))
    expect((await syncAs(token, req(0))).attempts).toEqual([attempt])
  })

  it('keeps each person’s data to themselves', async () => {
    const mine = await account('me@example.com')
    const theirs = await account('them@example.com')
    await syncAs(mine, req(0, { texts: [text('u:1', 10)] }))
    expect((await syncAs(theirs, req(0))).texts).toEqual([])
  })

  it('sends a large backlog in pages', async () => {
    await account()
    const { rows } = await db.query<{ id: string }>('select id from users')
    const userId = rows[0].id
    await sync(db, userId, req(0, { cards: ['a', 'b', 'c', 'd', 'e'].map((w) => card(w, 1)) }), 2)

    const seen: string[] = []
    let cursor = 0
    let more = true
    while (more) {
      const page = await sync(db, userId, req(cursor), 2)
      seen.push(...page.cards.map((c) => c.word))
      ;({ cursor, more } = page)
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('rejects a malformed sync', async () => {
    const token = await account()
    expect((await post('/sync', { cursor: 0, texts: [{ id: 'x' }], attempts: [], cards: [] }, token)).status).toBe(400)
    expect((await post('/sync', { ...req(0), cards: [{ ...card('x', 1), box: -1 }] }, token)).status).toBe(400)
  })
})

describe('the rest', () => {
  it('records errors reported by the app', async () => {
    expect((await post('/errors', { message: 'boom', stack: 'at x', url: ORIGIN })).status).toBe(204)
    expect((await db.query('select message, url from client_errors')).rows).toEqual([{ message: 'boom', url: ORIGIN }])
  })

  it('keeps the error table bounded', async () => {
    await db.query("insert into client_errors (message) select 'old' from generate_series(1, 5010)")
    await post('/errors', { message: 'new' })
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from client_errors')
    expect(rows[0].n).toBeLessThanOrEqual(5001)
  })

  it('lets the app’s own origin call it from a browser, and no other', async () => {
    const preflight = (origin: string) =>
      app.request('/sync', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } })
    expect((await preflight(ORIGIN)).headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull()
  })

  it('reports health', async () => {
    expect(await (await app.request('/health')).json()).toEqual({ ok: true })
  })

  it('runs each migration once', async () => {
    expect(await migrate(db)).toEqual([])
  })
})
